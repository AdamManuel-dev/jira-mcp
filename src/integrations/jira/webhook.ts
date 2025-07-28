/**
 * @fileoverview JIRA webhook processing with queue-based reliability
 * @lastmodified 2025-07-28T15:30:00Z
 * 
 * Features: Webhook validation, event processing, retry mechanism, dead letter queue
 * Main APIs: Webhook registration, event handling, signature validation, queue processing
 * Constraints: Requires JIRA Cloud webhooks, handles high-volume events, ensures delivery
 * Patterns: Queue-based processing, exponential backoff, event deduplication, signature verification
 */

import crypto from 'crypto';
import { queue } from '@/config/redis';
import { logger, perf } from '@/utils/logger';
import { BaseService } from '@/services';
import { query, transaction } from '@/database/connection';
import { ExternalServiceError, ValidationError } from '@/middleware/error-handler';
import { JiraApiClient } from './client';
import { JiraWebhookEvent, JiraIssue, JiraComment, JiraWorklog, JiraSprint } from '@/types/jira';

interface WebhookConfig {
  id: string;
  integrationId: string;
  webhookId: string;
  url: string;
  events: string[];
  filters?: {
    projects?: string[];
    issueTypes?: string[];
  };
  secret: string;
  isActive: boolean;
  createdAt: Date;
  lastEventAt?: Date;
}

interface ProcessedEvent {
  id: string;
  webhookId: string;
  eventType: string;
  payload: JiraWebhookEvent;
  signature: string;
  processedAt: Date;
  retryCount: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'dead';
  error?: string;
}

interface WebhookStats {
  totalEvents: number;
  processedEvents: number;
  failedEvents: number;
  deadLetterEvents: number;
  avgProcessingTime: number;
  lastProcessedAt?: Date;
}

export class JiraWebhookService extends BaseService {
  private readonly maxRetries = 5;
  private readonly retryDelays = [1000, 2000, 5000, 10000, 30000]; // Exponential backoff in ms
  private readonly deadLetterQueueName = 'jira:webhook:dead-letter';
  private readonly eventQueueName = 'jira:webhook:events';

  async initialize(): Promise<void> {
    // Setup queue processors
    await this.setupQueueProcessors();
    this.logger.info('JIRA Webhook Service initialized');
  }

  /**
   * Setup queue processors for webhook events
   */
  private async setupQueueProcessors(): Promise<void> {
    // Main event processing queue
    queue.process(this.eventQueueName, 10, async (job) => {
      const { eventId } = job.data;
      return this.processWebhookEvent(eventId);
    });

    // Dead letter queue processor (for manual review)
    queue.process(this.deadLetterQueueName, 1, async (job) => {
      const { eventId, reason } = job.data;
      await this.handleDeadLetterEvent(eventId, reason);
    });

    this.logger.info('Webhook queue processors initialized', {
      eventQueue: this.eventQueueName,
      deadLetterQueue: this.deadLetterQueueName,
    });
  }

  /**
   * Register webhook with JIRA
   */
  async registerWebhook(
    integrationId: string,
    events: string[],
    filters?: WebhookConfig['filters']
  ): Promise<WebhookConfig> {
    return perf.measureAsync('jira.registerWebhook', async () => {
      try {
        // Get JIRA client
        const client = new JiraApiClient({
          organizationId: '', // Will be populated from integration
          userId: '',
          instanceId: '',
        });

        // Generate webhook secret
        const secret = this.generateWebhookSecret();
        
        // Build webhook URL
        const webhookUrl = `${process.env.BASE_URL}/webhooks/jira/${integrationId}`;

        // Register with JIRA
        const webhookData = {
          name: `SIAS Webhook - ${integrationId}`,
          url: webhookUrl,
          events,
          filters: {
            'issue-related-events-section': filters?.projects ? {
              project: {
                key: filters.projects
              }
            } : undefined,
          },
          excludeBody: false,
        };

        // Create webhook via JIRA API
        const jiraWebhook = await this.createJiraWebhook(client, webhookData);

        // Store webhook config in database
        const webhookConfig: WebhookConfig = {
          id: crypto.randomUUID(),
          integrationId,
          webhookId: jiraWebhook.id,
          url: webhookUrl,
          events,
          filters,
          secret,
          isActive: true,
          createdAt: new Date(),
        };

        await this.storeWebhookConfig(webhookConfig);

        this.logger.info('JIRA webhook registered successfully', {
          integrationId,
          webhookId: jiraWebhook.id,
          events,
          url: webhookUrl,
        });

        return webhookConfig;
      } catch (error) {
        this.logger.error('Failed to register JIRA webhook:', error);
        throw new ExternalServiceError('JIRA Webhook Registration', error as Error);
      }
    });
  }

