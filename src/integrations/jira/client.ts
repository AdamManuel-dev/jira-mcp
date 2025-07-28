/**
 * @fileoverview JIRA REST API v3 client with authentication and error handling
 * @lastmodified 2025-07-27T23:35:00Z
 * 
 * Features: Complete JIRA REST API v3 client, request/response interceptors, rate limiting, caching
 * Main APIs: Issues, projects, sprints, users, search, webhooks, custom fields
 * Constraints: Requires OAuth 2.0 tokens, supports pagination, handles rate limits
 * Patterns: Circuit breaker, exponential backoff, request queuing, response caching
 */

import axios, { AxiosInstance, AxiosResponse, AxiosRequestConfig } from 'axios';
import { config } from '@/config/environment';
import { cache } from '@/config/redis';
import { logger, logExternalRequest, perf } from '@/utils/logger';
import { ExternalServiceError, AuthenticationError, RateLimitError } from '@/middleware/error-handler';
import { JiraOAuthService } from './oauth';
import {
  JiraInstance,
  JiraIssue,
  JiraProject,
  JiraSprint,
  JiraUser,
  JiraSearchRequest,
  JiraSearchResponse,
  JiraApiResponse,
  JiraApiError,
  JiraComment,
  JiraWorklog,
  JiraIssueType,
  JiraStatus,
  JiraPriority,
} from '@/types/jira';

interface JiraClientConfig {
  organizationId: string;
  userId: string;
  instanceId: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
}

interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetTime: number;
}

interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  state: 'closed' | 'open' | 'half-open';
}

export class JiraApiClient {
  private readonly config: JiraClientConfig;
  private readonly oauthService: JiraOAuthService;
  private readonly httpClient: AxiosInstance;
  private rateLimitInfo: RateLimitInfo | null = null;
  private circuitBreaker: CircuitBreakerState = {
    failures: 0,
    lastFailureTime: 0,
    state: 'closed',
  };

  constructor(clientConfig: JiraClientConfig) {
    this.config = {
      timeout: 30000,
      maxRetries: 3,
      retryDelay: 1000,
      ...clientConfig,
    };

    this.oauthService = new JiraOAuthService();

    // Create axios instance with base configuration
    this.httpClient = axios.create({
      baseURL: this.config.baseUrl || `https://api.atlassian.com/ex/jira/${this.config.instanceId}/rest/api/3`,
      timeout: this.config.timeout,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'SIAS/1.0.0',
      },
    });

