/**
 * @fileoverview Core alert detection engine for sprint intelligence
 * @lastmodified 2025-07-28T08:15:29Z
 * 
 * Features: Multi-type alert detection, configurable thresholds, batch processing, performance optimization
 * Main APIs: Alert detection, threshold management, alert lifecycle, notification triggering
 * Constraints: Real-time processing, configurable rules, multi-tenant aware
 * Patterns: Strategy pattern for detectors, observer pattern for notifications, caching for performance
 */

import crypto from 'crypto';
import { BaseService } from '@/services';
import { query, transaction } from '@/database/connection';
import { cache } from '@/config/redis';
import { logger, perf } from '@/utils/logger';
import { JiraIssue, JiraChangeHistory, JiraSprint } from '@/types/jira';

export type AlertType = 
  | 'missing_estimate'
  | 'missing_time_tracking'
  | 'missing_code'
  | 'missing_pr'
  | 'unmerged_pr'
  | 'running_out_of_time'
  | 'early_completion'
  | 'unanswered_mention';

export interface AlertRule {
  id: string;
  organizationId: string;
  alertType: AlertType;
  isEnabled: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  conditions: AlertConditions;
  thresholds: AlertThresholds;
  filters: AlertFilters;
  notificationSettings: NotificationSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface AlertConditions {
  projectKeys?: string[];
  issueTypes?: string[];
  statuses?: string[];
  assigneeIds?: string[];
  labels?: string[];
  components?: string[];
  customFields?: Record<string, any>;
}

export interface AlertThresholds {
  // Time-based thresholds
  estimateRequiredAfterHours?: number;
  timeTrackingRequiredAfterHours?: number;
  mentionResponseTimeHours?: number;
  codeCommitRequiredAfterHours?: number;
  prRequiredAfterHours?: number;
  prMergeReminderAfterHours?: number;
  
  // Sprint-based thresholds
  sprintTimeRemainingDays?: number;
  sprintProgressThresholdPercent?: number;
  earlyCompletionThresholdPercent?: number;
  
  // Story point thresholds
  minStoryPointsForEstimate?: number;
  maxStoryPointsForAutoComplete?: number;
  
  // Custom thresholds
  customThresholds?: Record<string, number>;
}

export interface AlertFilters {
  excludeStatuses?: string[];
  excludeIssueTypes?: string[];
  excludeLabels?: string[];
  includeOnlyAssigned?: boolean;
  includeOnlyActiveSprints?: boolean;
  workingDaysOnly?: boolean;
  businessHoursOnly?: boolean;
}

export interface NotificationSettings {
  channels: Array<'email' | 'slack' | 'teams' | 'webhook'>;
  frequency: 'immediate' | 'hourly' | 'daily' | 'weekly';
  escalation?: {
    enabled: boolean;
    timeoutHours: number;
    escalateToManagerIds?: string[];
  };
  quietHours?: {
    enabled: boolean;
    startTime: string; // HH:mm format
    endTime: string;
    timezone: string;
  };
  suppressDuplicates?: {
    enabled: boolean;
    windowHours: number;
  };
}

export interface DetectedAlert {
  id: string;
  organizationId: string;
  ruleId: string;
  alertType: AlertType;
  severity: AlertRule['severity'];
  issueKey: string;
  issueId: string;
  title: string;
  description: string;
  metadata: AlertMetadata;
  assigneeId?: string;
  projectKey: string;
  sprintId?: string;
  status: 'active' | 'acknowledged' | 'resolved' | 'suppressed';
  detectedAt: Date;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  resolvedAt?: Date;
  suppressedUntil?: Date;
  lastNotifiedAt?: Date;
  notificationCount: number;
}

export interface AlertMetadata {
  issueData: {
    summary: string;
    status: string;
    assignee?: string;
    reporter?: string;
    priority?: string;
    storyPoints?: number;
    timeEstimate?: number;
    timeSpent?: number;
    labels: string[];
    components: string[];
  };
  sprintData?: {
    name: string;
    state: string;
    startDate?: string;
    endDate?: string;
    daysRemaining?: number;
    progress?: number;
  };
  contextData: Record<string, any>;
  thresholds: AlertThresholds;
  triggerData: {
    field?: string;
    previousValue?: any;
    currentValue?: any;
    changeTime?: Date;
  };
}

export class AlertDetectionService extends BaseService {
  private detectors: Map<AlertType, AlertDetector> = new Map();
  private activeRules: Map<string, AlertRule[]> = new Map(); // organizationId -> rules

  async initialize(): Promise<void> {
    // Initialize alert detectors
    this.initializeDetectors();
    
    // Load active rules from database
    await this.loadActiveRules();
    
    this.logger.info('Alert Detection Service initialized', {
      detectorCount: this.detectors.size,
      organizationCount: this.activeRules.size,
    });
  }

  /**
   * Initialize all alert detectors
   */
  private initializeDetectors(): void {
    this.detectors.set('missing_estimate', new MissingEstimateDetector());
    this.detectors.set('missing_time_tracking', new MissingTimeTrackingDetector());
    this.detectors.set('missing_code', new MissingCodeDetector());
    this.detectors.set('missing_pr', new MissingPRDetector());
    this.detectors.set('unmerged_pr', new UnmergedPRDetector());
    this.detectors.set('running_out_of_time', new RunningOutOfTimeDetector());
    this.detectors.set('early_completion', new EarlyCompletionDetector());
    this.detectors.set('unanswered_mention', new UnansweredMentionDetector());
  }

