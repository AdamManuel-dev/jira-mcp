/**
 * @fileoverview GitLab REST API v4 client with OAuth authentication
 * @lastmodified 2025-07-28T02:20:00Z
 * 
 * Features: GitLab OAuth integration, REST API v4, webhook processing, self-hosted support
 * Main APIs: Projects, merge requests, commits, issues, pipelines, webhooks
 * Constraints: Requires GitLab OAuth tokens, supports both SaaS and self-hosted GitLab
 * Patterns: OAuth-based authentication, REST API client, rate limiting, error handling
 */

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { config } from '@/config/environment';
import { cache } from '@/config/redis';
import { logger, logExternalRequest, perf } from '@/utils/logger';
import { ExternalServiceError, AuthenticationError, RateLimitError } from '@/middleware/error-handler';

export interface GitLabProject {
  id: number;
  name: string;
  path: string;
  path_with_namespace: string;
  description?: string;
  default_branch: string;
  web_url: string;
  http_url_to_repo: string;
  created_at: string;
  last_activity_at: string;
  visibility: 'private' | 'internal' | 'public';
  archived: boolean;
  namespace: {
    id: number;
    name: string;
    path: string;
    kind: 'user' | 'group';
  };
  topics: string[];
}

export interface GitLabMergeRequest {
  id: number;
  iid: number;
  title: string;
  description?: string;
  state: 'opened' | 'closed' | 'locked' | 'merged';
  created_at: string;
  updated_at: string;
  merged_at?: string;
  closed_at?: string;
  author: GitLabUser;
  assignees: GitLabUser[];
  reviewers: GitLabUser[];
  source_branch: string;
  target_branch: string;
  merge_status: 'can_be_merged' | 'cannot_be_merged' | 'unchecked';
  draft: boolean;
  work_in_progress: boolean;
  web_url: string;
  changes_count: string;
  user_notes_count: number;
  merge_requests_events?: GitLabMergeRequestEvent[];
}

export interface GitLabCommit {
  id: string;
  short_id: string;
  title: string;
  message: string;
  author_name: string;
  author_email: string;
  authored_date: string;
  committer_name: string;
  committer_email: string;
  committed_date: string;
  web_url: string;
  stats?: {
    additions: number;
    deletions: number;
    total: number;
  };
}

export interface GitLabUser {
  id: number;
  username: string;
  name: string;
  email?: string;
  avatar_url?: string;
  web_url: string;
  state: 'active' | 'blocked';
}

export interface GitLabPipeline {
  id: number;
  status: 'created' | 'waiting_for_resource' | 'preparing' | 'pending' | 'running' | 
          'success' | 'failed' | 'canceled' | 'skipped' | 'manual' | 'scheduled';
  ref: string;
  sha: string;
  web_url: string;
  created_at: string;
  updated_at: string;
  finished_at?: string;
  duration?: number;
}

export interface GitLabIssue {
  id: number;
  iid: number;
  title: string;
  description?: string;
  state: 'opened' | 'closed';
  created_at: string;
  updated_at: string;
  closed_at?: string;
  author: GitLabUser;
  assignees: GitLabUser[];
  labels: string[];
  milestone?: GitLabMilestone;
  web_url: string;
  user_notes_count: number;
}

export interface GitLabMilestone {
  id: number;
  title: string;
  description?: string;
  state: 'active' | 'closed';
  created_at: string;
  updated_at: string;
  due_date?: string;
}

export interface GitLabWebhookEvent {
  object_kind: string;
  event_type?: string;
  user?: GitLabUser;
  project?: GitLabProject;
  object_attributes?: any;
  changes?: Record<string, any>;
  merge_request?: GitLabMergeRequest;
  commit?: GitLabCommit;
  commits?: GitLabCommit[];
  repository?: {
    name: string;
    url: string;
    description?: string;
    homepage: string;
  };
}

export interface GitLabMergeRequestEvent {
  id: number;
  user: GitLabUser;
  created_at: string;
  resource_type: string;
  resource_id: number;
  milestone?: GitLabMilestone;
  action: string;
}

interface GitLabClientConfig {
  organizationId: string;
  userId: string;
  baseUrl?: string; // For self-hosted GitLab
  accessToken: string;
  timeout?: number;
  maxRetries?: number;
}

export class GitLabApiClient {
  private axios: AxiosInstance;
  private config: GitLabClientConfig;
  private baseUrl: string;

