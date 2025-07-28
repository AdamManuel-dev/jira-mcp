/**
 * @fileoverview JIRA REST API v3 client with authentication and error handling
 * @lastmodified 2025-07-28T08:15:29Z
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
   * Evaluates circuit breaker state and throws error if service is unavailable
   * 
   * Implements circuit breaker pattern to prevent cascade failures. Opens circuit
   * after 5 consecutive failures, stays open for 1 minute, then moves to half-open
   * state for testing.
   */
  private checkCircuitBreaker(): void {
    const { failures, lastFailureTime, state } = this.circuitBreaker;
    const now = Date.now();
    const FAILURE_THRESHOLD = 5; // Max failures before opening circuit
    const CIRCUIT_TIMEOUT_MS = 60000; // Circuit open timeout (1 minute)

    if (state === 'open') {
      if (now - lastFailureTime > CIRCUIT_TIMEOUT_MS) {
        this.circuitBreaker.state = 'half-open';
        logger.info('JIRA circuit breaker moved to half-open state');
      } else {
        throw new ExternalServiceError('JIRA', new Error('Circuit breaker is open'));
      }
    } else if (state === 'closed' && failures >= FAILURE_THRESHOLD) {
      this.circuitBreaker.state = 'open';
      logger.warn('JIRA circuit breaker opened due to failures', { failures });
      throw new ExternalServiceError('JIRA', new Error('Circuit breaker opened'));
    }
  }

  /**
   * Updates internal rate limit tracking from JIRA API response headers
   * 
   * Extracts rate limit information from HTTP headers and updates internal state.
   * Logs warnings when approaching rate limits to prevent service disruption.
   * 
   * @param response - HTTP response containing rate limit headers
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
   * Calculates seconds until rate limit resets for retry timing
   * 
   * Computes time remaining until rate limit window resets based on current
   * time and reset timestamp from JIRA headers. Used for exponential backoff.
   * 
   * @returns Seconds until rate limit resets (minimum 0, default 60 if no data)
   */
  private getRateLimitResetTime(): number {
    if (!this.rateLimitInfo) return 60; // Default 1 minute
    return Math.max(0, this.rateLimitInfo.resetTime - Math.floor(Date.now() / 1000));
  }

  /**
   * Creates a promise-based delay for retry and backoff operations
   * 
   * Used internally for exponential backoff retry logic and rate limit handling.
   * Provides non-blocking delay mechanism for API client retry patterns.
   * 
   * @param ms - Milliseconds to delay execution
   * @returns Promise that resolves after specified delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Executes GET request with optional Redis caching for performance optimization
   * 
   * Checks cache first to avoid redundant API calls, then makes HTTP request
   * if needed and caches the response for future use.
   * 
   * @param endpoint - API endpoint path
   * @param params - Query parameters
   * @param cacheKey - Optional Redis cache key
   * @param cacheTtl - Cache time-to-live in seconds (default: 5 minutes)
   * @returns Parsed response data
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
   * Executes POST request with authentication and error handling
   * 
   * Performs authenticated POST request to JIRA API endpoint with automatic
   * retry logic, circuit breaker protection, and standardized error handling.
   * 
   * @param endpoint - API endpoint path (relative to base URL)
   * @param data - Optional request body data
   * @returns Parsed response data of specified type
   * @throws {AuthenticationError} When authentication fails
   * @throws {RateLimitError} When rate limits are exceeded
   * @throws {ExternalServiceError} For other API errors
   */
  private async post<T>(endpoint: string, data?: any): Promise<T> {
    const response = await this.httpClient.post<T>(endpoint, data);
    return response.data;
  }

  /**
   * Executes PUT request with authentication and error handling
   * 
   * Performs authenticated PUT request to JIRA API endpoint with automatic
   * retry logic, circuit breaker protection, and standardized error handling.
   * 
   * @param endpoint - API endpoint path (relative to base URL)
   * @param data - Optional request body data
   * @returns Parsed response data of specified type
   * @throws {AuthenticationError} When authentication fails
   * @throws {RateLimitError} When rate limits are exceeded
   * @throws {ExternalServiceError} For other API errors
   */
  private async put<T>(endpoint: string, data?: any): Promise<T> {
    const response = await this.httpClient.put<T>(endpoint, data);
    return response.data;
  }

  /**
   * Executes DELETE request with authentication and error handling
   * 
   * Performs authenticated DELETE request to JIRA API endpoint with automatic
   * retry logic, circuit breaker protection, and standardized error handling.
   * 
   * @param endpoint - API endpoint path (relative to base URL)
   * @returns Parsed response data of specified type
   * @throws {AuthenticationError} When authentication fails
   * @throws {RateLimitError} When rate limits are exceeded
   * @throws {ExternalServiceError} For other API errors
   */
  private async delete<T>(endpoint: string): Promise<T> {
    const response = await this.httpClient.delete<T>(endpoint);
    return response.data;
  }

  // === PROJECTS API ===

  /**
   * Retrieves all accessible projects from JIRA instance
   * 
   * Fetches all projects the authenticated user has access to, with optional
   * field expansion for additional project details. Results are cached for
   * 10 minutes to improve performance.
   * 
   * @param expand - Optional fields to expand (e.g., ['description', 'lead'])
   * @returns Array of JIRA projects with basic information
   * @throws {AuthenticationError} When user lacks project access permissions
   * @throws {ExternalServiceError} For API communication errors
   * 
   * @example
   * const projects = await client.getProjects(['description', 'lead']);
   * console.log(`Found ${projects.length} projects`);
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
   * Retrieves detailed information for a specific JIRA project
   * 
   * Fetches project details by project key or ID with optional field expansion.
   * Results are cached for 5 minutes to balance freshness with performance.
   * 
   * @param projectIdOrKey - Project key (e.g., 'PROJ') or numeric ID
   * @param expand - Optional fields to expand for additional details
   * @returns Complete project information including metadata
   * @throws {ExternalServiceError} When project is not found or inaccessible
   * 
   * @example
   * const project = await client.getProject('MYPROJ', ['components', 'versions']);
   * console.log(`Project: ${project.name} (${project.key})`);
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
   * Searches for JIRA issues using JQL (JIRA Query Language)
   * 
   * Executes a JQL query to find issues matching specified criteria. Supports
   * pagination, field selection, and result expansion for optimized queries.
   * 
   * @param searchRequest - JQL search parameters including query, pagination, and fields
   * @returns Search results with issues, pagination info, and total count
   * @throws {ExternalServiceError} When JQL syntax is invalid or search fails
   * 
   * @example
   * const results = await client.searchIssues({
   *   jql: 'project = MYPROJ AND status = "In Progress"',
   *   maxResults: 50,
   *   fields: ['key', 'summary', 'status', 'assignee']
   * });
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
   * Retrieves detailed information for a specific JIRA issue
   * 
   * Fetches complete issue data by key or ID with optional field filtering
   * and expansion. Results are cached for 1 minute for performance.
   * 
   * @param issueIdOrKey - Issue key (e.g., 'PROJ-123') or numeric ID
   * @param expand - Optional fields to expand (e.g., ['changelog', 'transitions'])
   * @param fields - Specific fields to retrieve (default: all fields)
   * @returns Complete issue information including fields and metadata
   * @throws {ExternalServiceError} When issue is not found or inaccessible
   * 
   * @example
   * const issue = await client.getIssue('PROJ-123', ['changelog'], ['key', 'summary', 'status']);
   * console.log(`Issue: ${issue.key} - ${issue.fields.summary}`);
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
   * Creates a new JIRA issue with specified field values
   * 
   * Creates issue in specified project with required and optional fields.
   * Validates field values against project configuration and issue type constraints.
   * 
   * @param issueData - Issue creation data including project, type, and field values
   * @returns Created issue with generated key and initial field values
   * @throws {ExternalServiceError} When field validation fails or creation is denied
   * 
   * @example
   * const newIssue = await client.createIssue({
   *   fields: {
   *     project: { key: 'PROJ' },
   *     issuetype: { name: 'Bug' },
   *     summary: 'Application crashes on login',
   *     description: 'Detailed bug description...'
   *   }
   * });
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
   * Updates field values for an existing JIRA issue
   * 
   * Modifies issue fields using JIRA's update format. Supports both field
   * replacement and append operations. Validates permissions and field constraints.
   * 
   * @param issueIdOrKey - Issue key (e.g., 'PROJ-123') or numeric ID
   * @param updateData - Update operations including fields and update operations
   * @throws {AuthenticationError} When user lacks edit permissions
   * @throws {ExternalServiceError} When field validation fails or issue is locked
   * 
   * @example
   * await client.updateIssue('PROJ-123', {
   *   fields: {
   *     summary: 'Updated issue summary',
   *     assignee: { accountId: 'user123' }
   *   }
   * });
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
   * Retrieves paginated comments for a JIRA issue
   * 
   * Fetches comments with author information, timestamps, and content.
   * Supports pagination for issues with many comments.
   * 
   * @param issueIdOrKey - Issue key (e.g., 'PROJ-123') or numeric ID
   * @param startAt - Zero-based index of first comment to return
   * @param maxResults - Maximum number of comments per page (max 1000)
   * @returns Comments array with pagination metadata
   * @throws {ExternalServiceError} When issue is not found or inaccessible
   * 
   * @example
   * const { comments, total } = await client.getIssueComments('PROJ-123', 0, 25);
   * console.log(`Showing ${comments.length} of ${total} comments`);
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
   * Adds a new comment to a JIRA issue
   * 
   * Creates comment with specified content and optional visibility restrictions.
   * Supports rich text formatting using JIRA's Document Format.
   * 
   * @param issueIdOrKey - Issue key (e.g., 'PROJ-123') or numeric ID
   * @param comment - Comment data including body and optional visibility settings
   * @returns Created comment with ID, timestamp, and author information
   * @throws {AuthenticationError} When user lacks comment permissions
   * @throws {ExternalServiceError} When comment creation fails
   * 
   * @example
   * const newComment = await client.addComment('PROJ-123', {
   *   body: 'This issue has been investigated and requires frontend changes.'
   * });
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
   * Retrieves paginated work logs for a JIRA issue
   * 
   * Fetches time tracking entries with duration, author, and description.
   * Supports pagination for issues with extensive work logging.
   * 
   * @param issueIdOrKey - Issue key (e.g., 'PROJ-123') or numeric ID
   * @param startAt - Zero-based index of first worklog to return
   * @param maxResults - Maximum number of worklogs per page (max 1000)
   * @returns Worklogs array with pagination metadata
   * @throws {ExternalServiceError} When issue is not found or time tracking disabled
   * 
   * @example
   * const { worklogs, total } = await client.getIssueWorklogs('PROJ-123');
   * const totalHours = worklogs.reduce((sum, log) => sum + log.timeSpentSeconds, 0) / 3600;
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
   * Logs time spent working on a JIRA issue
   * 
   * Records work with time spent, start date, and optional description.
   * Updates issue's time tracking fields and generates audit trail.
   * 
   * @param issueIdOrKey - Issue key (e.g., 'PROJ-123') or numeric ID
   * @param worklog - Work log data including timeSpent, started, and comment
   * @returns Created worklog with ID, timestamps, and calculated values
   * @throws {AuthenticationError} When user lacks work logging permissions
   * @throws {ExternalServiceError} When time tracking is disabled or invalid
   * 
   * @example
   * const worklog = await client.addWorklog('PROJ-123', {
   *   timeSpent: '2h 30m',
   *   started: '2025-07-28T09:00:00.000+0000',
   *   comment: 'Implemented authentication service'
   * });
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
   * Retrieves sprints associated with a JIRA Agile board
   * 
   * Fetches sprint information including dates, goals, and state.
   * Results are cached for 5 minutes to improve dashboard performance.
   * 
   * @param boardId - Numeric ID of the JIRA board
   * @param state - Optional sprint state filter ('active', 'future', 'closed')
   * @returns Array of sprints matching the specified criteria
   * @throws {ExternalServiceError} When board is not found or inaccessible
   * 
   * @example
   * const activeSprints = await client.getBoardSprints(123, 'active');
   * const currentSprint = activeSprints.find(s => s.state === 'active');
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
   * Retrieves detailed information for a specific sprint
   * 
   * Fetches sprint metadata including dates, goal, board association,
   * and completion statistics. Results are cached for 5 minutes.
   * 
   * @param sprintId - Numeric ID of the sprint
   * @returns Complete sprint information with dates and metadata
   * @throws {ExternalServiceError} When sprint is not found or inaccessible
   * 
   * @example
   * const sprint = await client.getSprint(456);
   * console.log(`Sprint: ${sprint.name} (${sprint.state})`);
   * console.log(`Duration: ${sprint.startDate} to ${sprint.endDate}`);
   */
  async getSprint(sprintId: number): Promise<JiraSprint> {
    return perf.measureAsync('jira.getSprint', async () => {
      const cacheKey = `jira:sprint:${this.config.instanceId}:${sprintId}`;
      return this.get<JiraSprint>(`/sprint/${sprintId}`, undefined, cacheKey, 300);
    });
  }

  /**
   * Retrieves all issues assigned to a specific sprint
   * 
   * Fetches issues using optimized JQL query with essential fields for
   * sprint reporting and analytics. Includes story points and time tracking.
   * 
   * @param sprintId - Numeric ID of the sprint
   * @param startAt - Zero-based index for pagination
   * @param maxResults - Maximum issues per page (default 100)
   * @returns Search results with issues and sprint-specific metadata
   * @throws {ExternalServiceError} When sprint is not found or query fails
   * 
   * @example
   * const sprintIssues = await client.getSprintIssues(456);
   * const storyPoints = sprintIssues.issues
   *   .map(issue => issue.fields.customfield_10001 || 0)
   *   .reduce((sum, points) => sum + points, 0);
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
   * Retrieves profile information for the authenticated user
   * 
   * Fetches current user's profile including display name, email,
   * avatar, and permissions. Results are cached for 5 minutes.
   * 
   * @returns Current user profile and account information
   * @throws {AuthenticationError} When token is invalid or expired
   * 
   * @example
   * const user = await client.getCurrentUser();
   * console.log(`Logged in as: ${user.displayName} (${user.emailAddress})`);
   */
  async getCurrentUser(): Promise<JiraUser> {
    return perf.measureAsync('jira.getCurrentUser', async () => {
      const cacheKey = `jira:currentUser:${this.config.instanceId}:${this.config.userId}`;
      return this.get<JiraUser>('/myself', undefined, cacheKey, 300);
    });
  }

  /**
   * Searches for JIRA users by name or email
   * 
   * Finds users matching the query string for assignment, mentions,
   * or permission management. Respects user privacy settings.
   * 
   * @param query - Search string (name, display name, or email)
   * @param maxResults - Maximum users to return (default 50, max 1000)
   * @returns Array of matching user profiles
   * @throws {ExternalServiceError} When search fails or user lacks browse permissions
   * 
   * @example
   * const users = await client.searchUsers('john.doe');
   * const assigneeOptions = users.map(u => ({ value: u.accountId, label: u.displayName }));
   */
  async searchUsers(query: string, maxResults = 50): Promise<JiraUser[]> {
    return perf.measureAsync('jira.searchUsers', async () => {
      const params = { query, maxResults };
      return this.get<JiraUser[]>('/user/search', params);
    });
  }

  // === METADATA API ===

  /**
   * Retrieves all available issue types for the JIRA instance
   * 
   * Fetches issue type definitions including icons, workflows, and field
   * configurations. Results are cached for 1 hour as they rarely change.
   * 
   * @returns Array of issue types with metadata and configuration
   * @throws {ExternalServiceError} When metadata retrieval fails
   * 
   * @example
   * const issueTypes = await client.getIssueTypes();
   * const bugType = issueTypes.find(type => type.name === 'Bug');
   */
  async getIssueTypes(): Promise<JiraIssueType[]> {
    return perf.measureAsync('jira.getIssueTypes', async () => {
      const cacheKey = `jira:issueTypes:${this.config.instanceId}`;
      return this.get<JiraIssueType[]>('/issuetype', undefined, cacheKey, 3600); // 1 hour cache
    });
  }

  /**
   * Retrieves all workflow statuses available in the JIRA instance
   * 
   * Fetches status definitions including categories, colors, and workflow
   * transitions. Results are cached for 1 hour as they rarely change.
   * 
   * @returns Array of statuses with display names and categorization
   * @throws {ExternalServiceError} When metadata retrieval fails
   * 
   * @example
   * const statuses = await client.getStatuses();
   * const doneStatuses = statuses.filter(s => s.statusCategory.key === 'done');
   */
  async getStatuses(): Promise<JiraStatus[]> {
    return perf.measureAsync('jira.getStatuses', async () => {
      const cacheKey = `jira:statuses:${this.config.instanceId}`;
      return this.get<JiraStatus[]>('/status', undefined, cacheKey, 3600); // 1 hour cache
    });
  }

  /**
   * Retrieves all issue priorities configured in the JIRA instance
   * 
   * Fetches priority definitions including names, colors, and icons.
   * Results are cached for 1 hour as priorities rarely change.
   * 
   * @returns Array of priorities ordered by importance level
   * @throws {ExternalServiceError} When metadata retrieval fails
   * 
   * @example
   * const priorities = await client.getPriorities();
   * const highestPriority = priorities.find(p => p.name === 'Highest');
   */
  async getPriorities(): Promise<JiraPriority[]> {
    return perf.measureAsync('jira.getPriorities', async () => {
      const cacheKey = `jira:priorities:${this.config.instanceId}`;
      return this.get<JiraPriority[]>('/priority', undefined, cacheKey, 3600); // 1 hour cache
    });
  }

  /**
   * Retrieves all custom field definitions for the JIRA instance
   * 
   * Fetches custom field metadata including field types, options, and
   * project contexts. Used for dynamic form generation and data mapping.
   * Results are cached for 1 hour as field definitions rarely change.
   * 
   * @returns Array of custom field definitions with context and schema
   * @throws {ExternalServiceError} When field metadata retrieval fails
   * 
   * @example
   * const customFields = await client.getCustomFields();
   * const storyPointsField = customFields.find(f => f.name === 'Story Points');
   * console.log(`Story Points field ID: ${storyPointsField.id}`);
   */
  async getCustomFields(): Promise<any[]> {
    return perf.measureAsync('jira.getCustomFields', async () => {
      const cacheKey = `jira:customFields:${this.config.instanceId}`;
      return this.get<any[]>('/field', undefined, cacheKey, 3600); // 1 hour cache
    });
  }

  // === UTILITY METHODS ===

  /**
   * Tests connectivity and authentication to the JIRA instance
   * 
   * Performs a lightweight API call to verify credentials and network
   * connectivity. Used for health checks and configuration validation.
   * 
   * @returns True if connection successful, false otherwise
   * 
   * @example
   * const isConnected = await client.testConnection();
   * if (!isConnected) {
   *   console.error('JIRA connection failed - check credentials');
   * }
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
   * Returns current rate limit status from the JIRA API
   * 
   * Provides information about remaining requests, limits, and reset times
   * for monitoring and throttling API usage.
   * 
   * @returns Current rate limit information or null if no data available
   * 
   * @example
   * const rateLimit = client.getRateLimitInfo();
   * if (rateLimit && rateLimit.remaining < 10) {
   *   console.warn(`Low rate limit: ${rateLimit.remaining}/${rateLimit.limit}`);
   * }
   */
  getRateLimitInfo(): RateLimitInfo | null {
    return this.rateLimitInfo;
  }

  /**
   * Returns current circuit breaker state for monitoring and diagnostics
   * 
   * Provides information about failure count, state, and timing for
   * troubleshooting connectivity issues and system health monitoring.
   * 
   * @returns Copy of current circuit breaker state
   * 
   * @example
   * const cbState = client.getCircuitBreakerState();
   * if (cbState.state === 'open') {
   *   console.warn(`Circuit breaker open - ${cbState.failures} failures`);
   * }
   */
  getCircuitBreakerState(): CircuitBreakerState {
    return { ...this.circuitBreaker };
  }

  /**
   * Manually resets the circuit breaker to closed state
   * 
   * Clears failure count and reopens the circuit for API requests.
   * Used for manual recovery after resolving connectivity issues.
   * 
   * @example
   * // After resolving network issues
   * client.resetCircuitBreaker();
   * console.log('Circuit breaker reset - API calls will resume');
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