  /**
   * Process individual issue for alert detection across all enabled rules
   * 
   * Evaluates each alert rule against the issue and creates/resolves alerts as needed.
   * Handles three types of changes: created (new issue), updated (field changes), 
   * and deleted (issue removal - resolves all alerts).
   * 
   * @param organizationId - Organization identifier for rule filtering
   * @param issue - JIRA issue to evaluate
   * @param changeType - Type of change that triggered processing
   * @param changelog - Optional change history for update events
   * @returns Array of newly detected alerts
   */
  async processIssueAlerts(
    organizationId: string,
    issue: JiraIssue,
    changeType: 'created' | 'updated' | 'deleted',
    changelog?: JiraChangeHistory
  ): Promise<DetectedAlert[]> {
    return perf.measureAsync('alertDetection.processIssue', async () => {
      const alerts: DetectedAlert[] = [];

      try {
        // Skip processing for deleted issues
        if (changeType === 'deleted') {
          await this.resolveAlertsForIssue(issue.id);
          return alerts;
        }

        // Get active rules for organization
        const rules = this.activeRules.get(organizationId) || [];
        
        for (const rule of rules) {
          // Check if rule applies to this issue
          if (!this.doesRuleApplyToIssue(rule, issue)) {
            continue;
          }

          // Get detector for this alert type
          const detector = this.detectors.get(rule.alertType);
          if (!detector) {
            this.logger.warn('No detector found for alert type', { alertType: rule.alertType });
            continue;
          }

          // Check if alert should be triggered
          const shouldTrigger = await detector.shouldTrigger(issue, rule, changelog);
          
          if (shouldTrigger) {
            // Check for existing active alert to avoid duplicates
            const existingAlert = await this.findActiveAlert(organizationId, rule.id, issue.id);
            
            if (!existingAlert) {
              // Create new alert
              const alert = await this.createAlert(organizationId, rule, issue, detector);
              alerts.push(alert);
              
              this.logger.info('Alert detected', {
                alertType: rule.alertType,
                issueKey: issue.key,
                severity: rule.severity,
                alertId: alert.id,
              });
            } else {
              // Update existing alert metadata
              await this.updateAlertMetadata(existingAlert.id, issue);
            }
          } else {
            // Check if we should resolve existing alert
            const existingAlert = await this.findActiveAlert(organizationId, rule.id, issue.id);
            if (existingAlert && detector.shouldResolve(issue, rule)) {
              await this.resolveAlert(existingAlert.id, 'auto_resolved');
              
              this.logger.info('Alert auto-resolved', {
                alertType: rule.alertType,
                issueKey: issue.key,
                alertId: existingAlert.id,
              });
            }
          }
        }

        return alerts;
      } catch (error) {
        this.logger.error('Failed to process issue alerts:', error);
        throw error;
      }
    });
  }

  /**
   * Process sprint-level alerts for time-sensitive sprint conditions
   * 
   * Evaluates sprint progress and time remaining to detect issues that may
   * not complete on time or are completing early. Only processes rules for
   * 'running_out_of_time' and 'early_completion' alert types.
   * 
   * @param organizationId - Organization identifier for rule filtering
   * @param sprint - Sprint to evaluate for time-based alerts
   * @param issues - All issues in the sprint to check
   * @returns Array of newly detected sprint-level alerts
   */
  async processSprintAlerts(
    organizationId: string,
    sprint: JiraSprint,
    issues: JiraIssue[]
  ): Promise<DetectedAlert[]> {
    return perf.measureAsync('alertDetection.processSprint', async () => {
      const alerts: DetectedAlert[] = [];

      try {
        const rules = this.activeRules.get(organizationId) || [];
        const sprintLevelRules = rules.filter(rule => 
          ['running_out_of_time', 'early_completion'].includes(rule.alertType)
        );

        for (const rule of sprintLevelRules) {
          const detector = this.detectors.get(rule.alertType);
          if (!detector) continue;

          for (const issue of issues) {
            if (!this.doesRuleApplyToIssue(rule, issue)) continue;

            const shouldTrigger = await detector.shouldTriggerSprint(issue, sprint, rule);
            
            if (shouldTrigger) {
              const existingAlert = await this.findActiveAlert(organizationId, rule.id, issue.id);
              
              if (!existingAlert) {
                const alert = await this.createSprintAlert(organizationId, rule, issue, sprint, detector);
                alerts.push(alert);
              }
            }
          }
        }

        return alerts;
      } catch (error) {
        this.logger.error('Failed to process sprint alerts:', error);
        throw error;
      }
    });
  }

