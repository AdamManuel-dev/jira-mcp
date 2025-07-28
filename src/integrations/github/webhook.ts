/**
 * @fileoverview GitHub webhook processing with signature validation and event handling
 * @lastmodified 2025-07-28T02:10:00Z
 * 
 * Features: Webhook signature validation, event processing, ticket reference extraction, database sync
 * Main APIs: Webhook validation, event handling, commit processing, PR lifecycle tracking
 * Constraints: Requires GitHub webhook secret, handles high-volume events, ensures data consistency
 * Patterns: Event-driven processing, queue-based reliability, signature verification, database transactions
 */

import crypto from 'crypto';
import { Request, Response } from 'express';
import { queue } from '@/config/redis';
import { logger, perf } from '@/utils/logger';
import { BaseService } from '@/services';
import { query, transaction } from '@/database/connection';
import { ValidationError, ExternalServiceError } from '@/middleware/error-handler';
import { config } from '@/config/environment';
import {
  GitHubWebhookEvent,
  GitHubPullRequest,
  GitHubCommit,
  GitHubRepository,
  ProcessedGitHubEvent,
} from '@/types/github';

interface GitHubWebhookConfig {
  id: string;
  integrationId: string;
  repositoryId: string;
  events: string[];
  secret: string;
  isActive: boolean;
}