  /**
   * Handle incoming webhook event
   */
  async handleWebhookEvent(
    integrationId: string,
    payload: any,
    signature: string,
    headers: Record<string, string>
  ): Promise<{ eventId: string; queued: boolean }> {
    return perf.measureAsync('jira.handleWebhookEvent', async () => {
      try {
        // Get webhook config
        const webhookConfig = await this.getWebhookConfig(integrationId);
        if (!webhookConfig || !webhookConfig.isActive) {
          throw new ValidationError('Webhook not found or inactive');
        }

        // Validate webhook signature
        const isValid = this.validateWebhookSignature(
          payload,
          signature,
          webhookConfig.secret
        );

        if (!isValid) {
          throw new ValidationError('Invalid webhook signature');
        }

        // Check for duplicate events (webhook event ID)
        const webhookEventId = headers['x-atlassian-webhook-identifier'];
        if (webhookEventId) {
          const existingEvent = await this.findEventByWebhookId(webhookEventId);
          if (existingEvent) {
            this.logger.debug('Duplicate webhook event ignored', {
              webhookEventId,
              eventId: existingEvent.id,
            });
            return { eventId: existingEvent.id, queued: false };
          }
        }

        // Create event record
        const eventId = crypto.randomUUID();
        const event: ProcessedEvent = {
          id: eventId,
          webhookId: webhookConfig.id,
          eventType: payload.webhookEvent,
          payload,
          signature,
          processedAt: new Date(),
          retryCount: 0,
          status: 'pending',
        };

        await this.storeWebhookEvent(event, webhookEventId);

        // Queue for processing
        await queue.add(this.eventQueueName, { eventId }, {
          attempts: 1,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: 100,
          removeOnFail: 50,
        });

        // Update webhook last event time
        await this.updateWebhookLastEvent(webhookConfig.id);

        this.logger.info('Webhook event queued for processing', {
          eventId,
          webhookEventId,
          eventType: payload.webhookEvent,
          integrationId,
        });

        return { eventId, queued: true };
      } catch (error) {
        this.logger.error('Failed to handle webhook event:', error);
        throw error;
      }
    });
  }

  /**
   * Process webhook event from queue
   */
  private async processWebhookEvent(eventId: string): Promise<void> {
    return perf.measureAsync('jira.processWebhookEvent', async () => {
      const startTime = Date.now();

      try {
        // Get event from database
        const event = await this.getWebhookEvent(eventId);
        if (!event) {
          throw new Error(`Webhook event ${eventId} not found`);
        }

        // Update status to processing
        await this.updateEventStatus(eventId, 'processing');

        this.logger.info('Processing webhook event', {
          eventId,
          eventType: event.eventType,
          retryCount: event.retryCount,
        });

        // Process based on event type
        await this.processEventByType(event);

        // Mark as completed
        await this.updateEventStatus(eventId, 'completed');

        const duration = Date.now() - startTime;
        this.logger.info('Webhook event processed successfully', {
          eventId,
          eventType: event.eventType,
          duration,
        });

      } catch (error) {
        const duration = Date.now() - startTime;
        
        // Increment retry count
        const event = await this.getWebhookEvent(eventId);
        const newRetryCount = (event?.retryCount || 0) + 1;

        if (newRetryCount <= this.maxRetries) {
          // Schedule retry
          await this.scheduleRetry(eventId, newRetryCount, error.message);
          
          this.logger.warn('Webhook event failed, scheduling retry', {
            eventId,
            retryCount: newRetryCount,
            maxRetries: this.maxRetries,
            error: error.message,
            duration,
          });
        } else {
          // Move to dead letter queue
          await this.moveToDeadLetterQueue(eventId, error.message);
          
          this.logger.error('Webhook event moved to dead letter queue', {
            eventId,
            retryCount: newRetryCount,
            error: error.message,
            duration,
          });
        }

        throw error;
      }
    });
  }

