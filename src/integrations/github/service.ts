/**
 * @fileoverview GitHub integration service combining API client and webhook processing
 * @lastmodified 2025-07-28T02:15:00Z
 * 
 * Features: GitHub Apps integration, repository sync, webhook management, artifact tracking
 * Main APIs: Repository management, sync operations, webhook setup, commit/PR tracking
 * Constraints: Requires GitHub App installation, manages multiple repositories per organization
 * Patterns: Service facade, repository pooling, configuration management, sync scheduling
 */

import { BaseService } from '@/services';
import { query, transaction } from '@/database/connection';
import { cache } from '@/config/redis';
import { logger, perf } from '@/utils/logger';
import { GitHubApiClient } from './client';
import { GitHubWebhookService } from './webhook';
import {
  GitHubRepository,
  GitHubPullRequest,
  GitHubCommit,
  GitHubIntegrationConfig,
} from '@/types/github';

interface GitHubSyncResult {
  success: boolean;
  stats: {
    repositoriesCreated: number;
    repositoriesUpdated: number;
    commitsCreated: number;
    commitsUpdated: number;
    pullRequestsCreated: number;
    pullRequestsUpdated: number;
    errors: number;
  };
  errors: string[];
}

export class GitHubIntegrationService extends BaseService {
  private clients: Map<string, GitHubApiClient> = new Map();
  private webhookService: GitHubWebhookService;
  private syncIntervals: Map<string, NodeJS.Timeout> = new Map();

  async initialize(): Promise<void> {
    // Initialize webhook service
    this.webhookService = new GitHubWebhookService();
    await this.webhookService.initialize();
    
    // Load and initialize GitHub integrations
    await this.loadIntegrations();
    
    this.logger.info('GitHub Integration Service initialized', {
      clientCount: this.clients.size,
    });
  }

  /**
   * Setup GitHub integration for an organization
   */
  async setupIntegration(config: GitHubIntegrationConfig): Promise<void> {
    return perf.measureAsync('github.setupIntegration', async () => {
      try {
        // Create API client
        const client = new GitHubApiClient({
          organizationId: config.organizationId,
          installationId: config.installationId,
          baseUrl: config.baseUrl,
        });

        await client.initialize();
        this.clients.set(config.id, client);

        // Store integration configuration
        await this.storeIntegrationConfig(config);

        // Setup initial sync
        await this.performInitialSync(config.id);

        // Setup webhook endpoints for repositories
        await this.setupRepositoryWebhooks(config.id);

        // Schedule periodic sync
        this.scheduleSync(config.id, config.settings.syncInterval);

        this.logger.info('GitHub integration setup completed', {
          integrationId: config.id,
          organizationId: config.organizationId,
          installationId: config.installationId,
        });

      } catch (error) {
        this.logger.error('Failed to setup GitHub integration:', error);
        throw error;
      }
    });
  }

