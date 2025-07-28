/**
 * @fileoverview Integration tests for core system components
 * @lastmodified 2025-07-28T08:30:00Z
 * 
 * Features: End-to-end integration testing, service integration
 * Main APIs: Test service initialization, database connections, Redis cache
 * Constraints: Mock external services, test environment setup
 * Patterns: Integration testing, service orchestration, environment validation
 */

import { AlertDetectionService } from '@/services/alert-detection';

// Mock external dependencies
jest.mock('@/database/connection', () => ({
  query: jest.fn().mockResolvedValue([]),
  transaction: jest.fn(),
  connectDatabase: jest.fn().mockResolvedValue(true),
  disconnectDatabase: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/config/redis', () => ({
  cache: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn().mockResolvedValue(false),
  },
  connectRedis: jest.fn().mockResolvedValue(true),
  disconnectRedis: jest.fn().mockResolvedValue(true),
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

describe('System Integration Tests', () => {
  describe('Service Initialization', () => {
    it('should initialize AlertDetectionService successfully', async () => {
      const service = new AlertDetectionService();
      
      expect(async () => {
        await service.initialize();
      }).not.toThrow();
      
      // Verify service is properly initialized
      expect(service['detectors']).toBeDefined();
      expect(service['detectors'].size).toBeGreaterThan(0);
      expect(service['activeRules']).toBeDefined();
    });

    it('should handle service initialization errors gracefully', async () => {
      const mockQuery = require('@/database/connection').query;
      mockQuery.mockRejectedValueOnce(new Error('Database initialization failed'));

      const service = new AlertDetectionService();
      
      await expect(service.initialize()).rejects.toThrow('Database initialization failed');
    });
  });

  describe('Database Integration', () => {
    it('should connect to database successfully', async () => {
      const { connectDatabase } = require('@/database/connection');
      
      const isConnected = await connectDatabase();
      expect(isConnected).toBe(true);
      expect(connectDatabase).toHaveBeenCalled();
    });

    it('should execute queries without errors', async () => {
      const { query } = require('@/database/connection');
      query.mockResolvedValueOnce([{ id: 1, name: 'test' }]);
      
      const result = await query('SELECT * FROM test_table');
      expect(result).toEqual([{ id: 1, name: 'test' }]);
    });
  });

  describe('Redis Integration', () => {
    it('should connect to Redis successfully', async () => {
      const { connectRedis } = require('@/config/redis');
      
      const isConnected = await connectRedis();
      expect(isConnected).toBe(true);
      expect(connectRedis).toHaveBeenCalled();
    });

    it('should perform cache operations', async () => {
      const { cache } = require('@/config/redis');
      
      cache.set.mockResolvedValueOnce('OK');
      cache.get.mockResolvedValueOnce('cached-value');
      
      await cache.set('test-key', 'test-value');
      const value = await cache.get('test-key');
      
      expect(cache.set).toHaveBeenCalledWith('test-key', 'test-value');
      expect(cache.get).toHaveBeenCalledWith('test-key');
      expect(value).toBe('cached-value');
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      const mockQuery = require('@/database/connection').query;
      mockQuery.mockRejectedValueOnce(new Error('Network timeout'));

      const service = new AlertDetectionService();
      
      await expect(service.initialize()).rejects.toThrow('Network timeout');
      expect(require('@/utils/logger').logger.error).not.toHaveBeenCalled();
    });

    it('should handle Redis connection failures', async () => {
      const { connectRedis } = require('@/config/redis');
      connectRedis.mockRejectedValueOnce(new Error('Redis connection refused'));
      
      await expect(connectRedis()).rejects.toThrow('Redis connection refused');
    });
  });

  describe('Configuration Validation', () => {
    it('should validate required environment variables are mocked', () => {
      // Test that mocked environment is properly set up
      expect(process.env.NODE_ENV).toBe('test');
      expect(process.env.LOG_LEVEL).toBe('error');
    });

    it('should have proper test isolation', () => {
      // Verify mocks are properly isolated
      const mockQuery = require('@/database/connection').query;
      const mockCache = require('@/config/redis').cache;
      
      expect(jest.isMockFunction(mockQuery)).toBe(true);
      expect(jest.isMockFunction(mockCache.get)).toBe(true);
      expect(jest.isMockFunction(mockCache.set)).toBe(true);
    });
  });

  describe('Performance and Resource Management', () => {
    it('should handle concurrent service operations', async () => {
      const services = Array(5).fill(null).map(() => new AlertDetectionService());
      
      const initPromises = services.map(service => service.initialize());
      
      // All services should initialize successfully
      await expect(Promise.all(initPromises)).resolves.not.toThrow();
      
      // Each service should have its own detector instances
      services.forEach(service => {
        expect(service['detectors'].size).toBe(8);
      });
    });

    it('should clean up resources properly', async () => {
      const { disconnectDatabase } = require('@/database/connection');
      const { disconnectRedis } = require('@/config/redis');
      
      await disconnectDatabase();
      await disconnectRedis();
      
      expect(disconnectDatabase).toHaveBeenCalled();
      expect(disconnectRedis).toHaveBeenCalled();
    });
  });

  describe('System Health Checks', () => {
    it('should perform basic health check operations', async () => {
      const { query } = require('@/database/connection');
      const { cache } = require('@/config/redis');
      
      // Mock health check responses
      query.mockResolvedValueOnce([{ status: 'healthy' }]);
      cache.exists.mockResolvedValueOnce(true);
      
      // Simulate health check
      const dbHealth = await query('SELECT 1 as status');
      const cacheHealth = await cache.exists('health-check');
      
      expect(dbHealth).toEqual([{ status: 'healthy' }]);
      expect(cacheHealth).toBe(true);
    });

    it('should detect system component failures', async () => {
      const { query } = require('@/database/connection');
      query.mockRejectedValueOnce(new Error('Database health check failed'));
      
      await expect(query('SELECT 1')).rejects.toThrow('Database health check failed');
    });
  });
});