  /**
   * Process event based on its type
   */
  private async processEventByType(event: ProcessedEvent): Promise<void> {
    const { eventType, payload } = event;

    switch (eventType) {
      case 'jira:issue_created':
        await this.handleIssueCreated(payload);
        break;

      case 'jira:issue_updated':
        await this.handleIssueUpdated(payload);
        break;

      case 'jira:issue_deleted':
        await this.handleIssueDeleted(payload);
        break;

      case 'comment_created':
        await this.handleCommentCreated(payload);
        break;

      case 'comment_updated':
        await this.handleCommentUpdated(payload);
        break;

      case 'worklog_created':
        await this.handleWorklogCreated(payload);
        break;

      case 'worklog_updated':
        await this.handleWorklogUpdated(payload);
        break;

      case 'sprint_started':
        await this.handleSprintStarted(payload);
        break;

      case 'sprint_closed':
        await this.handleSprintClosed(payload);
        break;

      default:
        this.logger.debug('Unhandled webhook event type', {
          eventType,
          eventId: event.id,
        });
    }
  }

  /**
   * Handle issue created event
   */
  private async handleIssueCreated(payload: JiraWebhookEvent): Promise<void> {
    if (!payload.issue) return;

    const issue = payload.issue;
    
    // Store/update issue in database
    await this.syncIssueToDatabase(issue, 'created');

    // Trigger alert detection for new issue
    await this.triggerAlertDetection(issue, 'issue_created');

    this.logger.debug('Issue created event processed', {
      issueKey: issue.key,
      projectKey: issue.fields.project.key,
    });
  }

  /**
   * Handle issue updated event
   */
  private async handleIssueUpdated(payload: JiraWebhookEvent): Promise<void> {
    if (!payload.issue || !payload.changelog) return;

    const issue = payload.issue;
    const changelog = payload.changelog;

    // Store/update issue in database
    await this.syncIssueToDatabase(issue, 'updated');

    // Process field changes for alert detection
    for (const change of changelog.items || []) {
      await this.processFieldChange(issue, change);
    }

    // Trigger alert detection
    await this.triggerAlertDetection(issue, 'issue_updated', changelog);

    this.logger.debug('Issue updated event processed', {
      issueKey: issue.key,
      changedFields: changelog.items?.map(item => item.field) || [],
    });
  }

  /**
   * Handle issue deleted event
   */
  private async handleIssueDeleted(payload: JiraWebhookEvent): Promise<void> {
    if (!payload.issue) return;

    const issue = payload.issue;

    // Remove issue from database and resolve alerts
    await this.syncIssueToDatabase(issue, 'deleted');
    await this.triggerAlertDetection(issue, 'issue_deleted');

    this.logger.debug('Issue deleted event processed', {
      issueKey: issue.key,
    });
  }

  /**
   * Handle comment events
   */
  private async handleCommentCreated(payload: JiraWebhookEvent): Promise<void> {
    if (!payload.issue || !payload.comment) return;

    const issue = payload.issue;
    const comment = payload.comment;

    // Check for mentions and trigger alerts
    await this.processMentions(issue, comment);

    this.logger.debug('Comment created event processed', {
      issueKey: issue.key,
      commentId: comment.id,
      author: comment.author.displayName,
    });
  }

  /**
   * Handle comment updated event
   */
  private async handleCommentUpdated(payload: JiraWebhookEvent): Promise<void> {
    if (!payload.issue || !payload.comment) return;

    const issue = payload.issue;
    const comment = payload.comment;

    // Check for new mentions in updated comment
    await this.processMentions(issue, comment);

    this.logger.debug('Comment updated event processed', {
      issueKey: issue.key,
      commentId: comment.id,
      author: comment.author.displayName,
    });
  }

