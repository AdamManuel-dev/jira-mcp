/**
 * @fileoverview GitHub REST API v4 and GraphQL client with authentication
 * @lastmodified 2025-07-28T02:00:00Z
 * 
 * Features: GitHub Apps auth, REST API v4, GraphQL v4, webhook processing, enterprise support
 * Main APIs: Repositories, pull requests, commits, issues, actions, webhooks
 * Constraints: Requires GitHub App installation, handles rate limits, supports GitHub Enterprise
 * Patterns: App-based authentication, GraphQL for complex queries, REST for operations
 */

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { Octokit } from '@octokit/rest';
import { graphql } from '@octokit/graphql';
import jwt from 'jsonwebtoken';
import { config } from '@/config/environment';
import { cache } from '@/config/redis';
import { logger, logExternalRequest, perf } from '@/utils/logger';
import { ExternalServiceError, AuthenticationError, RateLimitError } from '@/middleware/error-handler';
import {
  GitHubRepository,
  GitHubPullRequest,
  GitHubCommit,
  GitHubIssue,
  GitHubWebhookEvent,
  GitHubUser,
  GitHubBranch,
  GitHubReview,
  GitHubApp,
  GitHubInstallation,
} from '@/types/github';

interface GitHubClientConfig {
  organizationId: string;
  installationId: string;
  baseUrl?: string; // For GitHub Enterprise
  timeout?: number;
  maxRetries?: number;
}

interface GitHubRateLimit {
  limit: number;
  remaining: number;
  reset: number;
  used: number;
  resource: string;
}

export class GitHubApiClient {
  private octokit: Octokit;
  private graphqlClient: any;
  private config: GitHubClientConfig;
  private installationToken: string | null = null;
  private tokenExpiresAt: number = 0;

  /**
   * Creates a new GitHub API client instance
   * 
   * Initializes REST and GraphQL clients with configuration for GitHub Apps
   * authentication. Supports both GitHub Cloud and Enterprise Server.
   * 
   * @param config - Client configuration including organization and installation IDs
   */
  constructor(config: GitHubClientConfig) {
    this.config = config;
    
    // Initialize Octokit with base configuration
    this.octokit = new Octokit({
      baseUrl: config.baseUrl || 'https://api.github.com',
      timeout: config.timeout || 30000,
      request: {
        retries: config.maxRetries || 3,
      },
    });

    // Initialize GraphQL client
    this.graphqlClient = graphql.defaults({
      baseUrl: config.baseUrl ? `${config.baseUrl}/graphql` : 'https://api.github.com/graphql',
    });
  }

  /**
   * Initializes the client with GitHub App authentication
   * 
   * Generates installation access token and configures both REST and GraphQL
   * clients for authenticated requests. Must be called before using API methods.
   * 
   * @throws {AuthenticationError} When app credentials are invalid or installation not found
   * @throws {ExternalServiceError} When GitHub API is unreachable
   * 
   * @example
   * const client = new GitHubApiClient({ organizationId: 'org1', installationId: '123' });
   * await client.initialize();
   * const repos = await client.listRepositories();
   */
  async initialize(): Promise<void> {
    await this.refreshInstallationToken();
    
    // Update Octokit instance with token
    this.octokit = new Octokit({
      auth: this.installationToken,
      baseUrl: this.config.baseUrl || 'https://api.github.com',
      timeout: this.config.timeout || 30000,
    });

    // Update GraphQL client with token
    this.graphqlClient = this.graphqlClient.defaults({
      headers: {
        authorization: `Bearer ${this.installationToken}`,
      },
    });

    logger.info('GitHub client initialized', {
      organizationId: this.config.organizationId,
      installationId: this.config.installationId,
    });
  }