  /**
   * Perform initial sync of repositories and data
   */
  private async performInitialSync(integrationId: string): Promise<GitHubSyncResult> {
    return perf.measureAsync('github.initialSync', async () => {
      const client = this.clients.get(integrationId);
      if (!client) {
        throw new Error(`GitHub client not found for integration ${integrationId}`);
      }

      const result: GitHubSyncResult = {
        success: true,
        stats: {
          repositoriesCreated: 0,
          repositoriesUpdated: 0,
          commitsCreated: 0,
          commitsUpdated: 0,
          pullRequestsCreated: 0,
          pullRequestsUpdated: 0,
          errors: 0,
        },
        errors: [],
      };

      try {
        // Fetch all accessible repositories
        const repositories = await client.listRepositories();
        this.logger.info(`Found ${repositories.length} repositories for sync`);

        for (const repo of repositories) {
          try {
            // Store/update repository
            const wasCreated = await this.syncRepository(repo, integrationId);
            if (wasCreated) {
              result.stats.repositoriesCreated++;
            } else {
              result.stats.repositoriesUpdated++;
            }

            // Sync recent commits (last 30 days)
            const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
            const commits = await client.listCommits(repo.owner.login, repo.name, { since });
            
            for (const commit of commits) {
              const wasCreated = await this.syncCommit(commit, repo.id, integrationId);
              if (wasCreated) {
                result.stats.commitsCreated++;
              } else {
                result.stats.commitsUpdated++;
              }
            }

            // Sync open pull requests
            const pullRequests = await client.listPullRequests(
              repo.owner.login, 
              repo.name, 
              { state: 'open' }
            );
            
            for (const pr of pullRequests) {
              const wasCreated = await this.syncPullRequest(pr, repo.id, integrationId);
              if (wasCreated) {
                result.stats.pullRequestsCreated++;
              } else {
                result.stats.pullRequestsUpdated++;
              }
            }

          } catch (error) {
            this.logger.error(`Failed to sync repository ${repo.full_name}:`, error);
            result.stats.errors++;
            result.errors.push(`${repo.full_name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }

        this.logger.info('Initial GitHub sync completed', result.stats);
        return result;

      } catch (error) {
        this.logger.error('Initial GitHub sync failed:', error);
        result.success = false;
        result.errors.push(error instanceof Error ? error.message : 'Unknown error');
        return result;
      }
    });
  }

  /**
   * Sync repository data to database
   */
  private async syncRepository(repo: GitHubRepository, integrationId: string): Promise<boolean> {
    const result = await query(
      `INSERT INTO repositories (
        integration_id, external_id, name, full_name, clone_url, 
        default_branch, is_active, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (integration_id, external_id) 
      DO UPDATE SET
        name = EXCLUDED.name,
        full_name = EXCLUDED.full_name,
        clone_url = EXCLUDED.clone_url,
        default_branch = EXCLUDED.default_branch,
        updated_at = EXCLUDED.updated_at
      RETURNING (xmax = 0) AS was_created`,
      [
        integrationId,
        repo.id,
        repo.name,
        repo.full_name,
        repo.clone_url,
        repo.default_branch,
        !repo.archived && !repo.disabled,
        repo.created_at,
        repo.updated_at,
      ]
    );

    return result[0]?.was_created === true;
  }

  /**
   * Sync commit data to database
   */
  private async syncCommit(commit: GitHubCommit, repositoryId: string, integrationId: string): Promise<boolean> {
    // Extract ticket references from commit message
    const ticketPattern = /([A-Z]{2,}-\d+)/g;
    const ticketReferences = commit.message.match(ticketPattern) || [];

    const result = await query(
      `INSERT INTO commits (
        repository_id, sha, message, author_email, author_name, 
        committed_at, ticket_references, created_at
      ) VALUES (
        (SELECT id FROM repositories WHERE external_id = $1 AND integration_id = $2),
        $3, $4, $5, $6, $7, $8, NOW()
      )
      ON CONFLICT (repository_id, sha) 
      DO UPDATE SET
        message = EXCLUDED.message,
        author_email = EXCLUDED.author_email,
        author_name = EXCLUDED.author_name,
        ticket_references = EXCLUDED.ticket_references,
        updated_at = NOW()
      RETURNING (xmax = 0) AS was_created`,
      [
        repositoryId,
        integrationId,
        commit.sha,
        commit.message,
        commit.author.email,
        commit.author.name,
        commit.author.date,
        ticketReferences,
      ]
    );

    return result[0]?.was_created === true;
  }

  /**
   * Sync pull request data to database
   */
  private async syncPullRequest(pr: GitHubPullRequest, repositoryId: string, integrationId: string): Promise<boolean> {
    // Extract ticket references from PR title and body
    const ticketPattern = /([A-Z]{2,}-\d+)/g;
    const prText = `${pr.title} ${pr.body || ''}`;
    const ticketReferences = prText.match(ticketPattern) || [];

    const result = await query(
      `INSERT INTO pull_requests (
        repository_id, external_id, number, title, description, state,
        author_id, base_branch, head_branch, merged_at, closed_at,
        ticket_references, created_at, updated_at
      ) VALUES (
        (SELECT id FROM repositories WHERE external_id = $1 AND integration_id = $2),
        $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
      )
      ON CONFLICT (repository_id, external_id) 
      DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        state = EXCLUDED.state,
        merged_at = EXCLUDED.merged_at,
        closed_at = EXCLUDED.closed_at,
        ticket_references = EXCLUDED.ticket_references,
        updated_at = EXCLUDED.updated_at
      RETURNING (xmax = 0) AS was_created`,
      [
        repositoryId,
        integrationId,
        pr.id,
        pr.number,
        pr.title,
        pr.body,
        pr.state,
        pr.author?.login, // Would need user mapping
        pr.base.ref,
        pr.head.ref,
        pr.merged_at,
        pr.closed_at,
        ticketReferences,
        pr.created_at,
        pr.updated_at,
      ]
    );

    return result[0]?.was_created === true;
  }

  /**
   * Setup webhooks for repositories
   */
  private async setupRepositoryWebhooks(integrationId: string): Promise<void> {
    const client = this.clients.get(integrationId);
    if (!client) return;

    try {
      // Get repositories for this integration
      const repositories = await query(
        `SELECT * FROM repositories WHERE integration_id = $1 AND is_active = true`,
        [integrationId]
      );

      for (const repo of repositories) {
        try {
          const [owner, repoName] = repo.full_name.split('/');
          const webhookUrl = `${process.env.WEBHOOK_BASE_URL}/webhooks/github`;
          
          const webhook = await client.createWebhook(
            owner,
            repoName,
            webhookUrl,
            ['push', 'pull_request', 'pull_request_review', 'issues', 'issue_comment']
          );

          // Store webhook configuration
          await query(
            `INSERT INTO github_webhooks (
              integration_id, repository_id, webhook_id, webhook_url, 
              events, secret, is_active, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
            ON CONFLICT (repository_id) 
            DO UPDATE SET webhook_id = EXCLUDED.webhook_id, updated_at = NOW()`,
            [
              integrationId,
              repo.id,
              webhook.id.toString(),
              webhookUrl,
              JSON.stringify(webhook.events),
              webhook.config.secret,
              true,
            ]
          );

          this.logger.debug('Webhook created for repository', {
            repository: repo.full_name,
            webhookId: webhook.id,
          });

        } catch (error) {
          this.logger.error(`Failed to setup webhook for ${repo.full_name}:`, error);
        }
      }

    } catch (error) {
      this.logger.error('Failed to setup repository webhooks:', error);
    }
  }

  /**
   * Schedule periodic sync for integration
   */
  private scheduleSync(integrationId: string, intervalMinutes: number): void {
    // Clear existing interval if any
    const existingInterval = this.syncIntervals.get(integrationId);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

    // Setup new interval
    const interval = setInterval(async () => {
      try {
        await this.performIncrementalSync(integrationId);
      } catch (error) {
        this.logger.error(`Scheduled sync failed for integration ${integrationId}:`, error);
      }
    }, intervalMinutes * 60 * 1000);

    this.syncIntervals.set(integrationId, interval);

    this.logger.debug('Scheduled sync setup', {
      integrationId,
      intervalMinutes,
    });
  }

  /**
   * Perform incremental sync (recent changes only)
   */
  private async performIncrementalSync(integrationId: string): Promise<GitHubSyncResult> {
    return perf.measureAsync('github.incrementalSync', async () => {
      const client = this.clients.get(integrationId);
      if (!client) {
        throw new Error(`GitHub client not found for integration ${integrationId}`);
      }

      const result: GitHubSyncResult = {
        success: true,
        stats: {
          repositoriesCreated: 0,
          repositoriesUpdated: 0,
          commitsCreated: 0,
          commitsUpdated: 0,
          pullRequestsCreated: 0,
          pullRequestsUpdated: 0,
          errors: 0,
        },
        errors: [],
      };

      try {
        // Get last sync time
        const lastSyncResult = await query(
          `SELECT last_sync_at FROM integration_sync_status 
           WHERE integration_id = $1`,
          [integrationId]
        );

        const since = lastSyncResult[0]?.last_sync_at || 
          new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24 hours if no previous sync

        // Get repositories for this integration
        const repositories = await query(
          `SELECT * FROM repositories WHERE integration_id = $1 AND is_active = true`,
          [integrationId]
        );

        for (const repo of repositories) {
          try {
            const [owner, repoName] = repo.full_name.split('/');

            // Sync recent commits
            const commits = await client.listCommits(owner, repoName, { 
              since: since.toISOString(),
              per_page: 100,
            });

            for (const commit of commits) {
              const wasCreated = await this.syncCommit(commit, repo.external_id, integrationId);
              if (wasCreated) {
                result.stats.commitsCreated++;
              } else {
                result.stats.commitsUpdated++;
              }
            }

            // Sync recently updated pull requests
            const pullRequests = await client.listPullRequests(owner, repoName, { 
              state: 'all',
              per_page: 50,
            });

            for (const pr of pullRequests) {
              if (new Date(pr.updated_at) > since) {
                const wasCreated = await this.syncPullRequest(pr, repo.external_id, integrationId);
                if (wasCreated) {
                  result.stats.pullRequestsCreated++;
                } else {
                  result.stats.pullRequestsUpdated++;
                }
              }
            }

          } catch (error) {
            this.logger.error(`Incremental sync failed for ${repo.full_name}:`, error);
            result.stats.errors++;
            result.errors.push(`${repo.full_name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }

        // Update last sync time
        await query(
          `INSERT INTO integration_sync_status (integration_id, last_sync_at, stats)
           VALUES ($1, NOW(), $2)
           ON CONFLICT (integration_id) 
           DO UPDATE SET last_sync_at = NOW(), stats = EXCLUDED.stats`,
          [integrationId, JSON.stringify(result.stats)]
        );

        this.logger.debug('Incremental GitHub sync completed', {
          integrationId,
          stats: result.stats,
        });

        return result;

      } catch (error) {
        this.logger.error('Incremental GitHub sync failed:', error);
        result.success = false;
        result.errors.push(error instanceof Error ? error.message : 'Unknown error');
        return result;
      }
    });
  }

  /**
   * Load existing integrations and initialize clients
   */
  private async loadIntegrations(): Promise<void> {
    const integrations = await query(
      `SELECT * FROM integrations 
       WHERE provider = 'github' AND is_active = true`
    );

    for (const integration of integrations) {
      try {
        const config = JSON.parse(integration.config);
        const ghConfig: GitHubIntegrationConfig = {
          id: integration.id,
          organizationId: integration.organization_id,
          installationId: config.installationId,
          name: integration.name,
          baseUrl: config.baseUrl,
          isActive: integration.is_active,
          settings: {
            syncInterval: config.syncInterval || 60, // Default 1 hour
            enabledEvents: config.enabledEvents || ['push', 'pull_request'],
            repositoryFilters: config.repositoryFilters || [],
            branchFilters: config.branchFilters || [],
            webhookUrl: config.webhookUrl,
            autoLinkTickets: config.autoLinkTickets !== false,
            syncPullRequests: config.syncPullRequests !== false,
            syncCommits: config.syncCommits !== false,
            syncIssues: config.syncIssues || false,
            syncReleases: config.syncReleases || false,
          },
        };

        const client = new GitHubApiClient({
          organizationId: ghConfig.organizationId,
          installationId: ghConfig.installationId,
          baseUrl: ghConfig.baseUrl,
        });

        await client.initialize();
        this.clients.set(ghConfig.id, client);

        // Schedule sync
        this.scheduleSync(ghConfig.id, ghConfig.settings.syncInterval);

        this.logger.debug('GitHub integration loaded', {
          integrationId: ghConfig.id,
          installationId: ghConfig.installationId,
        });

      } catch (error) {
        this.logger.error(`Failed to load GitHub integration ${integration.id}:`, error);
      }
    }

    this.logger.info('GitHub integrations loaded', {
      count: this.clients.size,
    });
  }

  /**
   * Store integration configuration in database
   */
  private async storeIntegrationConfig(config: GitHubIntegrationConfig): Promise<void> {
    await query(
      `INSERT INTO integrations (
        id, organization_id, provider, name, config, is_active, created_at, updated_at
      ) VALUES ($1, $2, 'github', $3, $4, $5, NOW(), NOW())
      ON CONFLICT (id) 
      DO UPDATE SET 
        name = EXCLUDED.name,
        config = EXCLUDED.config,
        is_active = EXCLUDED.is_active,
        updated_at = NOW()`,
      [
        config.id,
        config.organizationId,
        config.name,
        JSON.stringify({
          installationId: config.installationId,
          baseUrl: config.baseUrl,
          ...config.settings,
        }),
        config.isActive,
      ]
    );
  }

  /**
   * Get GitHub client for integration
   */
  getClient(integrationId: string): GitHubApiClient | null {
    return this.clients.get(integrationId) || null;
  }

  /**
   * Get webhook service
   */
  getWebhookService(): GitHubWebhookService {
    return this.webhookService;
  }

  /**
   * Health check for all GitHub integrations
   */
  async healthCheck(): Promise<boolean> {
    let allHealthy = true;

    for (const [integrationId, client] of this.clients) {
      try {
        const isHealthy = await client.healthCheck();
        if (!isHealthy) allHealthy = false;
      } catch (error) {
        allHealthy = false;
      }
    }

    return allHealthy;
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    // Clear all sync intervals
    for (const [integrationId, interval] of this.syncIntervals) {
      clearInterval(interval);
    }
    this.syncIntervals.clear();

    // Clear clients
    this.clients.clear();

    this.logger.info('GitHub Integration Service cleaned up');
  }
}