  /**
   * Handle worklog events
   */
  private async handleWorklogCreated(payload: JiraWebhookEvent): Promise<void> {
    if (!payload.issue || !payload.worklog) return;

    const issue = payload.issue;
    const worklog = payload.worklog;

    // Update time tracking in database
    await this.updateTimeTracking(issue, worklog);

    // Trigger time tracking alerts
    await this.triggerAlertDetection(issue, 'worklog_created');

    this.logger.debug('Worklog created event processed', {
      issueKey: issue.key,
      timeSpent: worklog.timeSpent,
      author: worklog.author.displayName,
    });
  }

  /**
   * Handle worklog updated event
   */
  private async handleWorklogUpdated(payload: JiraWebhookEvent): Promise<void> {
    if (!payload.issue || !payload.worklog) return;

    const issue = payload.issue;
    const worklog = payload.worklog;

    // Update time tracking in database
    await this.updateTimeTracking(issue, worklog);

    // Trigger time tracking alerts
    await this.triggerAlertDetection(issue, 'worklog_updated');

    this.logger.debug('Worklog updated event processed', {
      issueKey: issue.key,
      timeSpent: worklog.timeSpent,
      author: worklog.author.displayName,
    });
  }

  /**
   * Handle sprint started event
   */
  private async handleSprintStarted(payload: JiraWebhookEvent): Promise<void> {
    if (!payload.sprint) return;

    const sprint = payload.sprint;

    // Trigger sprint-level alerts
    await this.triggerSprintAlerts(sprint, 'sprint_started');

    this.logger.debug('Sprint started event processed', {
      sprintId: sprint.id,
      sprintName: sprint.name,
    });
  }

  /**
   * Handle sprint closed event
   */
  private async handleSprintClosed(payload: JiraWebhookEvent): Promise<void> {
    if (!payload.sprint) return;

    const sprint = payload.sprint;

    // Trigger sprint completion alerts
    await this.triggerSprintAlerts(sprint, 'sprint_closed');

    this.logger.debug('Sprint closed event processed', {
      sprintId: sprint.id,
      sprintName: sprint.name,
    });
  }

  // === UTILITY METHODS ===