    this.setupInterceptors();
  }

  /**
   * Setup request/response interceptors
   */
  private setupInterceptors(): void {
    // Request interceptor for authentication
    this.httpClient.interceptors.request.use(
      async (config) => {
        // Check circuit breaker
        this.checkCircuitBreaker();

        // Add authentication
        const tokens = await this.oauthService.getValidTokens(
          this.config.organizationId,
          this.config.userId
        );
        
        config.headers.Authorization = `Bearer ${tokens.accessToken}`;

        // Add request ID for tracking
        config.headers['X-Request-ID'] = `sias-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        logger.debug('JIRA API request', {
          method: config.method?.toUpperCase(),
          url: config.url,
          organizationId: this.config.organizationId,
          userId: this.config.userId,
          requestId: config.headers['X-Request-ID'],
        });

        return config;
      },
      (error) => {
        logger.error('JIRA API request interceptor error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor for error handling and rate limiting
    this.httpClient.interceptors.response.use(
      (response) => {
        // Update rate limit info
        this.updateRateLimitInfo(response);

        // Reset circuit breaker on success
        this.circuitBreaker.failures = 0;
        this.circuitBreaker.state = 'closed';

        logExternalRequest(
          response.config.method?.toUpperCase() || 'GET',
          response.config.url || '',
          response.status,
          undefined
        );

        return response;
      },
      async (error) => {
        const response = error.response;
        const config = error.config;

        // Log the error
        logExternalRequest(
          config?.method?.toUpperCase() || 'GET',
          config?.url || '',
          response?.status,
          undefined,
          error
        );

        // Handle different error types
        if (response) {
          switch (response.status) {
            case 401:
              // Try to refresh token once
              if (!config._retryAuth) {
                try {
                  await this.oauthService.refreshTokens(
                    this.config.organizationId,
                    this.config.userId
                  );
                  config._retryAuth = true;
                  return this.httpClient.request(config);
                } catch (refreshError) {
                  logger.error('Failed to refresh JIRA token:', refreshError);
                  throw new AuthenticationError('JIRA authentication failed');
                }
              }
              throw new AuthenticationError('JIRA authentication failed');

            case 403:
              throw new AuthenticationError('Insufficient JIRA permissions');

            case 404:
              throw new ExternalServiceError('JIRA', new Error('Resource not found'));

            case 429:
              // Handle rate limiting
              this.updateRateLimitInfo(response);
              const retryAfter = this.getRateLimitResetTime();
              throw new RateLimitError(
                `JIRA rate limit exceeded. Retry after ${retryAfter} seconds.`
              );

            case 500:
            case 502:
            case 503:
            case 504:
              // Increment circuit breaker failures
              this.circuitBreaker.failures++;
              this.circuitBreaker.lastFailureTime = Date.now();

              // Implement exponential backoff retry
              if (config._retryCount < this.config.maxRetries!) {
                const retryCount = config._retryCount || 0;
                const delay = this.config.retryDelay! * Math.pow(2, retryCount);
                
                config._retryCount = retryCount + 1;
                
                logger.warn(`JIRA API retry ${retryCount + 1}/${this.config.maxRetries}`, {
                  status: response.status,
                  delay,
                  url: config.url,
                });

                await this.delay(delay);
                return this.httpClient.request(config);
              }

              throw new ExternalServiceError('JIRA', error);

            default:
              throw new ExternalServiceError('JIRA', error);
          }
        } else {
          // Network error
          this.circuitBreaker.failures++;
          this.circuitBreaker.lastFailureTime = Date.now();
          throw new ExternalServiceError('JIRA', error);
        }
      }
    );
  }

  /**
   * Check circuit breaker state
   */
  private checkCircuitBreaker(): void {
    const { failures, lastFailureTime, state } = this.circuitBreaker;
    const now = Date.now();
    const failureThreshold = 5;
    const timeoutMs = 60000; // 1 minute

    if (state === 'open') {
      if (now - lastFailureTime > timeoutMs) {
        this.circuitBreaker.state = 'half-open';
        logger.info('JIRA circuit breaker moved to half-open state');
      } else {
        throw new ExternalServiceError('JIRA', new Error('Circuit breaker is open'));
      }
    } else if (state === 'closed' && failures >= failureThreshold) {
      this.circuitBreaker.state = 'open';
      logger.warn('JIRA circuit breaker opened due to failures', { failures });
      throw new ExternalServiceError('JIRA', new Error('Circuit breaker opened'));
    }
  }

  /**
   * Update rate limit information from response headers
   */
  private updateRateLimitInfo(response: AxiosResponse): void {
    const limit = response.headers['x-ratelimit-limit'];
    const remaining = response.headers['x-ratelimit-remaining'];
    const reset = response.headers['x-ratelimit-reset'];

    if (limit && remaining && reset) {
      this.rateLimitInfo = {
        limit: parseInt(limit),
        remaining: parseInt(remaining),
        resetTime: parseInt(reset),
      };

      // Log warning if approaching rate limit
      if (this.rateLimitInfo.remaining < 10) {
        logger.warn('JIRA rate limit approaching', this.rateLimitInfo);
      }
    }
  }

  /**
   * Get rate limit reset time in seconds
   */
  private getRateLimitResetTime(): number {
    if (!this.rateLimitInfo) return 60; // Default 1 minute
    return Math.max(0, this.rateLimitInfo.resetTime - Math.floor(Date.now() / 1000));
  }

  /**
   * Delay helper for retry logic
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generic GET request with caching
   */
  private async get<T>(
    endpoint: string,
    params?: Record<string, any>,
    cacheKey?: string,
    cacheTtl = 300
  ): Promise<T> {
    // Check cache first
    if (cacheKey) {
      const cached = await cache.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    }

    const response = await this.httpClient.get<T>(endpoint, { params });
    
    // Cache the response
    if (cacheKey && response.data) {
      await cache.set(cacheKey, JSON.stringify(response.data), cacheTtl);
    }

    return response.data;
  }

  /**
   * Generic POST request
   */
  private async post<T>(endpoint: string, data?: any): Promise<T> {
    const response = await this.httpClient.post<T>(endpoint, data);
    return response.data;
  }

  /**
   * Generic PUT request
   */
  private async put<T>(endpoint: string, data?: any): Promise<T> {
    const response = await this.httpClient.put<T>(endpoint, data);
    return response.data;
  }

  /**
   * Generic DELETE request
   */
  private async delete<T>(endpoint: string): Promise<T> {
    const response = await this.httpClient.delete<T>(endpoint);
    return response.data;
  }

  // === PROJECTS API ===

  /**
   * Get all projects
   */
  async getProjects(expand?: string[]): Promise<JiraProject[]> {
    return perf.measureAsync('jira.getProjects', async () => {
      const params: any = { maxResults: 1000 };
      if (expand) params.expand = expand.join(',');

      const cacheKey = `jira:projects:${this.config.instanceId}:${this.config.organizationId}`;
      return this.get<JiraProject[]>('/project', params, cacheKey, 600); // 10 minutes cache
    });
  }

  /**
   * Get project by key or ID
   */
  async getProject(projectIdOrKey: string, expand?: string[]): Promise<JiraProject> {
    return perf.measureAsync('jira.getProject', async () => {
      const params: any = {};
      if (expand) params.expand = expand.join(',');

      const cacheKey = `jira:project:${this.config.instanceId}:${projectIdOrKey}`;
      return this.get<JiraProject>(`/project/${projectIdOrKey}`, params, cacheKey, 300);
    });
  }

  // === ISSUES API ===

  /**
   * Search for issues using JQL
   */
  async searchIssues(searchRequest: JiraSearchRequest): Promise<JiraSearchResponse> {
    return perf.measureAsync('jira.searchIssues', async () => {
      logger.debug('JIRA search request', {
        jql: searchRequest.jql,
        maxResults: searchRequest.maxResults,
        fields: searchRequest.fields,
      });

      return this.post<JiraSearchResponse>('/search', searchRequest);
    });
  }

  /**
   * Get issue by key or ID
   */
  async getIssue(issueIdOrKey: string, expand?: string[], fields?: string[]): Promise<JiraIssue> {
    return perf.measureAsync('jira.getIssue', async () => {
      const params: any = {};
      if (expand) params.expand = expand.join(',');
      if (fields) params.fields = fields.join(',');

      const cacheKey = `jira:issue:${this.config.instanceId}:${issueIdOrKey}`;
      return this.get<JiraIssue>(`/issue/${issueIdOrKey}`, params, cacheKey, 60); // 1 minute cache
    });
  }

  /**
   * Create issue
   */
  async createIssue(issueData: any): Promise<JiraIssue> {
    return perf.measureAsync('jira.createIssue', async () => {
      logger.info('Creating JIRA issue', {
        project: issueData.fields?.project?.key,
        issueType: issueData.fields?.issuetype?.name,
        summary: issueData.fields?.summary,
      });

      return this.post<JiraIssue>('/issue', issueData);
    });
  }

  /**
   * Update issue
   */
  async updateIssue(issueIdOrKey: string, updateData: any): Promise<void> {
    return perf.measureAsync('jira.updateIssue', async () => {
      logger.info('Updating JIRA issue', {
        issueKey: issueIdOrKey,
        updateFields: Object.keys(updateData.fields || {}),
      });

      await this.put(`/issue/${issueIdOrKey}`, updateData);
    });
  }

  /**
   * Get issue comments
   */
  async getIssueComments(issueIdOrKey: string, startAt = 0, maxResults = 50): Promise<{
    comments: JiraComment[];
    total: number;
  }> {
    return perf.measureAsync('jira.getIssueComments', async () => {
      const params = { startAt, maxResults };
      const response = await this.get<any>(`/issue/${issueIdOrKey}/comment`, params);
      
      return {
        comments: response.comments,
        total: response.total,
      };
    });
  }

  /**
   * Add comment to issue
   */
  async addComment(issueIdOrKey: string, comment: any): Promise<JiraComment> {
    return perf.measureAsync('jira.addComment', async () => {
      logger.info('Adding comment to JIRA issue', {
        issueKey: issueIdOrKey,
        commentLength: comment.body?.length || 0,
      });

      return this.post<JiraComment>(`/issue/${issueIdOrKey}/comment`, comment);
    });
  }

  /**
   * Get issue worklogs
   */
  async getIssueWorklogs(issueIdOrKey: string, startAt = 0, maxResults = 50): Promise<{
    worklogs: JiraWorklog[];
    total: number;
  }> {
    return perf.measureAsync('jira.getIssueWorklogs', async () => {
      const params = { startAt, maxResults };
      const response = await this.get<any>(`/issue/${issueIdOrKey}/worklog`, params);
      
      return {
        worklogs: response.worklogs,
        total: response.total,
      };
    });
  }

  /**
   * Add worklog to issue
   */
  async addWorklog(issueIdOrKey: string, worklog: any): Promise<JiraWorklog> {
    return perf.measureAsync('jira.addWorklog', async () => {
      logger.info('Adding worklog to JIRA issue', {
        issueKey: issueIdOrKey,
        timeSpent: worklog.timeSpent,
        started: worklog.started,
      });

      return this.post<JiraWorklog>(`/issue/${issueIdOrKey}/worklog`, worklog);
    });
  }

  // === SPRINTS API ===

  /**
   * Get sprints for a board
   */
  async getBoardSprints(boardId: number, state?: string): Promise<JiraSprint[]> {
    return perf.measureAsync('jira.getBoardSprints', async () => {
      const params: any = { maxResults: 1000 };
      if (state) params.state = state;

      const cacheKey = `jira:board:${this.config.instanceId}:${boardId}:sprints:${state || 'all'}`;
      const response = await this.get<any>(`/board/${boardId}/sprint`, params, cacheKey, 300);
      
      return response.values || [];
    });
  }

  /**
   * Get sprint by ID
   */
  async getSprint(sprintId: number): Promise<JiraSprint> {
    return perf.measureAsync('jira.getSprint', async () => {
      const cacheKey = `jira:sprint:${this.config.instanceId}:${sprintId}`;
      return this.get<JiraSprint>(`/sprint/${sprintId}`, undefined, cacheKey, 300);
    });
  }

  /**
   * Get sprint issues
   */
  async getSprintIssues(sprintId: number, startAt = 0, maxResults = 100): Promise<JiraSearchResponse> {
    return perf.measureAsync('jira.getSprintIssues', async () => {
      const jql = `sprint = ${sprintId}`;
      
      return this.searchIssues({
        jql,
        startAt,
        maxResults,
        fields: [
          'key', 'summary', 'status', 'assignee', 'priority', 'issuetype',
          'created', 'updated', 'timeoriginalestimate', 'timespent',
          'customfield_10001', // Story points
          'sprint',
        ],
      });
    });
  }

  // === USERS API ===

  /**
   * Get current user
   */
  async getCurrentUser(): Promise<JiraUser> {
    return perf.measureAsync('jira.getCurrentUser', async () => {
      const cacheKey = `jira:currentUser:${this.config.instanceId}:${this.config.userId}`;
      return this.get<JiraUser>('/myself', undefined, cacheKey, 300);
    });
  }

  /**
   * Search users
   */
  async searchUsers(query: string, maxResults = 50): Promise<JiraUser[]> {
    return perf.measureAsync('jira.searchUsers', async () => {
      const params = { query, maxResults };
      return this.get<JiraUser[]>('/user/search', params);
    });
  }

  // === METADATA API ===

  /**
   * Get issue types
   */
  async getIssueTypes(): Promise<JiraIssueType[]> {
    return perf.measureAsync('jira.getIssueTypes', async () => {
      const cacheKey = `jira:issueTypes:${this.config.instanceId}`;
      return this.get<JiraIssueType[]>('/issuetype', undefined, cacheKey, 3600); // 1 hour cache
    });
  }

  /**
   * Get statuses
   */
  async getStatuses(): Promise<JiraStatus[]> {
    return perf.measureAsync('jira.getStatuses', async () => {
      const cacheKey = `jira:statuses:${this.config.instanceId}`;
      return this.get<JiraStatus[]>('/status', undefined, cacheKey, 3600); // 1 hour cache
    });
  }

  /**
   * Get priorities
   */
  async getPriorities(): Promise<JiraPriority[]> {
    return perf.measureAsync('jira.getPriorities', async () => {
      const cacheKey = `jira:priorities:${this.config.instanceId}`;
      return this.get<JiraPriority[]>('/priority', undefined, cacheKey, 3600); // 1 hour cache
    });
  }

  /**
   * Get custom fields
   */
  async getCustomFields(): Promise<any[]> {
    return perf.measureAsync('jira.getCustomFields', async () => {
      const cacheKey = `jira:customFields:${this.config.instanceId}`;
      return this.get<any[]>('/field', undefined, cacheKey, 3600); // 1 hour cache
    });
  }

  // === UTILITY METHODS ===

  /**
   * Test connection to JIRA
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.getCurrentUser();
      return true;
    } catch (error) {
      logger.error('JIRA connection test failed:', error);
      return false;
    }
  }

  /**
   * Get rate limit information
   */
  getRateLimitInfo(): RateLimitInfo | null {
    return this.rateLimitInfo;
  }

  /**
   * Get circuit breaker state
   */
  getCircuitBreakerState(): CircuitBreakerState {
    return { ...this.circuitBreaker };
  }

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker = {
      failures: 0,
      lastFailureTime: 0,
      state: 'closed',
    };
    logger.info('JIRA circuit breaker reset');
  }
}