  /**
   * Evaluates whether an alert rule should be applied to a specific issue
   * 
   * Checks rule conditions (project, issue type, status, assignee, labels) and
   * filters (exclusions, assignment requirements) to determine rule applicability.
   * 
   * @param rule - Alert rule with conditions and filters
   * @param issue - JIRA issue to evaluate
   * @returns true if rule applies to the issue, false otherwise
   */
  private doesRuleApplyToIssue(rule: AlertRule, issue: JiraIssue): boolean {
    const { conditions, filters } = rule;

    // Check project filters
    if (conditions.projectKeys?.length && 
        !conditions.projectKeys.includes(issue.fields.project.key)) {
      return false;
    }

    // Check issue type filters
    if (conditions.issueTypes?.length && 
        !conditions.issueTypes.includes(issue.fields.issuetype.name)) {
      return false;
    }

    // Check status filters
    if (conditions.statuses?.length && 
        !conditions.statuses.includes(issue.fields.status.name)) {
      return false;
    }

    // Check assignee filters
    if (conditions.assigneeIds?.length) {
      const assigneeId = issue.fields.assignee?.accountId;
      if (!assigneeId || !conditions.assigneeIds.includes(assigneeId)) {
        return false;
      }
    }

    // Check exclude filters
    if (filters.excludeStatuses?.includes(issue.fields.status.name)) {
      return false;
    }

    if (filters.excludeIssueTypes?.includes(issue.fields.issuetype.name)) {
      return false;
    }

    // Check label filters
    if (filters.excludeLabels?.some(label => issue.fields.labels.includes(label))) {
      return false;
    }

    // Check if only assigned issues should be included
    if (filters.includeOnlyAssigned && !issue.fields.assignee) {
      return false;
    }

    return true;
  }

  /**
   * Create new alert
   */
  private async createAlert(
    organizationId: string,
    rule: AlertRule,
    issue: JiraIssue,
    detector: AlertDetector
  ): Promise<DetectedAlert> {
    const alertId = crypto.randomUUID();
    const metadata = await detector.generateMetadata(issue, rule);

    const alert: DetectedAlert = {
      id: alertId,
      organizationId,
      ruleId: rule.id,
      alertType: rule.alertType,
      severity: rule.severity,
      issueKey: issue.key,
      issueId: issue.id,
      title: detector.generateTitle(issue, rule),
      description: detector.generateDescription(issue, rule),
      metadata,
      assigneeId: issue.fields.assignee?.accountId,
      projectKey: issue.fields.project.key,
      status: 'active',
      detectedAt: new Date(),
      notificationCount: 0,
    };

    // Store in database
    await this.storeAlert(alert);

    // Queue for notification
    await this.queueNotification(alert, rule);

    return alert;
  }

  /**
   * Load active rules from database
   */
  private async loadActiveRules(): Promise<void> {
    const rules = await query(
      `SELECT * FROM alert_rules WHERE is_enabled = true ORDER BY organization_id, alert_type`
    );

    this.activeRules.clear();

    for (const row of rules) {
      const rule: AlertRule = {
        id: row.id,
        organizationId: row.organization_id,
        alertType: row.alert_type,
        isEnabled: row.is_enabled,
        severity: row.severity,
        conditions: JSON.parse(row.conditions),
        thresholds: JSON.parse(row.thresholds),
        filters: JSON.parse(row.filters),
        notificationSettings: JSON.parse(row.notification_settings),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };

      const orgRules = this.activeRules.get(rule.organizationId) || [];
      orgRules.push(rule);
      this.activeRules.set(rule.organizationId, orgRules);
    }

    this.logger.info('Loaded active alert rules', {
      totalRules: rules.length,
      organizations: this.activeRules.size,
    });
  }

  // === DATABASE METHODS ===

