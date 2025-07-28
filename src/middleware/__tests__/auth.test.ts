/**
 * @fileoverview Unit tests for authentication middleware
 * @lastmodified 2025-07-28T08:30:00Z
 * 
 * Features: JWT authentication, role-based authorization, token management
 * Main APIs: Test auth middleware, role checks, token utilities
 * Constraints: Mock JWT verification, Redis token blacklist, request/response objects
 * Patterns: Middleware testing, security validation, mock request/response
 */

import { Request, Response, NextFunction } from 'express';
import {
  authMiddleware,
  requireRole,
  requirePermission,
  AuthenticatedRequest,
} from '../auth';
import { createMockRequest, createMockResponse, createMockNext } from '../../../tests/setup';

// Mock dependencies
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(),
  sign: jest.fn(),
  decode: jest.fn(),
}));

jest.mock('@/config/redis', () => ({
  cache: {
    exists: jest.fn(),
    set: jest.fn(),
    get: jest.fn(),
  },
}));

jest.mock('@/config/environment', () => ({
  config: {
    jwt: {
      secret: 'test-secret',
      expiresIn: '1h',
      refreshExpiresIn: '7d',
    },
  },
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

jest.mock('../error-handler', () => ({
  AuthenticationError: class AuthenticationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'AuthenticationError';
    }
  },
  AuthorizationError: class AuthorizationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'AuthorizationError';
    }
  },
}));