  /**
   * Generates and caches GitHub App installation access token
   * 
   * Creates JWT using app credentials, exchanges it for installation token,
   * and caches the result with appropriate TTL. Handles token lifecycle
   * automatically including early refresh to prevent expiration.
   * 
   * @throws {AuthenticationError} When app credentials are invalid or installation unauthorized
   * @throws {ExternalServiceError} When GitHub API request fails
   */
  private async refreshInstallationToken(): Promise<void> {
    try {
      // Check if we have a valid cached token
      const cacheKey = `github:token:${this.config.installationId}`;
      const cachedToken = await cache.get(cacheKey);
      
      if (cachedToken && Date.now() < this.tokenExpiresAt) {
        this.installationToken = cachedToken;
        return;
      }

      // Generate JWT for app authentication
      const appJwt = this.generateAppJWT();
      
      // Request installation access token
      const response = await axios.post(
        `${this.config.baseUrl || 'https://api.github.com'}/app/installations/${this.config.installationId}/access_tokens`,
        {},
        {
          headers: {
            'Authorization': `Bearer ${appJwt}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'SIAS-GitHub-Integration/1.0',
          },
        }
      );

      this.installationToken = response.data.token;
      this.tokenExpiresAt = new Date(response.data.expires_at).getTime();
      
      // Cache token with appropriate TTL (expires 10 minutes before actual expiry)
      const ttl = Math.floor((this.tokenExpiresAt - Date.now()) / 1000) - 600;
      await cache.set(cacheKey, this.installationToken, ttl);

      logger.debug('GitHub installation token refreshed', {
        installationId: this.config.installationId,
        expiresAt: response.data.expires_at,
      });

    } catch (error) {
      logger.error('Failed to refresh GitHub installation token:', error);
      throw new AuthenticationError('GitHub authentication failed');
    }
  }

  /**
   * Generates JWT token for GitHub App authentication
   * 
   * Creates short-lived JWT using app's private key for authenticating
   * installation token requests. Token is valid for 10 minutes.
   * 
   * @returns Signed JWT token for GitHub App authentication
   * @throws {Error} When app ID or private key is missing or invalid
   */
  private generateAppJWT(): string {
    const payload = {
      iss: config.integrations.github.appId,
      iat: Math.floor(Date.now() / 1000) - 60, // 1 minute ago
      exp: Math.floor(Date.now() / 1000) + 600, // 10 minutes from now
    };

    return jwt.sign(payload, config.integrations.github.privateKey, { algorithm: 'RS256' });
  }

  /**
   * Ensures client has valid authentication token before API requests
   * 
   * Checks token expiration and refreshes proactively (5 minutes early)
   * to prevent authentication failures during API calls.
   * 
   * @throws {AuthenticationError} When token refresh fails
   */
  private async ensureValidToken(): Promise<void> {
    if (!this.installationToken || Date.now() >= this.tokenExpiresAt - 300000) { // Refresh 5 min early
      await this.refreshInstallationToken();
    }
  }

  // === REPOSITORY OPERATIONS ===

  /**
   * Retrieves all repositories accessible to the GitHub App installation
   * 
   * Lists repositories the app has been granted access to, including
   * repository metadata, permissions, and configuration details.
   * 
   * @returns Array of repositories with metadata and access permissions
   * @throws {AuthenticationError} When installation token is invalid
   * @throws {ExternalServiceError} When GitHub API request fails
   * 
   * @example
   * const repos = await client.listRepositories();
   * console.log(`Found ${repos.length} accessible repositories`);
   * const publicRepos = repos.filter(repo => !repo.private);
   */
  async listRepositories(): Promise<GitHubRepository[]> {
    return perf.measureAsync('github.listRepositories', async () => {
      await this.ensureValidToken();
      
      try {
        const response = await this.octokit.apps.listReposAccessibleToInstallation({
          per_page: 100,
        });

        logExternalRequest('GitHub', 'GET', '/installation/repositories', response.status);

        return response.data.repositories.map(repo => this.mapRepository(repo));
      } catch (error) {
        this.handleApiError(error, 'listRepositories');
        throw error;
      }
    });
  }

  /**
   * Get repository details
   */
  async getRepository(owner: string, repo: string): Promise<GitHubRepository> {
    return perf.measureAsync('github.getRepository', async () => {
      await this.ensureValidToken();
      
      try {
        const response = await this.octokit.repos.get({ owner, repo });
        logExternalRequest('GitHub', 'GET', `/repos/${owner}/${repo}`, response.status);
        
        return this.mapRepository(response.data);
      } catch (error) {
        this.handleApiError(error, 'getRepository');
        throw error;
      }
    });
  }

  // === PULL REQUEST OPERATIONS ===

  /**
   * List pull requests for a repository
   */
  async listPullRequests(
    owner: string, 
    repo: string, 
    options: { state?: 'open' | 'closed' | 'all'; per_page?: number } = {}
  ): Promise<GitHubPullRequest[]> {
    return perf.measureAsync('github.listPullRequests', async () => {
      await this.ensureValidToken();
      
      try {
        const response = await this.octokit.pulls.list({
          owner,
          repo,
          state: options.state || 'all',
          per_page: options.per_page || 100,
        });

        logExternalRequest('GitHub', 'GET', `/repos/${owner}/${repo}/pulls`, response.status);

        return response.data.map(pr => this.mapPullRequest(pr));
      } catch (error) {
        this.handleApiError(error, 'listPullRequests');
        throw error;
      }
    });
  }

  /**
   * Get pull request details with commits and reviews
   */
  async getPullRequest(owner: string, repo: string, pullNumber: number): Promise<GitHubPullRequest> {
    return perf.measureAsync('github.getPullRequest', async () => {
      await this.ensureValidToken();
      
      try {
        // Use GraphQL for efficient data fetching
        const query = `
          query GetPullRequest($owner: String!, $repo: String!, $number: Int!) {
            repository(owner: $owner, name: $repo) {
              pullRequest(number: $number) {
                id
                number
                title
                body
                state
                createdAt
                updatedAt
                mergedAt
                closedAt
                merged
                mergeable
                author {
                  login
                  ... on User {
                    name
                    email
                  }
                }
                baseRefName
                headRefName
                commits(first: 100) {
                  nodes {
                    commit {
                      oid
                      message
                      author {
                        name
                        email
                        date
                      }
                    }
                  }
                }
                reviews(first: 50) {
                  nodes {
                    id
                    state
                    author {
                      login
                    }
                    createdAt
                    body
                  }
                }
                reviewRequests(first: 20) {
                  nodes {
                    requestedReviewer {
                      ... on User {
                        login
                        name
                      }
                    }
                  }
                }
              }
            }
          }
        `;

        const response = await this.graphqlClient(query, {
          owner,
          repo,
          number: pullNumber,
        });

        logExternalRequest('GitHub', 'POST', '/graphql', 200);

        if (!response.repository?.pullRequest) {
          throw new Error(`Pull request #${pullNumber} not found`);
        }

        return this.mapGraphQLPullRequest(response.repository.pullRequest);
      } catch (error) {
        this.handleApiError(error, 'getPullRequest');
        throw error;
      }
    });
  }