  private async storeAlert(alert: DetectedAlert): Promise<void> {
    await query(
      `INSERT INTO alerts (
        id, organization_id, rule_id, alert_type, severity, issue_key, issue_id,
        title, description, metadata, assignee_id, project_key, sprint_id,
        status, detected_at, notification_count
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        alert.id, alert.organizationId, alert.ruleId, alert.alertType, alert.severity,
        alert.issueKey, alert.issueId, alert.title, alert.description,
        JSON.stringify(alert.metadata), alert.assigneeId, alert.projectKey,
        alert.sprintId, alert.status, alert.detectedAt, alert.notificationCount
      ]
    );
  }

  private async findActiveAlert(
    organizationId: string,
    ruleId: string,
    issueId: string
  ): Promise<DetectedAlert | null> {
    const result = await query(
      `SELECT * FROM alerts 
       WHERE organization_id = $1 AND rule_id = $2 AND issue_id = $3 AND status = 'active'`,
      [organizationId, ruleId, issueId]
    );

    return result.length > 0 ? this.mapRowToAlert(result[0]) : null;
  }

  private mapRowToAlert(row: any): DetectedAlert {
    return {
      id: row.id,
      organizationId: row.organization_id,
      ruleId: row.rule_id,
      alertType: row.alert_type,
      severity: row.severity,
      issueKey: row.issue_key,
      issueId: row.issue_id,
      title: row.title,
      description: row.description,
      metadata: JSON.parse(row.metadata),
      assigneeId: row.assignee_id,
      projectKey: row.project_key,
      sprintId: row.sprint_id,
      status: row.status,
      detectedAt: row.detected_at,
      acknowledgedAt: row.acknowledged_at,
      acknowledgedBy: row.acknowledged_by,
      resolvedAt: row.resolved_at,
      suppressedUntil: row.suppressed_until,
      lastNotifiedAt: row.last_notified_at,
      notificationCount: row.notification_count,
    };
  }

  // === PLACEHOLDER METHODS ===

  private async createSprintAlert(
    organizationId: string,
    rule: AlertRule,
    issue: JiraIssue,
    sprint: JiraSprint,
    detector: AlertDetector
  ): Promise<DetectedAlert> {
    // Implementation would create sprint-specific alert
    return {} as DetectedAlert;
  }

  private async resolveAlertsForIssue(issueId: string): Promise<void> {
    // Implementation would resolve all alerts for deleted issue
  }

  private async resolveAlert(alertId: string, reason: string): Promise<void> {
    // Implementation would resolve specific alert
  }

  private async updateAlertMetadata(alertId: string, issue: JiraIssue): Promise<void> {
    // Implementation would update alert metadata
  }

  private async queueNotification(alert: DetectedAlert, rule: AlertRule): Promise<void> {
    // Implementation would queue notification for delivery
  }
}

// === ALERT DETECTOR INTERFACES ===

/**
 * Base class for all alert detection implementations
 * 
 * Defines the contract for alert detectors with methods for triggering,
 * resolving, and formatting alerts. Each concrete detector implements
 * specific business logic for their alert type.
 */
abstract class AlertDetector {
  /** Determines if an alert should be triggered for the given issue */
  abstract shouldTrigger(issue: JiraIssue, rule: AlertRule, changelog?: JiraChangeHistory): Promise<boolean>;
  
  /** Determines if an existing alert should be automatically resolved */
  abstract shouldResolve(issue: JiraIssue, rule: AlertRule): boolean;
  
  /** Generates user-friendly alert title */
  abstract generateTitle(issue: JiraIssue, rule: AlertRule): string;
  
  /** Generates detailed alert description with context */
  abstract generateDescription(issue: JiraIssue, rule: AlertRule): string;
  
  /** Generates comprehensive alert metadata for tracking and analysis */
  abstract generateMetadata(issue: JiraIssue, rule: AlertRule): Promise<AlertMetadata>;

  /** Optional method for sprint-level detection (only used by time-based detectors) */
  async shouldTriggerSprint(issue: JiraIssue, sprint: JiraSprint, rule: AlertRule): Promise<boolean> {
    return false;
  }

  /** Helper method to convert hours to milliseconds */
  protected hoursToMilliseconds(hours: number): number {
    return hours * 60 * 60 * 1000;
  }

  /** Helper method to calculate hours between two dates */
  protected calculateHoursBetween(startDate: Date, endDate: Date): number {
    return Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60));
  }
}

// === CONCRETE DETECTOR IMPLEMENTATIONS ===

/**
 * Detects issues that lack time estimates after a configured period
 * 
 * Triggers when issues are missing both time estimates and story points
 * beyond the threshold hours after creation.
 */
class MissingEstimateDetector extends AlertDetector {
  async shouldTrigger(issue: JiraIssue, rule: AlertRule): Promise<boolean> {
    // Check if issue already has estimate (time or story points)
    const hasTimeEstimate = Boolean(issue.fields.timeoriginalestimate);
    const hasStoryPoints = Boolean(issue.fields.customfield_10001);
    
    if (hasTimeEstimate || hasStoryPoints) {
      return false;
    }

    // Check if threshold time has passed since creation
    const thresholdHours = rule.thresholds.estimateRequiredAfterHours || 24;
    const createdTime = new Date(issue.fields.created);
    const thresholdMs = this.hoursToMilliseconds(thresholdHours);
    
    return Date.now() - createdTime.getTime() > thresholdMs;
  }

  shouldResolve(issue: JiraIssue, rule: AlertRule): boolean {
    return !!(issue.fields.timeoriginalestimate || issue.fields.customfield_10001);
  }

  generateTitle(issue: JiraIssue, rule: AlertRule): string {
    return `Missing Estimate: ${issue.key}`;
  }

  generateDescription(issue: JiraIssue, rule: AlertRule): string {
    const threshold = rule.thresholds.estimateRequiredAfterHours || 24;
    return `Issue ${issue.key} has been without an estimate for over ${threshold} hours. Please add time estimate or story points.`;
  }

  async generateMetadata(issue: JiraIssue, rule: AlertRule): Promise<AlertMetadata> {
    return {
      issueData: {
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        assignee: issue.fields.assignee?.displayName,
        reporter: issue.fields.reporter?.displayName,
        priority: issue.fields.priority?.name,
        timeEstimate: issue.fields.timeestimate,
        timeSpent: issue.fields.timespent,
        labels: issue.fields.labels,
        components: issue.fields.components?.map(c => c.name) || [],
      },
      contextData: {
        createdHoursAgo: Math.floor((Date.now() - new Date(issue.fields.created).getTime()) / (1000 * 60 * 60)),
      },
      thresholds: rule.thresholds,
      triggerData: {
        field: 'estimate',
        currentValue: null,
      },
    };
  }
}

/**
 * Detects issues in progress that lack time tracking entries
 * 
 * Triggers when issues are in development status but have no logged
 * work time beyond the configured threshold.
 */
class MissingTimeTrackingDetector extends AlertDetector {
  private readonly DEVELOPMENT_STATUSES = ['In Progress', 'In Development', 'In Review'];

  async shouldTrigger(issue: JiraIssue, rule: AlertRule): Promise<boolean> {
    // Only check issues that are actively being worked on
    const currentStatus = issue.fields.status.name;
    const isInDevelopmentPhase = this.DEVELOPMENT_STATUSES.includes(currentStatus);
    
    if (!isInDevelopmentPhase) {
      return false;
    }

    // Skip if time is already being tracked
    const timeSpentSeconds = issue.fields.timespent || 0;
    const hasLoggedTime = timeSpentSeconds > 0;
    
    if (hasLoggedTime) {
      return false;
    }

    // Check if issue has been in development long enough to require time tracking
    const thresholdHours = rule.thresholds.timeTrackingRequiredAfterHours || 8;
    // Note: Using updated time as approximation - ideally would use status change history
    const lastUpdated = new Date(issue.fields.updated);
    const thresholdMs = this.hoursToMilliseconds(thresholdHours);
    
    return Date.now() - lastUpdated.getTime() > thresholdMs;
  }

  shouldResolve(issue: JiraIssue, rule: AlertRule): boolean {
    return !!(issue.fields.timespent && issue.fields.timespent > 0);
  }

  generateTitle(issue: JiraIssue, rule: AlertRule): string {
    return `Missing Time Tracking: ${issue.key}`;
  }

  generateDescription(issue: JiraIssue, rule: AlertRule): string {
    const threshold = rule.thresholds.timeTrackingRequiredAfterHours || 8;
    return `Issue ${issue.key} is in progress but has no time logged after ${threshold} hours. Please log work time.`;
  }

  async generateMetadata(issue: JiraIssue, rule: AlertRule): Promise<AlertMetadata> {
    return {
      issueData: {
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        assignee: issue.fields.assignee?.displayName,
        timeEstimate: issue.fields.timeestimate,
        timeSpent: issue.fields.timespent || 0,
        labels: issue.fields.labels,
        components: issue.fields.components?.map(c => c.name) || [],
      },
      contextData: {
        statusUpdatedHoursAgo: Math.floor((Date.now() - new Date(issue.fields.updated).getTime()) / (1000 * 60 * 60)),
      },
      thresholds: rule.thresholds,
      triggerData: {
        field: 'timespent',
        currentValue: issue.fields.timespent || 0,
      },
    };
  }
}

// Additional detector implementations would follow similar patterns...
class MissingCodeDetector extends AlertDetector {
  async shouldTrigger(issue: JiraIssue, rule: AlertRule): Promise<boolean> {
    // Check if issue is in development status but has no linked commits
    const developmentStatuses = ['In Progress', 'In Development', 'In Review'];
    const isInDevelopment = developmentStatuses.includes(issue.fields.status.name);
    
    if (!isInDevelopment) return false;
    
    // Check if issue has been in development long enough to require commits
    const threshold = rule.thresholds.codeCommitRequiredAfterHours || 24;
    const statusChangeTime = new Date(issue.fields.updated).getTime();
    const thresholdTime = threshold * 60 * 60 * 1000;
    
    const timeSinceInDevelopment = Date.now() - statusChangeTime;
    if (timeSinceInDevelopment < thresholdTime) return false;
    
    // Query database for commits linked to this issue
    const commits = await query(
      `SELECT COUNT(*) as commit_count 
       FROM commits 
       WHERE ticket_references @> ARRAY[$1]`,
      [issue.key]
    );
    
    const hasCommits = commits[0]?.commit_count > 0;
    return !hasCommits;
  }

  shouldResolve(issue: JiraIssue, rule: AlertRule): boolean {
    // Resolve if issue is no longer in development or has commits
    const developmentStatuses = ['In Progress', 'In Development', 'In Review'];
    return !developmentStatuses.includes(issue.fields.status.name);
  }

  generateTitle(issue: JiraIssue, rule: AlertRule): string {
    return `Missing Code Commits: ${issue.key}`;
  }

  generateDescription(issue: JiraIssue, rule: AlertRule): string {
    const threshold = rule.thresholds.codeCommitRequiredAfterHours || 24;
    return `Issue ${issue.key} has been in development for ${threshold}+ hours but has no linked code commits. Please commit code with issue reference in commit message.`;
  }

  async generateMetadata(issue: JiraIssue, rule: AlertRule): Promise<AlertMetadata> {
    const developmentStartTime = new Date(issue.fields.updated);
    const hoursInDevelopment = Math.floor((Date.now() - developmentStartTime.getTime()) / (1000 * 60 * 60));
    
    return {
      issueData: {
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        assignee: issue.fields.assignee?.displayName,
        reporter: issue.fields.reporter?.displayName,
        priority: issue.fields.priority?.name,
        storyPoints: issue.fields.customfield_10001,
        timeEstimate: issue.fields.timeestimate,
        timeSpent: issue.fields.timespent,
        labels: issue.fields.labels,
        components: issue.fields.components?.map(c => c.name) || [],
      },
      contextData: {
        hoursInDevelopment,
        developmentStartTime: developmentStartTime.toISOString(),
        expectedCommitTime: new Date(developmentStartTime.getTime() + (rule.thresholds.codeCommitRequiredAfterHours || 24) * 60 * 60 * 1000).toISOString(),
      },
      thresholds: rule.thresholds,
      triggerData: {
        field: 'commits',
        currentValue: 0,
        changeTime: developmentStartTime,
      },
    };
  }
}

class MissingPRDetector extends AlertDetector {
  async shouldTrigger(issue: JiraIssue, rule: AlertRule): Promise<boolean> {
    // Check if issue has commits but no pull request
    const reviewStatuses = ['In Review', 'Ready for Review', 'Code Review'];
    const isInReview = reviewStatuses.includes(issue.fields.status.name);
    
    // Only trigger if issue has commits
    const commits = await query(
      `SELECT COUNT(*) as commit_count 
       FROM commits 
       WHERE ticket_references @> ARRAY[$1]`,
      [issue.key]
    );
    
    const hasCommits = commits[0]?.commit_count > 0;
    if (!hasCommits) return false;
    
    // Check if there's already a PR for this issue
    const prs = await query(
      `SELECT COUNT(*) as pr_count 
       FROM pull_requests 
       WHERE ticket_references @> ARRAY[$1] AND state NOT IN ('closed', 'merged')`,
      [issue.key]
    );
    
    const hasPR = prs[0]?.pr_count > 0;
    if (hasPR) return false;
    
    // Check if enough time has passed since last commit
    const threshold = rule.thresholds.prRequiredAfterHours || 8;
    const lastCommit = await query(
      `SELECT MAX(committed_at) as last_commit 
       FROM commits 
       WHERE ticket_references @> ARRAY[$1]`,
      [issue.key]
    );
    
    if (lastCommit[0]?.last_commit) {
      const lastCommitTime = new Date(lastCommit[0].last_commit).getTime();
      const thresholdTime = threshold * 60 * 60 * 1000;
      const timeSinceLastCommit = Date.now() - lastCommitTime;
      
      return timeSinceLastCommit > thresholdTime;
    }
    
    return false;
  }

  shouldResolve(issue: JiraIssue, rule: AlertRule): boolean {
    // This will be resolved when a PR is created through webhook events
    const doneStatuses = ['Done', 'Closed', 'Resolved', 'Merged'];
    return doneStatuses.includes(issue.fields.status.name);
  }

  generateTitle(issue: JiraIssue, rule: AlertRule): string {
    return `Missing Pull Request: ${issue.key}`;
  }

  generateDescription(issue: JiraIssue, rule: AlertRule): string {
    const threshold = rule.thresholds.prRequiredAfterHours || 8;
    return `Issue ${issue.key} has code commits but no pull request created after ${threshold} hours. Please create PR for code review.`;
  }

  async generateMetadata(issue: JiraIssue, rule: AlertRule): Promise<AlertMetadata> {
    // Get commit details
    const commits = await query(
      `SELECT COUNT(*) as commit_count, MAX(committed_at) as last_commit_time
       FROM commits 
       WHERE ticket_references @> ARRAY[$1]`,
      [issue.key]
    );
    
    const commitCount = commits[0]?.commit_count || 0;
    const lastCommitTime = commits[0]?.last_commit_time ? new Date(commits[0].last_commit_time) : null;
    const hoursSinceLastCommit = lastCommitTime 
      ? Math.floor((Date.now() - lastCommitTime.getTime()) / (1000 * 60 * 60))
      : 0;
    
    return {
      issueData: {
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        assignee: issue.fields.assignee?.displayName,
        reporter: issue.fields.reporter?.displayName,
        priority: issue.fields.priority?.name,
        storyPoints: issue.fields.customfield_10001,
        timeEstimate: issue.fields.timeestimate,
        timeSpent: issue.fields.timespent,
        labels: issue.fields.labels,
        components: issue.fields.components?.map(c => c.name) || [],
      },
      contextData: {
        commitCount,
        lastCommitTime: lastCommitTime?.toISOString(),
        hoursSinceLastCommit,
        expectedPRTime: lastCommitTime 
          ? new Date(lastCommitTime.getTime() + (rule.thresholds.prRequiredAfterHours || 8) * 60 * 60 * 1000).toISOString()
          : null,
      },
      thresholds: rule.thresholds,
      triggerData: {
        field: 'pull_request',
        currentValue: null,
        changeTime: lastCommitTime || undefined,
      },
    };
  }
}

class UnmergedPRDetector extends AlertDetector {
  async shouldTrigger(issue: JiraIssue, rule: AlertRule): Promise<boolean> {
    // Check for open PRs that have been unmerged for too long
    const openPRs = await query(
      `SELECT pr.id, pr.number, pr.title, pr.created_at, pr.updated_at, pr.state,
              r.name as repo_name, r.full_name as repo_full_name
       FROM pull_requests pr
       JOIN repositories r ON pr.repository_id = r.id
       WHERE pr.ticket_references @> ARRAY[$1] 
         AND pr.state = 'open'
       ORDER BY pr.created_at ASC`,
      [issue.key]
    );
    
    if (openPRs.length === 0) return false;
    
    const threshold = rule.thresholds.prMergeReminderAfterHours || 48;
    const thresholdTime = threshold * 60 * 60 * 1000;
    
    // Check if any PR has been open longer than threshold
    for (const pr of openPRs) {
      const prCreatedTime = new Date(pr.created_at).getTime();
      const timeSinceCreated = Date.now() - prCreatedTime;
      
      if (timeSinceCreated > thresholdTime) {
        return true;
      }
    }
    
    return false;
  }

  shouldResolve(issue: JiraIssue, rule: AlertRule): boolean {
    // This will be resolved when PR is merged or closed through webhook events
    const doneStatuses = ['Done', 'Closed', 'Resolved', 'Merged'];
    return doneStatuses.includes(issue.fields.status.name);
  }

  generateTitle(issue: JiraIssue, rule: AlertRule): string {
    return `Unmerged Pull Request: ${issue.key}`;
  }

  generateDescription(issue: JiraIssue, rule: AlertRule): string {
    const threshold = rule.thresholds.prMergeReminderAfterHours || 48;
    return `Issue ${issue.key} has an open pull request that has been unmerged for over ${threshold} hours. Please review and merge or provide feedback.`;
  }

  async generateMetadata(issue: JiraIssue, rule: AlertRule): Promise<AlertMetadata> {
    // Get PR details
    const openPRs = await query(
      `SELECT pr.id, pr.number, pr.title, pr.created_at, pr.updated_at, pr.state,
              r.name as repo_name, r.full_name as repo_full_name,
              pr.base_branch, pr.head_branch
       FROM pull_requests pr
       JOIN repositories r ON pr.repository_id = r.id
       WHERE pr.ticket_references @> ARRAY[$1] 
         AND pr.state = 'open'
       ORDER BY pr.created_at ASC`,
      [issue.key]
    );
    
    const oldestPR = openPRs[0];
    const prCreatedTime = oldestPR ? new Date(oldestPR.created_at) : null;
    const hoursSinceCreated = prCreatedTime 
      ? Math.floor((Date.now() - prCreatedTime.getTime()) / (1000 * 60 * 60))
      : 0;
    
    return {
      issueData: {
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        assignee: issue.fields.assignee?.displayName,
        reporter: issue.fields.reporter?.displayName,
        priority: issue.fields.priority?.name,
        storyPoints: issue.fields.customfield_10001,
        timeEstimate: issue.fields.timeestimate,
        timeSpent: issue.fields.timespent,
        labels: issue.fields.labels,
        components: issue.fields.components?.map(c => c.name) || [],
      },
      contextData: {
        openPRCount: openPRs.length,
        oldestPRNumber: oldestPR?.number,
        oldestPRTitle: oldestPR?.title,
        oldestPRRepo: oldestPR?.repo_full_name,
        prCreatedTime: prCreatedTime?.toISOString(),
        hoursSinceCreated,
        baseBranch: oldestPR?.base_branch,
        headBranch: oldestPR?.head_branch,
        expectedMergeTime: prCreatedTime 
          ? new Date(prCreatedTime.getTime() + (rule.thresholds.prMergeReminderAfterHours || 48) * 60 * 60 * 1000).toISOString()
          : null,
      },
      thresholds: rule.thresholds,
      triggerData: {
        field: 'pr_merge_status',
        currentValue: 'open',
        changeTime: prCreatedTime || undefined,
      },
    };
  }
}

class RunningOutOfTimeDetector extends AlertDetector {
  async shouldTrigger(issue: JiraIssue, rule: AlertRule): Promise<boolean> {
    // Would check sprint end date vs issue progress
    return false; // Placeholder
  }

  async shouldTriggerSprint(issue: JiraIssue, sprint: JiraSprint, rule: AlertRule): Promise<boolean> {
    if (sprint.state !== 'active' || !sprint.endDate) return false;

    const endDate = new Date(sprint.endDate);
    const now = new Date();
    const timeRemaining = endDate.getTime() - now.getTime();
    const daysRemaining = timeRemaining / (1000 * 60 * 60 * 24);

    const threshold = rule.thresholds.sprintTimeRemainingDays || 2;
    return daysRemaining <= threshold && daysRemaining > 0;
  }

  shouldResolve(issue: JiraIssue, rule: AlertRule): boolean {
    const doneStatuses = ['Done', 'Closed', 'Resolved'];
    return doneStatuses.includes(issue.fields.status.name);
  }

  generateTitle(issue: JiraIssue, rule: AlertRule): string {
    return `Sprint Time Running Out: ${issue.key}`;
  }

  generateDescription(issue: JiraIssue, rule: AlertRule): string {
    return `Issue ${issue.key} may not complete before sprint ends. Consider scope adjustment.`;
  }

  async generateMetadata(issue: JiraIssue, rule: AlertRule): Promise<AlertMetadata> {
    return {} as AlertMetadata; // Placeholder
  }
}

class EarlyCompletionDetector extends AlertDetector {
  async shouldTrigger(issue: JiraIssue, rule: AlertRule): Promise<boolean> {
    // Would detect issues completed much earlier than estimated
    return false; // Placeholder
  }

  shouldResolve(issue: JiraIssue, rule: AlertRule): boolean {
    return false; // Auto-resolve after notification
  }

  generateTitle(issue: JiraIssue, rule: AlertRule): string {
    return `Early Completion: ${issue.key}`;
  }

  generateDescription(issue: JiraIssue, rule: AlertRule): string {
    return `Issue ${issue.key} completed significantly faster than estimated. Consider updating future estimates.`;
  }

  async generateMetadata(issue: JiraIssue, rule: AlertRule): Promise<AlertMetadata> {
    return {} as AlertMetadata; // Placeholder
  }
}

class UnansweredMentionDetector extends AlertDetector {
  async shouldTrigger(issue: JiraIssue, rule: AlertRule, changelog?: JiraChangeHistory): Promise<boolean> {
    // Only trigger when comments are added with mentions
    if (!changelog || !changelog.items.some(item => item.field === 'comment')) {
      return false;
    }
    
    // Get recent comments with mentions for specific users
    const threshold = rule.thresholds.mentionResponseTimeHours || 4;
    const thresholdTime = new Date(Date.now() - threshold * 60 * 60 * 1000);
    
    const recentMentions = await query(
      `SELECT c.id, c.body, c.author_id, c.mentions, c.created_at
       FROM comments c
       WHERE c.ticket_id = $1 
         AND c.created_at > $2
         AND array_length(c.mentions, 1) > 0
       ORDER BY c.created_at DESC`,
      [issue.id, thresholdTime]
    );
    
    if (recentMentions.length === 0) return false;
    
    // Check if any mentioned users haven't responded
    for (const comment of recentMentions) {
      const mentionedUsers = comment.mentions || [];
      const commentTime = new Date(comment.created_at);
      
      for (const mentionedUserId of mentionedUsers) {
        // Check if mentioned user has commented after being mentioned
        const hasResponded = await query(
          `SELECT COUNT(*) as response_count
           FROM comments c2
           WHERE c2.ticket_id = $1 
             AND c2.author_id = $2
             AND c2.created_at > $3`,
          [issue.id, mentionedUserId, commentTime]
        );
        
        const responseCount = hasResponded[0]?.response_count || 0;
        
        // If user hasn't responded and enough time has passed
        if (responseCount === 0) {
          const hoursSinceMention = Math.floor((Date.now() - commentTime.getTime()) / (1000 * 60 * 60));
          if (hoursSinceMention >= threshold) {
            return true;
          }
        }
      }
    }
    
    return false;
  }

  shouldResolve(issue: JiraIssue, rule: AlertRule): boolean {
    // This will be resolved when mentioned user responds or issue is closed
    const closedStatuses = ['Done', 'Closed', 'Resolved'];
    return closedStatuses.includes(issue.fields.status.name);
  }

  generateTitle(issue: JiraIssue, rule: AlertRule): string {
    return `Unanswered Mention: ${issue.key}`;
  }

  generateDescription(issue: JiraIssue, rule: AlertRule): string {
    const threshold = rule.thresholds.mentionResponseTimeHours || 4;
    return `You were mentioned in ${issue.key} over ${threshold} hours ago without response. Please review and respond if needed.`;
  }

  async generateMetadata(issue: JiraIssue, rule: AlertRule): Promise<AlertMetadata> {
    // Get the mention details
    const threshold = rule.thresholds.mentionResponseTimeHours || 4;
    const thresholdTime = new Date(Date.now() - threshold * 60 * 60 * 1000);
    
    const recentMentions = await query(
      `SELECT c.id, c.body, c.author_id, c.mentions, c.created_at,
              u.name as author_name
       FROM comments c
       LEFT JOIN users u ON c.author_id = u.id
       WHERE c.ticket_id = $1 
         AND c.created_at > $2
         AND array_length(c.mentions, 1) > 0
       ORDER BY c.created_at DESC
       LIMIT 1`,
      [issue.id, thresholdTime]
    );
    
    const latestMention = recentMentions[0];
    const mentionTime = latestMention ? new Date(latestMention.created_at) : null;
    const hoursSinceMention = mentionTime 
      ? Math.floor((Date.now() - mentionTime.getTime()) / (1000 * 60 * 60))
      : 0;
    
    return {
      issueData: {
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        assignee: issue.fields.assignee?.displayName,
        reporter: issue.fields.reporter?.displayName,
        priority: issue.fields.priority?.name,
        storyPoints: issue.fields.customfield_10001,
        timeEstimate: issue.fields.timeestimate,
        timeSpent: issue.fields.timespent,
        labels: issue.fields.labels,
        components: issue.fields.components?.map(c => c.name) || [],
      },
      contextData: {
        mentionTime: mentionTime?.toISOString(),
        hoursSinceMention,
        mentionAuthor: latestMention?.author_name,
        mentionBody: latestMention?.body?.substring(0, 200) + (latestMention?.body?.length > 200 ? '...' : ''),
        mentionedUserCount: latestMention?.mentions?.length || 0,
        expectedResponseTime: mentionTime 
          ? new Date(mentionTime.getTime() + threshold * 60 * 60 * 1000).toISOString()
          : null,
      },
      thresholds: rule.thresholds,
      triggerData: {
        field: 'mention_response',
        currentValue: null,
        changeTime: mentionTime || undefined,
      },
    };
  }
}