  constructor(config: GitLabClientConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || 'https://gitlab.com';
    
    this.axios = axios.create({
      baseURL: `${this.baseUrl}/api/v4`,
      timeout: config.timeout || 30000,
      headers: {
        'Authorization': `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'SIAS-GitLab-Integration/1.0',
      },
    });

    this.setupInterceptors();
  }

  /**
   * Setup request/response interceptors
   */
  private setupInterceptors(): void {
    // Request interceptor
    this.axios.interceptors.request.use(
      (config) => {
        logger.debug('GitLab API request', {
          method: config.method?.toUpperCase(),
          url: config.url,
          params: config.params,
        });
        return config;
      },
      (error) => {
        logger.error('GitLab API request error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.axios.interceptors.response.use(
      (response) => {
        logExternalRequest('GitLab', response.config.method?.toUpperCase() || 'GET', 
                          response.config.url || '', response.status);
        return response;
      },
      (error) => {
        this.handleApiError(error);
        return Promise.reject(error);
      }
    );
  }

  // === PROJECT OPERATIONS ===

  /**
   * List accessible projects
   */
  async listProjects(options: {
    owned?: boolean;
    membership?: boolean;
    starred?: boolean;
    per_page?: number;
  } = {}): Promise<GitLabProject[]> {
    return perf.measureAsync('gitlab.listProjects', async () => {
      try {
        const response = await this.axios.get('/projects', {
          params: {
            owned: options.owned,
            membership: options.membership,
            starred: options.starred,
            per_page: options.per_page || 100,
            simple: true,
          },
        });

        return response.data;
      } catch (error) {
        logger.error('Failed to list GitLab projects:', error);
        throw error;
      }
    });
  }

  /**
   * Get project details
   */
  async getProject(projectId: number | string): Promise<GitLabProject> {
    return perf.measureAsync('gitlab.getProject', async () => {
      try {
        const response = await this.axios.get(`/projects/${encodeURIComponent(projectId)}`);
        return response.data;
      } catch (error) {
        logger.error(`Failed to get GitLab project ${projectId}:`, error);
        throw error;
      }
    });
  }

  // === MERGE REQUEST OPERATIONS ===

  /**
   * List merge requests for a project
   */
  async listMergeRequests(
    projectId: number | string,
    options: {
      state?: 'opened' | 'closed' | 'locked' | 'merged' | 'all';
      order_by?: 'created_at' | 'updated_at';
      sort?: 'asc' | 'desc';
      per_page?: number;
    } = {}
  ): Promise<GitLabMergeRequest[]> {
    return perf.measureAsync('gitlab.listMergeRequests', async () => {
      try {
        const response = await this.axios.get(`/projects/${encodeURIComponent(projectId)}/merge_requests`, {
          params: {
            state: options.state || 'all',
            order_by: options.order_by || 'updated_at',
            sort: options.sort || 'desc',
            per_page: options.per_page || 100,
          },
        });

        return response.data;
      } catch (error) {
        logger.error(`Failed to list merge requests for project ${projectId}:`, error);
        throw error;
      }
    });
  }

  /**
   * Get merge request details
   */
  async getMergeRequest(projectId: number | string, mergeRequestIid: number): Promise<GitLabMergeRequest> {
    return perf.measureAsync('gitlab.getMergeRequest', async () => {
      try {
        const response = await this.axios.get(
          `/projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestIid}`
        );
        return response.data;
      } catch (error) {
        logger.error(`Failed to get merge request ${mergeRequestIid} for project ${projectId}:`, error);
        throw error;
      }
    });
  }

  /**
   * Get merge request commits
   */
  async getMergeRequestCommits(projectId: number | string, mergeRequestIid: number): Promise<GitLabCommit[]> {
    return perf.measureAsync('gitlab.getMergeRequestCommits', async () => {
      try {
        const response = await this.axios.get(
          `/projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestIid}/commits`
        );
        return response.data;
      } catch (error) {
        logger.error(`Failed to get commits for merge request ${mergeRequestIid}:`, error);
        throw error;
      }
    });
  }

  // === COMMIT OPERATIONS ===

  /**
   * List commits for a project
   */
  async listCommits(
    projectId: number | string,
    options: {
      ref_name?: string;
      since?: string;
      until?: string;
      per_page?: number;
    } = {}
  ): Promise<GitLabCommit[]> {
    return perf.measureAsync('gitlab.listCommits', async () => {
      try {
        const response = await this.axios.get(`/projects/${encodeURIComponent(projectId)}/repository/commits`, {
          params: {
            ref_name: options.ref_name,
            since: options.since,
            until: options.until,
            per_page: options.per_page || 100,
          },
        });

        return response.data;
      } catch (error) {
        logger.error(`Failed to list commits for project ${projectId}:`, error);
        throw error;
      }
    });
  }

  /**
   * Get commit details
   */
  async getCommit(projectId: number | string, sha: string): Promise<GitLabCommit> {
    return perf.measureAsync('gitlab.getCommit', async () => {
      try {
        const response = await this.axios.get(
          `/projects/${encodeURIComponent(projectId)}/repository/commits/${sha}`,
          {
            params: {
              stats: true, // Include statistics
            },
          }
        );
        return response.data;
      } catch (error) {
        logger.error(`Failed to get commit ${sha} for project ${projectId}:`, error);
        throw error;
      }
    });
  }

  // === PIPELINE OPERATIONS ===

  /**
   * List pipelines for a project
   */
  async listPipelines(
    projectId: number | string,
    options: {
      status?: string;
      ref?: string;
      per_page?: number;
    } = {}
  ): Promise<GitLabPipeline[]> {
    return perf.measureAsync('gitlab.listPipelines', async () => {
      try {
        const response = await this.axios.get(`/projects/${encodeURIComponent(projectId)}/pipelines`, {
          params: {
            status: options.status,
            ref: options.ref,
            per_page: options.per_page || 100,
          },
        });

        return response.data;
      } catch (error) {
        logger.error(`Failed to list pipelines for project ${projectId}:`, error);
        throw error;
      }
    });
  }

  // === WEBHOOK OPERATIONS ===

  /**
   * Create project webhook
   */
  async createWebhook(
    projectId: number | string,
    webhookUrl: string,
    options: {
      push_events?: boolean;
      merge_requests_events?: boolean;
      issues_events?: boolean;
      pipeline_events?: boolean;
      wiki_page_events?: boolean;
      deployment_events?: boolean;
      job_events?: boolean;
      releases_events?: boolean;
      subgroup_events?: boolean;
      token?: string;
      enable_ssl_verification?: boolean;
    } = {}
  ): Promise<any> {
    return perf.measureAsync('gitlab.createWebhook', async () => {
      try {
        const response = await this.axios.post(`/projects/${encodeURIComponent(projectId)}/hooks`, {
          url: webhookUrl,
          push_events: options.push_events !== false,
          merge_requests_events: options.merge_requests_events !== false,
          issues_events: options.issues_events !== false,
          pipeline_events: options.pipeline_events !== false,
          wiki_page_events: options.wiki_page_events || false,
          deployment_events: options.deployment_events || false,
          job_events: options.job_events || false,
          releases_events: options.releases_events || false,
          subgroup_events: options.subgroup_events || false,
          token: options.token || config.integrations.gitlab.webhookSecret,
          enable_ssl_verification: options.enable_ssl_verification !== false,
        });

        return response.data;
      } catch (error) {
        logger.error(`Failed to create webhook for project ${projectId}:`, error);
        throw error;
      }
    });
  }

  /**
   * List project webhooks
   */
  async listWebhooks(projectId: number | string): Promise<any[]> {
    return perf.measureAsync('gitlab.listWebhooks', async () => {
      try {
        const response = await this.axios.get(`/projects/${encodeURIComponent(projectId)}/hooks`);
        return response.data;
      } catch (error) {
        logger.error(`Failed to list webhooks for project ${projectId}:`, error);
        throw error;
      }
    });
  }

  // === USER OPERATIONS ===

  /**
   * Get current user
   */
  async getCurrentUser(): Promise<GitLabUser> {
    return perf.measureAsync('gitlab.getCurrentUser', async () => {
      try {
        const response = await this.axios.get('/user');
        return response.data;
      } catch (error) {
        logger.error('Failed to get current GitLab user:', error);
        throw error;
      }
    });
  }

  // === HELPER METHODS ===

  private handleApiError(error: any): void {
    if (error.response) {
      const status = error.response.status;
      const message = error.response.data?.message || error.message;

      if (status === 401) {
        logger.error('GitLab authentication error:', message);
        throw new AuthenticationError('GitLab API authentication failed');
      }
      
      if (status === 429) {
        const retryAfter = error.response.headers['retry-after'];
        logger.warn('GitLab rate limit exceeded:', {
          retryAfter: retryAfter ? `${retryAfter} seconds` : 'unknown',
        });
        throw new RateLimitError('GitLab API rate limit exceeded');
      }

      if (status >= 500) {
        logger.error('GitLab server error:', { status, message });
        throw new ExternalServiceError(`GitLab server error: ${message}`);
      }

      logger.error('GitLab API error:', { status, message });
      throw new ExternalServiceError(`GitLab API error: ${message}`);
    }

    logger.error('GitLab network error:', error.message);
    throw new ExternalServiceError(`GitLab network error: ${error.message}`);
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.getCurrentUser();
      return true;
    } catch (error) {
      logger.error('GitLab health check failed:', error);
      return false;
    }
  }

  /**
   * Get API rate limit status
   */
  async getRateLimit(): Promise<{ remaining?: number; reset?: number } | null> {
    try {
      // GitLab doesn't provide rate limit info in headers like GitHub
      // But we can check if we're getting rate limited
      const response = await this.axios.get('/user');
      return {
        remaining: parseInt(String(response.headers['ratelimit-remaining'] || '5000')),
        reset: parseInt(String(response.headers['ratelimit-reset'] || '0')),
      };
    } catch (error) {
      if (error.response?.status === 429) {
        return { remaining: 0, reset: Date.now() + 3600000 }; // 1 hour
      }
      return null;
    }
  }
}