/**
 * @fileoverview Unit tests for alert detection service
 * @lastmodified 2025-07-28T08:30:00Z
 * 
 * Features: Alert detection logic testing, detector implementations, rule processing
 * Main APIs: Test alert detection engine, individual detectors, and business rules
 * Constraints: Mock JIRA API, database, and Redis dependencies
 * Patterns: Service testing, detector pattern validation, async test helpers
 */

import { AlertDetectionService, AlertType } from '../alert-detection';
import { createTestIssue, createTestAlert, createTestSprint } from '../../../tests/setup';

// Mock dependencies
jest.mock('@/database/connection', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('@/config/redis', () => ({
  cache: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
  },
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
  perf: {
    measureAsync: jest.fn((name, fn) => fn()),
  },
}));

describe('AlertDetectionService', () => {
  let alertService: AlertDetectionService;
  let mockQuery: jest.Mock;

  beforeEach(async () => {
    alertService = new AlertDetectionService();
    mockQuery = require('@/database/connection').query;
    
    // Mock loadActiveRules
    mockQuery.mockResolvedValue([]);
    
    await alertService.initialize();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with all detector types', () => {
      expect(alertService['detectors']).toBeDefined();
      expect(alertService['detectors'].size).toBe(8);
      expect(alertService['detectors'].has('missing_estimate')).toBe(true);
      expect(alertService['detectors'].has('missing_time_tracking')).toBe(true);
      expect(alertService['detectors'].has('missing_code')).toBe(true);
      expect(alertService['detectors'].has('missing_pr')).toBe(true);
      expect(alertService['detectors'].has('unmerged_pr')).toBe(true);
      expect(alertService['detectors'].has('running_out_of_time')).toBe(true);
      expect(alertService['detectors'].has('early_completion')).toBe(true);
      expect(alertService['detectors'].has('unanswered_mention')).toBe(true);
    });

    it('should load active rules from database', async () => {
      const mockRules = [{
        id: 'rule-1',
        organization_id: 'org-1',
        alert_type: 'missing_estimate',
        is_enabled: true,
        severity: 'warning',
        conditions: JSON.stringify({ projectKeys: ['TEST'] }),
        thresholds: JSON.stringify({ estimateRequiredAfterHours: 24 }),
        filters: JSON.stringify({}),
        notification_settings: JSON.stringify({ channels: ['email'] }),
        created_at: new Date(),
        updated_at: new Date(),
      }];

      mockQuery.mockResolvedValue(mockRules);

      const newService = new AlertDetectionService();
      await newService.initialize();

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM alert_rules WHERE is_enabled = true')
      );
      expect(newService['activeRules'].get('org-1')).toHaveLength(1);
    });
  });

  describe('processIssueAlerts', () => {
    const mockIssue = createTestIssue();

    it('should skip processing for deleted issues', async () => {
      const alerts = await alertService.processIssueAlerts(
        'org-1',
        mockIssue,
        'deleted'
      );

      expect(alerts).toEqual([]);
    });

    it('should return empty array when no rules apply', async () => {
      const alerts = await alertService.processIssueAlerts(
        'org-1',
        mockIssue,
        'created'
      );

      expect(Array.isArray(alerts)).toBe(true);
      expect(alerts).toHaveLength(0);
    });

    it('should handle database errors gracefully', async () => {
      mockQuery.mockRejectedValue(new Error('Database connection failed'));

      await expect(
        alertService.processIssueAlerts('org-1', mockIssue, 'created')
      ).rejects.toThrow('Database connection failed');
    });
  });

  describe('doesRuleApplyToIssue', () => {
    const mockRule = {
      id: 'rule-1',
      organizationId: 'org-1',
      alertType: 'missing_estimate' as AlertType,
      isEnabled: true,
      severity: 'medium' as const,
      conditions: { projectKeys: ['TEST'] },
      thresholds: { estimateRequiredAfterHours: 24 },
      filters: {},
      notificationSettings: { channels: ['email'] as const, frequency: 'immediate' as const },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should return true for matching project', () => {
      const issue = createTestIssue({
        fields: { project: { key: 'TEST', id: '1', name: 'Test Project' } }
      });

      const result = (alertService as any).doesRuleApplyToIssue(mockRule, issue);
      expect(result).toBe(true);
    });

    it('should return false for non-matching project', () => {
      const issue = createTestIssue({
        fields: { project: { key: 'OTHER', id: '2', name: 'Other Project' } }
      });

      const result = (alertService as any).doesRuleApplyToIssue(mockRule, issue);
      expect(result).toBe(false);
    });

    it('should apply rule when no project filters are set', () => {
      const ruleWithNoFilters = {
        ...mockRule,
        conditions: {},
      };
      const issue = createTestIssue();

      const result = (alertService as any).doesRuleApplyToIssue(ruleWithNoFilters, issue);
      expect(result).toBe(true);
    });

    it('should filter by issue type', () => {
      const ruleWithIssueTypeFilter = {
        ...mockRule,
        conditions: { issueTypes: ['Bug'] },
      };
      const storyIssue = createTestIssue({
        fields: { issuetype: { name: 'Story', id: '1' } }
      });
      const bugIssue = createTestIssue({
        fields: { issuetype: { name: 'Bug', id: '2' } }
      });

      expect((alertService as any).doesRuleApplyToIssue(ruleWithIssueTypeFilter, storyIssue)).toBe(false);
      expect((alertService as any).doesRuleApplyToIssue(ruleWithIssueTypeFilter, bugIssue)).toBe(true);
    });

    it('should filter by assignee', () => {
      const ruleWithAssigneeFilter = {
        ...mockRule,
        conditions: { assigneeIds: ['user-1'] },
      };
      const assignedIssue = createTestIssue({
        fields: { assignee: { accountId: 'user-1', displayName: 'User 1' } }
      });
      const unassignedIssue = createTestIssue({
        fields: { assignee: null }
      });

      expect((alertService as any).doesRuleApplyToIssue(ruleWithAssigneeFilter, assignedIssue)).toBe(true);
      expect((alertService as any).doesRuleApplyToIssue(ruleWithAssigneeFilter, unassignedIssue)).toBe(false);
    });

    it('should respect exclude filters', () => {
      const ruleWithExcludes = {
        ...mockRule,
        filters: { 
          excludeStatuses: ['Done'],
          excludeIssueTypes: ['Epic'],
        },
      };
      const doneIssue = createTestIssue({
        fields: { 
          status: { name: 'Done', id: '3' },
          project: { key: 'TEST', id: '1', name: 'Test Project' }
        }
      });
      const todoIssue = createTestIssue({
        fields: { 
          status: { name: 'To Do', id: '1' },
          project: { key: 'TEST', id: '1', name: 'Test Project' }
        }
      });

      expect((alertService as any).doesRuleApplyToIssue(ruleWithExcludes, doneIssue)).toBe(false);
      expect((alertService as any).doesRuleApplyToIssue(ruleWithExcludes, todoIssue)).toBe(true);
    });
  });

  describe('MissingEstimateDetector', () => {
    let detector: any;
    const mockRule = {
      id: 'rule-1',
      organizationId: 'org-1',
      alertType: 'missing_estimate' as AlertType,
      isEnabled: true,
      severity: 'medium' as const,
      conditions: {},
      thresholds: { estimateRequiredAfterHours: 1 }, // 1 hour threshold
      filters: {},
      notificationSettings: { channels: ['email'] as const, frequency: 'immediate' as const },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    beforeEach(() => {
      detector = alertService['detectors'].get('missing_estimate');
    });

    it('should trigger when issue lacks estimate after threshold', async () => {
      // Issue created 2 hours ago without estimate
      const issueWithoutEstimate = createTestIssue({
        fields: {
          created: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          timeoriginalestimate: null,
          customfield_10001: null,
        }
      });

      const shouldTrigger = await detector.shouldTrigger(issueWithoutEstimate, mockRule);
      expect(shouldTrigger).toBe(true);
    });

    it('should not trigger when issue has time estimate', async () => {
      const issueWithEstimate = createTestIssue({
        fields: {
          timeoriginalestimate: 3600, // 1 hour in seconds
        }
      });

      const shouldTrigger = await detector.shouldTrigger(issueWithEstimate, mockRule);
      expect(shouldTrigger).toBe(false);
    });

    it('should not trigger when issue has story points', async () => {
      const issueWithStoryPoints = createTestIssue({
        fields: {
          customfield_10001: 5, // 5 story points
        }
      });

      const shouldTrigger = await detector.shouldTrigger(issueWithStoryPoints, mockRule);
      expect(shouldTrigger).toBe(false);
    });

    it('should not trigger before threshold time', async () => {
      const recentIssue = createTestIssue({
        fields: {
          created: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 minutes ago
          timeoriginalestimate: null,
          customfield_10001: null,
        }
      });

      const shouldTrigger = await detector.shouldTrigger(recentIssue, mockRule);
      expect(shouldTrigger).toBe(false);
    });

    it('should resolve when estimate is added', () => {
      const issueWithEstimate = createTestIssue({
        fields: {
          timeoriginalestimate: 3600,
        }
      });

      const shouldResolve = detector.shouldResolve(issueWithEstimate, mockRule);
      expect(shouldResolve).toBe(true);
    });

    it('should generate appropriate alert title', () => {
      const issue = createTestIssue();
      const title = detector.generateTitle(issue, mockRule);
      expect(title).toBe('Missing Estimate: TEST-123');
    });

    it('should generate descriptive alert description', () => {
      const issue = createTestIssue();
      const description = detector.generateDescription(issue, mockRule);
      expect(description).toContain('TEST-123');
      expect(description).toContain('1 hours');
      expect(description).toContain('estimate');
    });

    it('should generate comprehensive metadata', async () => {
      const issue = createTestIssue({
        fields: {
          created: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3 hours ago
        }
      });

      const metadata = await detector.generateMetadata(issue, mockRule);

      expect(metadata).toHaveProperty('issueData');
      expect(metadata).toHaveProperty('contextData');
      expect(metadata).toHaveProperty('thresholds');
      expect(metadata).toHaveProperty('triggerData');
      expect(metadata.issueData.summary).toBe('Test issue');
      expect(metadata.contextData.createdHoursAgo).toBe(3);
      expect(metadata.thresholds).toEqual(mockRule.thresholds);
    });
  });

  describe('error handling', () => {
    it('should handle invalid detector types gracefully', async () => {
      const invalidRule = {
        id: 'rule-1',
        organizationId: 'org-1',
        alertType: 'invalid_type' as AlertType,
        isEnabled: true,
        severity: 'medium' as const,
        conditions: { projectKeys: ['TEST'] },
        thresholds: {},
        filters: {},
        notificationSettings: { channels: ['email' as const], frequency: 'immediate' as const },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      alertService['activeRules'].set('org-1', [invalidRule]);
      const issue = createTestIssue();

      // Should not throw, just skip the invalid detector
      const alerts = await alertService.processIssueAlerts('org-1', issue, 'created');
      expect(alerts).toEqual([]);
    });

    it('should log warnings for missing detectors', async () => {
      const mockLogger = require('@/utils/logger').logger;
      
      const invalidRule = {
        id: 'rule-1',
        organizationId: 'org-1',
        alertType: 'non_existent_type' as AlertType,
        isEnabled: true,
        severity: 'medium' as const,
        conditions: { projectKeys: ['TEST'] },
        thresholds: {},
        filters: {},
        notificationSettings: { channels: ['email' as const], frequency: 'immediate' as const },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      alertService['activeRules'].set('org-1', [invalidRule]);
      const issue = createTestIssue();

      await alertService.processIssueAlerts('org-1', issue, 'created');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'No detector found for alert type',
        { alertType: 'non_existent_type' }
      );
    });
  });
});