  // === COMMIT OPERATIONS ===

  /**
   * List commits for a repository
   */
  async listCommits(
    owner: string, 
    repo: string, 
    options: { since?: string; until?: string; per_page?: number } = {}
  ): Promise<GitHubCommit[]> {
    return perf.measureAsync('github.listCommits', async () => {
      await this.ensureValidToken();
      
      try {
        const response = await this.octokit.repos.listCommits({
          owner,
          repo,
          since: options.since,
          until: options.until,
          per_page: options.per_page || 100,
        });

        logExternalRequest('GitHub', 'GET', `/repos/${owner}/${repo}/commits`, response.status);

        return response.data.map(commit => this.mapCommit(commit));
      } catch (error) {
        this.handleApiError(error, 'listCommits');
        throw error;
      }
    });
  }

  /**
   * Get commit details
   */
  async getCommit(owner: string, repo: string, sha: string): Promise<GitHubCommit> {
    return perf.measureAsync('github.getCommit', async () => {
      await this.ensureValidToken();
      
      try {
        const response = await this.octokit.repos.getCommit({ owner, repo, ref: sha });
        logExternalRequest('GitHub', 'GET', `/repos/${owner}/${repo}/commits/${sha}`, response.status);
        
        return this.mapCommit(response.data);
      } catch (error) {
        this.handleApiError(error, 'getCommit');
        throw error;
      }
    });
  }

  // === WEBHOOK OPERATIONS ===

  /**
   * Create webhook for repository
   */
  async createWebhook(
    owner: string, 
    repo: string, 
    webhookUrl: string, 
    events: string[] = ['push', 'pull_request', 'issues']
  ): Promise<any> {
    return perf.measureAsync('github.createWebhook', async () => {
      await this.ensureValidToken();
      
      try {
        const response = await this.octokit.repos.createWebhook({
          owner,
          repo,
          config: {
            url: webhookUrl,
            content_type: 'json',
            secret: config.integrations.github.webhookSecret,
          },
          events,
          active: true,
        });

        logExternalRequest('GitHub', 'POST', `/repos/${owner}/${repo}/hooks`, response.status);

        return response.data;
      } catch (error) {
        this.handleApiError(error, 'createWebhook');
        throw error;
      }
    });
  }

  // === HELPER METHODS ===