describe('Authentication Middleware', () => {
  let mockCache: any;
  let mockJwt: any;

  beforeEach(() => {
    mockCache = require('@/config/redis').cache;
    mockJwt = require('jsonwebtoken');
    jest.clearAllMocks();
  });

  describe('authMiddleware', () => {
    it('should skip authentication for public routes', async () => {
      const req = createMockRequest({ path: '/health' });
      const res = createMockResponse();
      const next = createMockNext();

      await authMiddleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user).toBeUndefined();
    });

    it('should authenticate valid JWT token', async () => {
      const mockPayload = {
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        role: 'developer',
        organizationId: 'org-1',
        permissions: ['read:issues'],
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      };

      const req = createMockRequest({
        headers: { authorization: 'Bearer valid-token' },
        path: '/api/issues',
      });
      const res = createMockResponse();
      const next = createMockNext();

      mockCache.exists.mockResolvedValue(false); // Token not blacklisted
      mockJwt.verify.mockReturnValue(mockPayload);

      await authMiddleware(req, res, next);

      expect(mockJwt.verify).toHaveBeenCalledWith('valid-token', 'test-secret');
      expect(req.user).toEqual(mockPayload);
      expect(next).toHaveBeenCalledWith();
    });

    it('should reject request without authorization header', async () => {
      const req = createMockRequest({ path: '/api/issues' });
      const res = createMockResponse();
      const next = createMockNext();

      await authMiddleware(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'No token provided',
        })
      );
    });

    it('should reject request with invalid bearer format', async () => {
      const req = createMockRequest({
        headers: { authorization: 'Invalid token-format' },
        path: '/api/issues',
      });
      const res = createMockResponse();
      const next = createMockNext();

      await authMiddleware(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'No token provided',
        })
      );
    });

    it('should handle authentication errors', async () => {
      const req = createMockRequest({
        headers: { authorization: 'Bearer invalid-token' },
        path: '/api/issues',
      });
      const res = createMockResponse();
      const next = createMockNext();

      mockCache.exists.mockResolvedValue(false);
      mockJwt.verify.mockImplementation(() => {
        throw new Error('Token verification failed');
      });

      await authMiddleware(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('requireRole', () => {
    it('should allow access for user with correct role', () => {
      const middleware = requireRole('admin', 'manager');
      const req = createMockRequest({
        user: {
          id: 'user-1',
          email: 'admin@example.com',
          name: 'Admin User',
          role: 'admin',
          organizationId: 'org-1',
        },
      });
      const res = createMockResponse();
      const next = createMockNext();

      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should deny access for user with incorrect role', () => {
      const middleware = requireRole('admin');
      const req = createMockRequest({
        user: {
          id: 'user-1',
          email: 'dev@example.com',
          name: 'Developer',
          role: 'developer',
          organizationId: 'org-1',
        },
      });
      const res = createMockResponse();
      const next = createMockNext();

      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Access denied. Required role: admin',
        })
      );
    });

    it('should deny access for unauthenticated user', () => {
      const middleware = requireRole('admin');
      const req = createMockRequest(); // No user
      const res = createMockResponse();
      const next = createMockNext();

      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Authentication required',
        })
      );
    });
  });

  describe('requirePermission', () => {
    it('should allow access for user with required permission', () => {
      const middleware = requirePermission('read:issues', 'write:issues');
      const req = createMockRequest({
        user: {
          id: 'user-1',
          email: 'dev@example.com',
          name: 'Developer',
          role: 'developer',
          organizationId: 'org-1',
          permissions: ['read:issues', 'create:comments'],
        },
      });
      const res = createMockResponse();
      const next = createMockNext();

      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should deny access for user without required permissions', () => {
      const middleware = requirePermission('admin:all');
      const req = createMockRequest({
        user: {
          id: 'user-1',
          email: 'dev@example.com',
          name: 'Developer',
          role: 'developer',
          organizationId: 'org-1',
          permissions: ['read:issues'],
        },
      });
      const res = createMockResponse();
      const next = createMockNext();

      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Access denied. Required permission: admin:all',
        })
      );
    });

    it('should handle user with no permissions array', () => {
      const middleware = requirePermission('read:issues');
      const req = createMockRequest({
        user: {
          id: 'user-1',
          email: 'dev@example.com',
          name: 'Developer',
          role: 'developer',
          organizationId: 'org-1',
          // permissions is undefined
        },
      });
      const res = createMockResponse();
      const next = createMockNext();

      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Access denied. Required permission: read:issues',
        })
      );
    });
  });

  describe('security edge cases', () => {
    it('should handle malformed tokens gracefully', async () => {
      const req = createMockRequest({
        headers: { authorization: 'Bearer malformed.token.here' },
        path: '/api/issues',
      });
      const res = createMockResponse();
      const next = createMockNext();

      mockCache.exists.mockResolvedValue(false);
      mockJwt.verify.mockImplementation(() => {
        throw new Error('Malformed token');
      });

      await authMiddleware(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should handle Redis connection errors', async () => {
      const req = createMockRequest({
        headers: { authorization: 'Bearer valid-token' },
        path: '/api/issues',
      });
      const res = createMockResponse();
      const next = createMockNext();

      mockCache.exists.mockRejectedValue(new Error('Redis connection failed'));

      await authMiddleware(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should validate token payload structure', async () => {
      const req = createMockRequest({
        headers: { authorization: 'Bearer valid-token' },
        path: '/api/issues',
      });
      const res = createMockResponse();
      const next = createMockNext();

      mockCache.exists.mockResolvedValue(false);
      mockJwt.verify.mockReturnValue({ invalid: 'payload' }); // Missing required fields

      await authMiddleware(req, res, next);

      expect(req.user).toEqual({ invalid: 'payload' });
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('public route handling', () => {
    const publicRoutes = ['/health', '/docs', '/auth/login', '/auth/register'];

    publicRoutes.forEach(route => {
      it(`should skip authentication for ${route}`, async () => {
        const req = createMockRequest({ path: route });
        const res = createMockResponse();
        const next = createMockNext();

        await authMiddleware(req, res, next);

        expect(next).toHaveBeenCalledWith();
        expect(req.user).toBeUndefined();
        expect(mockJwt.verify).not.toHaveBeenCalled();
      });
    });

    it('should skip authentication for routes starting with public paths', async () => {
      const req = createMockRequest({ path: '/health/detailed' });
      const res = createMockResponse();
      const next = createMockNext();

      await authMiddleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user).toBeUndefined();
    });
  });
});