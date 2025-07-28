/**
 * @fileoverview Bitbucket REST API v2 client with OAuth authentication
 * @lastmodified 2025-07-28T02:25:00Z
 * 
 * Features: Bitbucket OAuth integration, REST API v2, webhook processing, Cloud and Server support
 * Main APIs: Repositories, pull requests, commits, issues, pipelines, webhooks
 * Constraints: Requires Bitbucket OAuth tokens, supports both Cloud and Server/Data Center
 * Patterns: OAuth-based authentication, REST API client, rate limiting, pagination
 */

import axios, { AxiosInstance } from 'axios';
import { config } from '@/config/environment';
import { cache } from '@/config/redis';
import { logger, logExternalRequest, perf } from '@/utils/logger';
import { ExternalServiceError, AuthenticationError, RateLimitError } from '@/middleware/error-handler';

export interface BitbucketRepository {
  uuid: string;
  name: string;
  full_name: string;
  description?: string;
  is_private: boolean;
  created_on: string;
  updated_on: string;
  size: number;
  language?: string;
  mainbranch?: {
    name: string;
  };
  owner: BitbucketUser;
  project?: {
    key: string;
    name: string;
  };
  links: {
    clone: Array<{
      name: string;
      href: string;
    }>;
    html: {
      href: string;
    };
  };
}

export interface BitbucketPullRequest {
  id: number;
  title: string;
  description?: string;
  state: 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED';
  created_on: string;
  updated_on: string;
  merge_commit?: {
    hash: string;
  };
  close_source_branch?: boolean;
  author: BitbucketUser;
  reviewers: BitbucketUser[];
  participants: Array<{
    user: BitbucketUser;
    role: string;
    approved: boolean;
    participated_on?: string;
  }>;
  source: {
    branch: {
      name: string;
    };
    commit: {
      hash: string;
    };
    repository: BitbucketRepository;
  };
  destination: {
    branch: {
      name: string;
    };
    commit: {
      hash: string;
    };
    repository: BitbucketRepository;
  };
  links: {
    html: {
      href: string;
    };
    commits: {
      href: string;
    };
  };
}

export interface BitbucketCommit {
  hash: string;
  message: string;
  date: string;
  author: {
    raw: string;
    user?: BitbucketUser;
  };
  parents: Array<{
    hash: string;
  }>;
  links: {
    html: {
      href: string;
    };
  };
}

export interface BitbucketUser {
  uuid: string;
  username?: string;
  display_name: string;
  account_id?: string;
  nickname?: string;
  type: 'user' | 'team';
  links: {
    avatar: {
      href: string;
    };
    html: {
      href: string;
    };
  };
}

export interface BitbucketWebhookEvent {
  repository: BitbucketRepository;
  actor: BitbucketUser;
  push?: {
    changes: Array<{
      old?: {
        name: string;
        type: string;
        target: {
          hash: string;
        };
      };
      new?: {
        name: string;
        type: string;
        target: {
          hash: string;
        };
      };
      created: boolean;
      closed: boolean;
      forced: boolean;
      commits: BitbucketCommit[];
    }>;
  };
  pullrequest?: BitbucketPullRequest;
}

interface BitbucketClientConfig {
  organizationId: string;
  userId: string;
  workspace: string;
  baseUrl?: string; // For Bitbucket Server
  accessToken: string;
  refreshToken?: string;
  timeout?: number;
}

export class BitbucketApiClient {
  private axios: AxiosInstance;
  private config: BitbucketClientConfig;
  private baseUrl: string;