  private mapRepository(repo: any): GitHubRepository {
    return {
      id: repo.id.toString(),
      name: repo.name,
      full_name: repo.full_name,
      owner: {
        login: repo.owner.login,
        type: repo.owner.type,
      },
      private: repo.private,
      html_url: repo.html_url,
      clone_url: repo.clone_url,
      default_branch: repo.default_branch,
      created_at: repo.created_at,
      updated_at: repo.updated_at,
      pushed_at: repo.pushed_at,
      language: repo.language,
      topics: repo.topics || [],
      archived: repo.archived,
      disabled: repo.disabled,
    };
  }

  private mapPullRequest(pr: any): GitHubPullRequest {
    return {
      id: pr.id.toString(),
      number: pr.number,
      title: pr.title,
      body: pr.body,
      state: pr.state,
      created_at: pr.created_at,
      updated_at: pr.updated_at,
      merged_at: pr.merged_at,
      closed_at: pr.closed_at,
      merged: pr.merged,
      mergeable: pr.mergeable,
      author: pr.user ? {
        login: pr.user.login,
        name: pr.user.name,
        email: pr.user.email,
      } : null,
      base: {
        ref: pr.base.ref,
        sha: pr.base.sha,
        repo: this.mapRepository(pr.base.repo),
      },
      head: {
        ref: pr.head.ref,
        sha: pr.head.sha,
        repo: pr.head.repo ? this.mapRepository(pr.head.repo) : null,
      },
      commits: [],
      reviews: [],
    };
  }

  private mapGraphQLPullRequest(pr: any): GitHubPullRequest {
    return {
      id: pr.id,
      number: pr.number,
      title: pr.title,
      body: pr.body,
      state: pr.state.toLowerCase(),
      created_at: pr.createdAt,
      updated_at: pr.updatedAt,
      merged_at: pr.mergedAt,
      closed_at: pr.closedAt,
      merged: pr.merged,
      mergeable: pr.mergeable,
      author: pr.author ? {
        login: pr.author.login,
        name: pr.author.name,
        email: pr.author.email,
      } : null,
      base: {
        ref: pr.baseRefName,
        sha: '',
        repo: null,
      },
      head: {
        ref: pr.headRefName,
        sha: '',
        repo: null,
      },
      commits: pr.commits.nodes.map((node: any) => ({
        sha: node.commit.oid,
        message: node.commit.message,
        author: {
          name: node.commit.author.name,
          email: node.commit.author.email,
          date: node.commit.author.date,
        },
      })),
      reviews: pr.reviews.nodes.map((review: any) => ({
        id: review.id,
        state: review.state,
        author: review.author?.login,
        created_at: review.createdAt,
        body: review.body,
      })),
    };
  }

  private mapCommit(commit: any): GitHubCommit {
    return {
      sha: commit.sha,
      message: commit.commit.message,
      author: {
        name: commit.commit.author.name,
        email: commit.commit.author.email,
        date: commit.commit.author.date,
      },
      committer: {
        name: commit.commit.committer.name,
        email: commit.commit.committer.email,
        date: commit.commit.committer.date,
      },
      url: commit.html_url,
      stats: commit.stats ? {
        additions: commit.stats.additions,
        deletions: commit.stats.deletions,
        total: commit.stats.total,
      } : undefined,
    };
  }

  private handleApiError(error: any, operation: string): void {
    if (error.status === 401 || error.status === 403) {
      logger.error(`GitHub authentication error in ${operation}:`, error);
      throw new AuthenticationError('GitHub API authentication failed');
    }
    
    if (error.status === 429) {
      const resetTime = error.response?.headers['x-ratelimit-reset'];
      logger.warn(`GitHub rate limit exceeded in ${operation}:`, {
        resetTime: resetTime ? new Date(resetTime * 1000) : 'unknown',
      });
      throw new RateLimitError('GitHub API rate limit exceeded');
    }

    logger.error(`GitHub API error in ${operation}:`, error);
    throw new ExternalServiceError(`GitHub API error: ${error.message}`);
  }

  /**
   * Get current rate limit status
   */
  async getRateLimit(): Promise<GitHubRateLimit> {
    await this.ensureValidToken();
    
    const response = await this.octokit.rateLimit.get();
    return {
      limit: response.data.rate.limit,
      remaining: response.data.rate.remaining,
      reset: response.data.rate.reset,
      used: response.data.rate.used,
      resource: 'core',
    };
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.ensureValidToken();
      const rateLimit = await this.getRateLimit();
      return rateLimit.remaining > 0;
    } catch (error) {
      logger.error('GitHub health check failed:', error);
      return false;
    }
  }
}