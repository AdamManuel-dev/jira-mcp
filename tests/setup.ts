/**
 * @fileoverview Test setup and configuration for Jest
 * @lastmodified 2025-07-27T23:15:00Z
 * 
 * Features: Test environment setup, mocks, utilities, database seeding
 * Main APIs: Test configuration, mock factories, test utilities
 * Constraints: Runs before all tests, sets up isolated test environment
 * Patterns: Test isolation, mock dependency injection, test data factories
 */

import { config } from '@/config/environment';

// Set test environment
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Reduce logging noise in tests

// Global test setup
beforeAll(async () => {
  // Setup test database if needed
  // await setupTestDatabase();
});

// Global test teardown
afterAll(async () => {
  // Cleanup test database if needed
  // await cleanupTestDatabase();
});

// Reset mocks after each test
afterEach(() => {
  jest.clearAllMocks();
});

// Mock external dependencies
jest.mock('@/config/redis', () => ({
  cache: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
  },
  connectRedis: jest.fn(),
  disconnectRedis: jest.fn(),
}));

jest.mock('@/database/connection', () => ({
  query: jest.fn(),
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  transaction: jest.fn(),
  healthCheck: jest.fn(),
}));

// Test utilities
export const createMockRequest = (overrides: any = {}) => ({
  params: {},
  query: {},
  body: {},
  headers: {},
  user: undefined,
  ip: '127.0.0.1',
  method: 'GET',
  path: '/test',
  ...overrides,
});

export const createMockResponse = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.set = jest.fn().mockReturnValue(res);
  return res;
};

export const createMockNext = () => jest.fn();

// Test data factories
export const createTestUser = (overrides: any = {}) => ({
  id: 'test-user-id',
  email: 'test@example.com',
  name: 'Test User',
  role: 'developer',
  organizationId: 'test-org-id',
  ...overrides,
});

export const createTestAlert = (overrides: any = {}) => ({
  id: 'test-alert-id',
  alertType: 'missing_estimate',
  severity: 'warning',
  title: 'Test Alert',
  description: 'Test alert description',
  issueId: 'test-issue-id',
  issueKey: 'TEST-123',
  organizationId: 'test-org-id',
  ruleId: 'test-rule-id',
  status: 'active',
  detectedAt: new Date(),
  notificationCount: 0,
  ...overrides,
});

export const createTestSprint = (overrides: any = {}) => ({
  id: 'test-sprint-id',
  name: 'Test Sprint',
  state: 'active',
  startDate: new Date().toISOString(),
  endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 2 weeks from now
  ...overrides,
});

export const createTestIssue = (overrides: any = {}) => ({
  id: 'test-issue-id',
  key: 'TEST-123',
  fields: {
    summary: 'Test issue',
    description: 'Test description',
    status: { name: 'To Do', id: '1' },
    issuetype: { name: 'Story', id: '1' },
    project: { key: 'TEST', id: '1', name: 'Test Project' },
    assignee: { accountId: 'user-1', displayName: 'Test User' },
    reporter: { accountId: 'user-2', displayName: 'Reporter' },
    priority: { name: 'Medium', id: '2' },
    created: '2024-01-01T10:00:00Z',
    updated: '2024-01-01T11:00:00Z',
    labels: [],
    components: [],
    timeoriginalestimate: null,
    timeestimate: null,
    timespent: null,
    customfield_10001: null, // Story points
    ...overrides.fields,
  },
  ...overrides,
});

// Async test helper
export const asyncTest = (fn: () => Promise<void>) => {
  return async () => {
    try {
      await fn();
    } catch (error) {
      console.error('Async test error:', error);
      throw error;
    }
  };
};

// Custom matchers
expect.extend({
  toBeValidUUID(received: string) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const pass = uuidRegex.test(received);
    
    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid UUID`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid UUID`,
        pass: false,
      };
    }
  },
});

// Declare custom matcher types
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidUUID(): R;
    }
  }
}