  constructor(config: BitbucketClientConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || 'https://api.bitbucket.org/2.0';
    
    this.axios = axios.create({
      baseURL: this.baseUrl,
      timeout: config.timeout || 30000,
      headers: {
        'Authorization': `Bearer ${config.accessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'SIAS-Bitbucket-Integration/1.0',
      },
    });

    this.setupInterceptors();
  }

  /**
   * Setup request/response interceptors
   */
  private setupInterceptors(): void {
    this.axios.interceptors.request.use(
      (config) => {
        logger.debug('Bitbucket API request', {
          method: config.method?.toUpperCase(),
          url: config.url,
        });
        return config;
      }
    );

    this.axios.interceptors.response.use(
      (response) => {
        logExternalRequest('Bitbucket', response.config.method?.toUpperCase() || 'GET', 
                          response.config.url || '', response.status);
        return response;
      },
      (error) => {
        this.handleApiError(error);
        return Promise.reject(error);
      }
    );
  }

  // === REPOSITORY OPERATIONS ===

  /**
   * List repositories for workspace
   */
  async listRepositories(): Promise<BitbucketRepository[]> {
    return perf.measureAsync('bitbucket.listRepositories', async () => {
      try {
        const response = await this.axios.get(`/repositories/${this.config.workspace}`, {
          params: {
            pagelen: 100,
            sort: '-updated_on',
          },
        });

        return response.data.values || [];
      } catch (error) {
        logger.error('Failed to list Bitbucket repositories:', error);
        throw error;
      }
    });
  }

  /**
   * Get repository details
   */
  async getRepository(repoSlug: string): Promise<BitbucketRepository> {
    return perf.measureAsync('bitbucket.getRepository', async () => {
      try {
        const response = await this.axios.get(`/repositories/${this.config.workspace}/${repoSlug}`);
        return response.data;
      } catch (error) {
        logger.error(`Failed to get Bitbucket repository ${repoSlug}:`, error);
        throw error;
      }
    });
  }

  // === PULL REQUEST OPERATIONS ===

  /**
   * List pull requests for repository
   */
  async listPullRequests(
    repoSlug: string,
    options: {
      state?: 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED';
      pagelen?: number;
    } = {}
  ): Promise<BitbucketPullRequest[]> {
    return perf.measureAsync('bitbucket.listPullRequests', async () => {
      try {
        const response = await this.axios.get(
          `/repositories/${this.config.workspace}/${repoSlug}/pullrequests`,
          {
            params: {
              state: options.state,
              pagelen: options.pagelen || 50,
              sort: '-updated_on',
            },
          }
        );

        return response.data.values || [];
      } catch (error) {
        logger.error(`Failed to list pull requests for ${repoSlug}:`, error);
        throw error;
      }
    });
  }

  /**
   * Get pull request details
   */
  async getPullRequest(repoSlug: string, pullRequestId: number): Promise<BitbucketPullRequest> {
    return perf.measureAsync('bitbucket.getPullRequest', async () => {
      try {
        const response = await this.axios.get(
          `/repositories/${this.config.workspace}/${repoSlug}/pullrequests/${pullRequestId}`
        );
        return response.data;
      } catch (error) {
        logger.error(`Failed to get pull request ${pullRequestId} for ${repoSlug}:`, error);
        throw error;
      }
    });
  }

  /**
   * Get pull request commits
   */
  async getPullRequestCommits(repoSlug: string, pullRequestId: number): Promise<BitbucketCommit[]> {
    return perf.measureAsync('bitbucket.getPullRequestCommits', async () => {
      try {
        const response = await this.axios.get(
          `/repositories/${this.config.workspace}/${repoSlug}/pullrequests/${pullRequestId}/commits`
        );
        return response.data.values || [];
      } catch (error) {
        logger.error(`Failed to get commits for pull request ${pullRequestId}:`, error);
        throw error;
      }
    });
  }

  // === COMMIT OPERATIONS ===

  /**
   * List commits for repository
   */
  async listCommits(
    repoSlug: string,
    options: {
      include?: string; // Branch name
      exclude?: string;
      pagelen?: number;
    } = {}
  ): Promise<BitbucketCommit[]> {
    return perf.measureAsync('bitbucket.listCommits', async () => {
      try {
        const response = await this.axios.get(
          `/repositories/${this.config.workspace}/${repoSlug}/commits`,
          {
            params: {
              include: options.include,
              exclude: options.exclude,
              pagelen: options.pagelen || 50,
            },
          }
        );

        return response.data.values || [];
      } catch (error) {
        logger.error(`Failed to list commits for ${repoSlug}:`, error);
        throw error;
      }
    });
  }

  /**
   * Get commit details
   */
  async getCommit(repoSlug: string, commitHash: string): Promise<BitbucketCommit> {
    return perf.measureAsync('bitbucket.getCommit', async () => {
      try {
        const response = await this.axios.get(
          `/repositories/${this.config.workspace}/${repoSlug}/commit/${commitHash}`
        );
        return response.data;
      } catch (error) {
        logger.error(`Failed to get commit ${commitHash} for ${repoSlug}:`, error);
        throw error;
      }
    });
  }

  // === WEBHOOK OPERATIONS ===

  /**
   * Create repository webhook
   */
  async createWebhook(
    repoSlug: string,
    webhookUrl: string,
    events: string[] = ['repo:push', 'pullrequest:created', 'pullrequest:updated', 'pullrequest:approved', 'pullrequest:fulfilled']
  ): Promise<any> {
    return perf.measureAsync('bitbucket.createWebhook', async () => {
      try {
        const response = await this.axios.post(
          `/repositories/${this.config.workspace}/${repoSlug}/hooks`,
          {
            description: 'SIAS Integration Webhook',
            url: webhookUrl,
            active: true,
            events,
          }
        );

        return response.data;
      } catch (error) {
        logger.error(`Failed to create webhook for ${repoSlug}:`, error);
        throw error;
      }
    });
  }

  /**
   * List repository webhooks
   */
  async listWebhooks(repoSlug: string): Promise<any[]> {
    return perf.measureAsync('bitbucket.listWebhooks', async () => {
      try {
        const response = await this.axios.get(
          `/repositories/${this.config.workspace}/${repoSlug}/hooks`
        );
        return response.data.values || [];
      } catch (error) {
        logger.error(`Failed to list webhooks for ${repoSlug}:`, error);
        throw error;
      }
    });
  }

  // === USER OPERATIONS ===

  /**
   * Get current user
   */
  async getCurrentUser(): Promise<BitbucketUser> {
    return perf.measureAsync('bitbucket.getCurrentUser', async () => {
      try {
        const response = await this.axios.get('/user');
        return response.data;
      } catch (error) {
        logger.error('Failed to get current Bitbucket user:', error);
        throw error;
      }
    });
  }

  // === WORKSPACE OPERATIONS ===

  /**
   * Get workspace details
   */
  async getWorkspace(): Promise<any> {
    return perf.measureAsync('bitbucket.getWorkspace', async () => {
      try {
        const response = await this.axios.get(`/workspaces/${this.config.workspace}`);
        return response.data;
      } catch (error) {
        logger.error(`Failed to get workspace ${this.config.workspace}:`, error);
        throw error;
      }
    });
  }

  // === HELPER METHODS ===

  private handleApiError(error: any): void {
    if (error.response) {
      const status = error.response.status;
      const message = error.response.data?.error?.message || error.message;

      if (status === 401) {
        logger.error('Bitbucket authentication error:', message);
        throw new AuthenticationError('Bitbucket API authentication failed');
      }
      
      if (status === 429) {
        logger.warn('Bitbucket rate limit exceeded');
        throw new RateLimitError('Bitbucket API rate limit exceeded');
      }

      if (status >= 500) {
        logger.error('Bitbucket server error:', { status, message });
        throw new ExternalServiceError(`Bitbucket server error: ${message}`);
      }

      logger.error('Bitbucket API error:', { status, message });
      throw new ExternalServiceError(`Bitbucket API error: ${message}`);
    }

    logger.error('Bitbucket network error:', error.message);
    throw new ExternalServiceError(`Bitbucket network error: ${error.message}`);
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.getCurrentUser();
      return true;
    } catch (error) {
      logger.error('Bitbucket health check failed:', error);
      return false;
    }
  }

  /**
   * Refresh access token if needed
   */
  async refreshAccessToken(): Promise<string | null> {
    if (!this.config.refreshToken) {
      return null;
    }

    try {
      const response = await axios.post('https://bitbucket.org/site/oauth2/access_token', 
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.config.refreshToken,
        }), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${Buffer.from(`${config.integrations.bitbucket.clientId}:${config.integrations.bitbucket.clientSecret}`).toString('base64')}`,
          },
        }
      );

      const newAccessToken = response.data.access_token;
      this.config.accessToken = newAccessToken;
      
      // Update axios headers
      this.axios.defaults.headers['Authorization'] = `Bearer ${newAccessToken}`;

      // Cache the new token
      await cache.set(
        `bitbucket:token:${this.config.organizationId}:${this.config.userId}`,
        newAccessToken,
        response.data.expires_in || 3600
      );

      logger.info('Bitbucket access token refreshed');
      return newAccessToken;

    } catch (error) {
      logger.error('Failed to refresh Bitbucket access token:', error);
      throw new AuthenticationError('Failed to refresh Bitbucket access token');
    }
  }
}