export class GitHubWebhookService extends BaseService {
  private activeWebhooks: Map<string, GitHubWebhookConfig> = new Map();
  private ticketReferencePattern = /(?:(?:fixes?|closes?|resolves?)\s+)?(?:#|(?:https?:\/\/[^\/]+\/browse\/))?([A-Z]+-\d+)/gi;

  async initialize(): Promise<void> {
    await this.loadActiveWebhooks();
    this.logger.info('GitHub Webhook Service initialized', {
      webhookCount: this.activeWebhooks.size,
    });
  }

  /**
   * Process incoming webhook from GitHub
   */
  async processWebhook(req: Request, res: Response): Promise<void> {
    try {
      const signature = req.headers['x-hub-signature-256'] as string;
      const delivery = req.headers['x-github-delivery'] as string;
      const event = req.headers['x-github-event'] as string;
      const payload = req.body;

      // Validate webhook signature
      if (!this.validateSignature(payload, signature)) {
        throw new ValidationError('Invalid webhook signature');
      }

      // Validate required headers
      if (!delivery || !event) {
        throw new ValidationError('Missing required webhook headers');
      }

      // Find webhook configuration
      const repositoryFullName = payload.repository?.full_name;
      if (!repositoryFullName) {
        throw new ValidationError('Repository information missing from payload');
      }

      const webhookConfig = this.findWebhookConfig(repositoryFullName, event);
      if (!webhookConfig) {
        this.logger.warn('No webhook configuration found', {
          repository: repositoryFullName,
          event,
          delivery,
        });
        res.status(404).json({ error: 'Webhook not configured' });
        return;
      }

      // Queue event for processing
      await this.queueEvent(delivery, event, payload, webhookConfig);

      res.status(200).json({ 
        status: 'accepted',
        delivery,
        event,
      });

      this.logger.info('GitHub webhook received', {
        delivery,
        event,
        repository: repositoryFullName,
        action: payload.action,
      });

    } catch (error) {
      this.logger.error('GitHub webhook processing failed:', error);
      res.status(400).json({ 
        error: error.message,
        delivery: req.headers['x-github-delivery'],
      });
    }
  }

  /**
   * Validate GitHub webhook signature
   */
  private validateSignature(payload: any, signature: string): boolean {
    if (!signature) return false;

    try {
      const secret = config.integrations.github.webhookSecret;
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(payload))
        .digest('hex');

      const receivedSignature = signature.replace('sha256=', '');
      
      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'hex'),
        Buffer.from(receivedSignature, 'hex')
      );
    } catch (error) {
      this.logger.error('Signature validation error:', error);
      return false;
    }
  }

  /**
   * Find webhook configuration for repository and event
   */
  private findWebhookConfig(repositoryFullName: string, event: string): GitHubWebhookConfig | null {
    for (const [key, config] of this.activeWebhooks) {
      if (config.events.includes(event) && config.isActive) {
        // Check if this webhook is for the correct repository
        // This would need to be enhanced to match repository configs
        return config;
      }
    }
    return null;
  }

  /**
   * Queue event for asynchronous processing
   */
  private async queueEvent(
    delivery: string,
    event: string,
    payload: GitHubWebhookEvent,
    config: GitHubWebhookConfig
  ): Promise<void> {
    const processedEvent: ProcessedGitHubEvent = {
      id: delivery,
      type: event,
      action: payload.action,
      repository: payload.repository.full_name,
      timestamp: new Date().toISOString(),
      processed: false,
      data: payload,
      ticketReferences: [],
    };

    await queue.add('github-webhook', {
      event: processedEvent,
      config,
    }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    });
  }

  /**
   * Process queued webhook events
   */
  async processQueuedEvent(job: any): Promise<void> {
    const { event, config } = job.data;
    
    try {
      await perf.measureAsync('github.webhook.process', async () => {
        switch (event.type) {
          case 'push':
            await this.processPushEvent(event, config);
            break;
          case 'pull_request':
            await this.processPullRequestEvent(event, config);
            break;
          case 'pull_request_review':
            await this.processPullRequestReviewEvent(event, config);
            break;
          case 'issues':
            await this.processIssueEvent(event, config);
            break;
          case 'issue_comment':
            await this.processIssueCommentEvent(event, config);
            break;
          case 'release':
            await this.processReleaseEvent(event, config);
            break;
          default:
            this.logger.debug('Unhandled GitHub event type', { 
              type: event.type,
              action: event.action,
            });
        }

        // Mark event as processed
        await this.markEventProcessed(event.id);
      });

      this.logger.info('GitHub webhook event processed', {
        delivery: event.id,
        type: event.type,
        action: event.action,
        repository: event.repository,
      });

    } catch (error) {
      this.logger.error('Failed to process GitHub webhook event:', {
        delivery: event.id,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Process push events (commits)
   */
  private async processPushEvent(event: ProcessedGitHubEvent, config: GitHubWebhookConfig): Promise<void> {
    const { data } = event;
    const commits = data.commits || [];

    if (commits.length === 0) return;

    await transaction(async (client) => {
      for (const commit of commits) {
        // Extract ticket references from commit message
        const ticketRefs = this.extractTicketReferences(commit.message);
        
        // Store commit in database
        await client.query(
          `INSERT INTO commits (
            repository_id, sha, message, author_email, author_name, 
            committed_at, ticket_references
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (repository_id, sha) 
          DO UPDATE SET 
            message = EXCLUDED.message,
            ticket_references = EXCLUDED.ticket_references,
            updated_at = NOW()`,
          [
            config.repositoryId,
            commit.id,
            commit.message,
            commit.author.email,
            commit.author.name,
            commit.timestamp,
            ticketRefs,
          ]
        );

        // Update ticket references if any found
        if (ticketRefs.length > 0) {
          event.ticketReferences.push(...ticketRefs);
          await this.updateTicketArtifacts(ticketRefs, 'commit', commit.id);
        }
      }
    });
  }

  /**
   * Process pull request events
   */
  private async processPullRequestEvent(event: ProcessedGitHubEvent, config: GitHubWebhookConfig): Promise<void> {
    const { data } = event;
    const pr = data.pull_request;

    if (!pr) return;

    // Extract ticket references from PR title and body
    const ticketRefs = [
      ...this.extractTicketReferences(pr.title),
      ...this.extractTicketReferences(pr.body || ''),
    ];

    await transaction(async (client) => {
      // Store/update pull request
      await client.query(
        `INSERT INTO pull_requests (
          repository_id, external_id, number, title, description, state,
          author_id, base_branch, head_branch, merged_at, closed_at,
          ticket_references, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (repository_id, external_id)
        DO UPDATE SET
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          state = EXCLUDED.state,
          merged_at = EXCLUDED.merged_at,
          closed_at = EXCLUDED.closed_at,
          ticket_references = EXCLUDED.ticket_references,
          updated_at = EXCLUDED.updated_at`,
        [
          config.repositoryId,
          pr.id.toString(),
          pr.number,
          pr.title,
          pr.body,
          pr.state,
          (pr as any).user?.login || 'unknown', // This would need to be mapped to user ID
          pr.base.ref,
          pr.head.ref,
          pr.merged_at,
          pr.closed_at,
          ticketRefs,
          pr.created_at,
          pr.updated_at,
        ]
      );

      // Update ticket artifacts if references found
      if (ticketRefs.length > 0) {
        event.ticketReferences.push(...ticketRefs);
        await this.updateTicketArtifacts(ticketRefs, 'pull_request', pr.id.toString());
      }

      // Trigger alert resolution/creation based on PR state
      if (data.action === 'opened' && ticketRefs.length > 0) {
        // Resolve "missing PR" alerts
        await this.resolveTicketAlerts(ticketRefs, 'missing_pr');
      } else if (data.action === 'closed' && pr.merged && ticketRefs.length > 0) {
        // Resolve "unmerged PR" alerts
        await this.resolveTicketAlerts(ticketRefs, 'unmerged_pr');
      }
    });
  }

  /**
   * Process pull request review events
   */
  private async processPullRequestReviewEvent(event: ProcessedGitHubEvent, config: GitHubWebhookConfig): Promise<void> {
    const { data } = event;
    const review = data.review;
    const pr = data.pull_request;

    if (!review || !pr) return;

    // Store review information (could be used for review metrics)
    await query(
      `INSERT INTO pr_reviews (
        pull_request_id, external_id, state, author, body, created_at
      ) VALUES (
        (SELECT id FROM pull_requests WHERE repository_id = $1 AND external_id = $2),
        $3, $4, $5, $6, $7
      ) ON CONFLICT DO NOTHING`,
      [
        config.repositoryId,
        pr.id.toString(),
        review.id.toString(),
        review.state,
        review.user?.login,
        review.body,
        review.submitted_at,
      ]
    );
  }

  /**
   * Extract ticket references from text
   */
  private extractTicketReferences(text: string): string[] {
    if (!text) return [];

    const matches = [];
    let match;
    
    // Reset regex lastIndex
    this.ticketReferencePattern.lastIndex = 0;
    
    while ((match = this.ticketReferencePattern.exec(text)) !== null) {
      matches.push(match[1].toUpperCase());
    }

    // Remove duplicates
    return [...new Set(matches)];
  }

  /**
   * Update ticket artifacts in database
   */
  private async updateTicketArtifacts(
    ticketRefs: string[],
    artifactType: 'commit' | 'pull_request',
    artifactId: string
  ): Promise<void> {
    for (const ticketKey of ticketRefs) {
      // This would update ticket status or create alerts based on artifacts
      // Implementation would depend on specific business logic
      this.logger.debug('Updating ticket artifacts', {
        ticketKey,
        artifactType,
        artifactId,
      });
    }
  }

  /**
   * Resolve ticket alerts based on artifacts
   */
  private async resolveTicketAlerts(ticketRefs: string[], alertType: string): Promise<void> {
    for (const ticketKey of ticketRefs) {
      await query(
        `UPDATE alerts 
         SET status = 'resolved', resolved_at = NOW()
         WHERE ticket_key = $1 AND alert_type = $2 AND status = 'active'`,
        [ticketKey, alertType]
      );
    }
  }

  /**
   * Mark event as processed
   */
  private async markEventProcessed(eventId: string): Promise<void> {
    await query(
      `INSERT INTO processed_events (id, event_type, processed_at)
       VALUES ($1, 'github', NOW())
       ON CONFLICT (id) DO UPDATE SET processed_at = NOW()`,
      [eventId]
    );
  }

  /**
   * Load active webhook configurations
   */
  private async loadActiveWebhooks(): Promise<void> {
    const webhooks = await query(
      `SELECT w.*, i.config as integration_config
       FROM webhooks w
       JOIN integrations i ON w.integration_id = i.id
       WHERE i.provider = 'github' AND w.is_active = true`
    );

    this.activeWebhooks.clear();

    for (const webhook of webhooks) {
      const config: GitHubWebhookConfig = {
        id: webhook.id,
        integrationId: webhook.integration_id,
        repositoryId: webhook.repository_id,
        events: webhook.events,
        secret: webhook.secret,
        isActive: webhook.is_active,
      };

      this.activeWebhooks.set(webhook.id, config);
    }

    this.logger.info('Loaded GitHub webhook configurations', {
      count: this.activeWebhooks.size,
    });
  }

  // Placeholder methods for other event types
  private async processIssueEvent(event: ProcessedGitHubEvent, config: GitHubWebhookConfig): Promise<void> {
    // Handle GitHub issues if needed
  }

  private async processIssueCommentEvent(event: ProcessedGitHubEvent, config: GitHubWebhookConfig): Promise<void> {
    // Handle issue comments if needed
  }

  private async processReleaseEvent(event: ProcessedGitHubEvent, config: GitHubWebhookConfig): Promise<void> {
    // Handle release events if needed
  }
}