  /**
   * Validate webhook signature
   */
  private validateWebhookSignature(
    payload: any,
    signature: string,
    secret: string
  ): boolean {
    try {
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(payload))
        .digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
      );
    } catch (error) {
      this.logger.error('Failed to validate webhook signature:', error);
      return false;
    }
  }

  /**
   * Generate webhook secret
   */
  private generateWebhookSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Schedule retry for failed event
   */
  private async scheduleRetry(
    eventId: string,
    retryCount: number,
    error: string
  ): Promise<void> {
    const delay = this.retryDelays[Math.min(retryCount - 1, this.retryDelays.length - 1)];

    // Update event with retry info
    await this.updateEventRetry(eventId, retryCount, error);

    // Schedule retry
    await queue.add(
      this.eventQueueName,
      { eventId },
      {
        delay,
        attempts: 1,
        removeOnComplete: 100,
        removeOnFail: 50,
      }
    );
  }

  /**
   * Move event to dead letter queue
   */
  private async moveToDeadLetterQueue(eventId: string, reason: string): Promise<void> {
    await this.updateEventStatus(eventId, 'dead');
    
    await queue.add(
      this.deadLetterQueueName,
      { eventId, reason },
      {
        removeOnComplete: 1000,
        removeOnFail: false,
      }
    );
  }

  /**
   * Handle dead letter events
   */
  private async handleDeadLetterEvent(eventId: string, reason: string): Promise<void> {
    // Log for manual review
    this.logger.error('Dead letter webhook event requires manual review', {
      eventId,
      reason,
    });

    // Could implement notification to ops team here
    // await this.notifyOpsTeam({ eventId, reason });
  }

  // === DATABASE METHODS ===

  private async storeWebhookConfig(config: WebhookConfig): Promise<void> {
    await query(
      `INSERT INTO webhook_configs (id, integration_id, webhook_id, url, events, filters, secret, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        config.id,
        config.integrationId,
        config.webhookId,
        config.url,
        JSON.stringify(config.events),
        JSON.stringify(config.filters || {}),
        config.secret,
        config.isActive,
        config.createdAt,
      ]
    );
  }

  private async getWebhookConfig(integrationId: string): Promise<WebhookConfig | null> {
    const result = await query(
      `SELECT * FROM webhook_configs WHERE integration_id = $1 AND is_active = true`,
      [integrationId]
    );

    if (result.length === 0) return null;

    const row = result[0];
    return {
      id: row.id,
      integrationId: row.integration_id,
      webhookId: row.webhook_id,
      url: row.url,
      events: JSON.parse(row.events),
      filters: JSON.parse(row.filters),
      secret: row.secret,
      isActive: row.is_active,
      createdAt: row.created_at,
      lastEventAt: row.last_event_at,
    };
  }

  private async storeWebhookEvent(event: ProcessedEvent, webhookEventId?: string): Promise<void> {
    await query(
      `INSERT INTO webhook_events (id, webhook_id, event_type, payload, signature, processed_at, retry_count, status, webhook_event_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        event.id,
        event.webhookId,
        event.eventType,
        JSON.stringify(event.payload),
        event.signature,
        event.processedAt,
        event.retryCount,
        event.status,
        webhookEventId,
      ]
    );
  }

  private async getWebhookEvent(eventId: string): Promise<ProcessedEvent | null> {
    const result = await query(
      `SELECT * FROM webhook_events WHERE id = $1`,
      [eventId]
    );

    if (result.length === 0) return null;

    const row = result[0];
    return {
      id: row.id,
      webhookId: row.webhook_id,
      eventType: row.event_type,
      payload: JSON.parse(row.payload),
      signature: row.signature,
      processedAt: row.processed_at,
      retryCount: row.retry_count,
      status: row.status,
      error: row.error,
    };
  }

  private async updateEventStatus(eventId: string, status: ProcessedEvent['status']): Promise<void> {
    await query(
      `UPDATE webhook_events SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, eventId]
    );
  }

  private async updateEventRetry(eventId: string, retryCount: number, error: string): Promise<void> {
    await query(
      `UPDATE webhook_events SET retry_count = $1, error = $2, status = 'pending', updated_at = NOW() WHERE id = $3`,
      [retryCount, error, eventId]
    );
  }

  private async findEventByWebhookId(webhookEventId: string): Promise<ProcessedEvent | null> {
    const result = await query(
      `SELECT * FROM webhook_events WHERE webhook_event_id = $1`,
      [webhookEventId]
    );

    return result.length > 0 ? {
      id: result[0].id,
      webhookId: result[0].webhook_id,
      eventType: result[0].event_type,
      payload: JSON.parse(result[0].payload),
      signature: result[0].signature,
      processedAt: result[0].processed_at,
      retryCount: result[0].retry_count,
      status: result[0].status,
      error: result[0].error,
    } : null;
  }

  private async updateWebhookLastEvent(webhookId: string): Promise<void> {
    await query(
      `UPDATE webhook_configs SET last_event_at = NOW() WHERE id = $1`,
      [webhookId]
    );
  }

  // === PLACEHOLDER METHODS (to be implemented) ===

  private async createJiraWebhook(client: JiraApiClient, webhookData: any): Promise<{ id: string }> {
    // Implementation would use JIRA API to create webhook
    return { id: `webhook_${Date.now()}` };
  }

  private async syncIssueToDatabase(issue: JiraIssue, operation: 'created' | 'updated' | 'deleted'): Promise<void> {
    // Implementation would sync issue data to database
  }

  private async triggerAlertDetection(issue: JiraIssue, eventType: string, changelog?: any): Promise<void> {
    // Implementation would trigger alert detection engine
  }

  private async processFieldChange(issue: JiraIssue, change: any): Promise<void> {
    // Implementation would process specific field changes
  }

  private async processMentions(issue: JiraIssue, comment: JiraComment): Promise<void> {
    // Implementation would detect and process @mentions
  }

  private async updateTimeTracking(issue: JiraIssue, worklog: JiraWorklog): Promise<void> {
    // Implementation would update time tracking data
  }

  private async triggerSprintAlerts(sprint: JiraSprint, eventType: string): Promise<void> {
    // Implementation would trigger sprint-level alerts
  }
}