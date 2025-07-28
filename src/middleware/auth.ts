/**
 * @fileoverview Authentication middleware for JWT and OAuth
 * @lastmodified 2025-07-27T23:15:00Z
 * 
 * Features: JWT verification, OAuth token validation, role-based access control
 * Main APIs: Authentication middleware, authorization middleware, token utilities
 * Constraints: Requires JWT configuration, integrates with Redis for token blacklist
 * Patterns: Bearer token extraction, role-based permissions, token refresh handling
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '@/config/environment';
import { cache } from '@/config/redis';
import { logger } from '@/utils/logger';
import { AuthenticationError, AuthorizationError } from './error-handler';

// Extended Request interface to include user
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    role: string;
    organizationId: string;
    permissions?: string[];
  };
}

interface JWTPayload {
  id: string;
  email: string;
  name: string;
  role: string;
  organizationId: string;
  permissions?: string[];
  iat: number;
  exp: number;
}

// Extract JWT token from request headers
const extractTokenFromHeader = (req: Request): string | null => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return null;
  }
  
  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  return authHeader.substring(7); // Remove 'Bearer ' prefix
};

// Verify JWT token
const verifyToken = async (token: string): Promise<JWTPayload> => {
  try {
    // Check if token is blacklisted
    const isBlacklisted = await cache.exists(`blacklist:${token}`);
    if (isBlacklisted) {
      throw new AuthenticationError('Token has been revoked');
    }
    
    // Verify token signature and expiration
    const decoded = jwt.verify(token, config.jwt.secret) as JWTPayload;
    
    return decoded;
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      throw new AuthenticationError('Invalid token');
    }
    if (error instanceof jwt.TokenExpiredError) {
      throw new AuthenticationError('Token has expired');
    }
    throw error;
  }
};

// Generate JWT token
export const generateToken = (payload: Omit<JWTPayload, 'iat' | 'exp'>): string => {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
    issuer: 'sias',
    audience: 'sias-users',
  });
};

// Generate refresh token
export const generateRefreshToken = (userId: string): string => {
  return jwt.sign({ userId, type: 'refresh' }, config.jwt.secret, {
    expiresIn: config.jwt.refreshExpiresIn,
    issuer: 'sias',
    audience: 'sias-refresh',
  });
};

// Blacklist token (for logout)
export const blacklistToken = async (token: string): Promise<void> => {
  try {
    const decoded = jwt.decode(token) as JWTPayload;
    if (decoded && decoded.exp) {
      const ttl = decoded.exp - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        await cache.set(`blacklist:${token}`, '1', ttl);
      }
    }
  } catch (error) {
    logger.error('Error blacklisting token:', error);
    throw error;
  }
};

// Main authentication middleware
export const authMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Skip authentication for health check and public routes
    const publicRoutes = ['/health', '/docs', '/auth/login', '/auth/register'];
    const isPublicRoute = publicRoutes.some(route => req.path.startsWith(route));
    
    if (isPublicRoute) {
      return next();
    }
    
    // Extract token from header
    const token = extractTokenFromHeader(req);
    if (!token) {
      throw new AuthenticationError('No token provided');
    }
    
    // Verify token and get user payload
    const userPayload = await verifyToken(token);
    
    // Attach user to request
    req.user = userPayload;
    
    logger.debug('User authenticated:', {
      userId: userPayload.id,
      email: userPayload.email,
      role: userPayload.role,
      path: req.path,
    });
    
    next();
  } catch (error) {
    next(error);
  }
};

// Optional authentication middleware (doesn't fail if no token)
export const optionalAuthMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = extractTokenFromHeader(req);
    if (token) {
      const userPayload = await verifyToken(token);
      req.user = userPayload;
    }
    next();
  } catch (error) {
    // Continue without authentication for optional routes
    next();
  }
};

// Role-based authorization middleware
export const requireRole = (...roles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AuthenticationError('Authentication required'));
    }
    
    if (!roles.includes(req.user.role)) {
      logger.warn('Access denied - insufficient role:', {
        userId: req.user.id,
        userRole: req.user.role,
        requiredRoles: roles,
        path: req.path,
      });
      
      return next(new AuthorizationError(
        `Access denied. Required role: ${roles.join(' or ')}`
      ));
    }
    
    next();
  };
};

// Permission-based authorization middleware
export const requirePermission = (...permissions: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AuthenticationError('Authentication required'));
    }
    
    const userPermissions = req.user.permissions || [];
    const hasPermission = permissions.some(permission => 
      userPermissions.includes(permission)
    );
    
    if (!hasPermission) {
      logger.warn('Access denied - insufficient permissions:', {
        userId: req.user.id,
        userPermissions,
        requiredPermissions: permissions,
        path: req.path,
      });
      
      return next(new AuthorizationError(
        `Access denied. Required permission: ${permissions.join(' or ')}`
      ));
    }
    
    next();
  };
};

// Organization access middleware
export const requireOrganizationAccess = (organizationIdParam: string = 'organizationId') => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AuthenticationError('Authentication required'));
    }
    
    const requestedOrgId = req.params[organizationIdParam];
    if (!requestedOrgId) {
      return next(new AuthorizationError('Organization ID required'));
    }
    
    // Admins can access any organization
    if (req.user.role === 'admin') {
      return next();
    }
    
    // Users can only access their own organization
    if (req.user.organizationId !== requestedOrgId) {
      logger.warn('Access denied - organization mismatch:', {
        userId: req.user.id,
        userOrganizationId: req.user.organizationId,
        requestedOrganizationId: requestedOrgId,
        path: req.path,
      });
      
      return next(new AuthorizationError('Access denied to this organization'));
    }
    
    next();
  };
};

// API key authentication middleware (for external integrations)
export const apiKeyAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const apiKey = req.headers['x-api-key'] as string;
    
    if (!apiKey) {
      throw new AuthenticationError('API key required');
    }
    
    // Validate API key (implement your API key validation logic)
    const isValidKey = await validateApiKey(apiKey);
    
    if (!isValidKey) {
      throw new AuthenticationError('Invalid API key');
    }
    
    // Log API key usage
    logger.info('API key authentication successful:', {
      apiKey: apiKey.substring(0, 8) + '...', // Log only first 8 characters
      path: req.path,
      ip: req.ip,
    });
    
    next();
  } catch (error) {
    next(error);
  }
};

// Webhook signature verification middleware
export const verifyWebhookSignature = (secretHeaderName: string, secret: string) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const signature = req.headers[secretHeaderName.toLowerCase()] as string;
      
      if (!signature) {
        throw new AuthenticationError('Webhook signature required');
      }
      
      // Implement signature verification logic based on provider
      const isValidSignature = verifySignature(req.body, signature, secret);
      
      if (!isValidSignature) {
        throw new AuthenticationError('Invalid webhook signature');
      }
      
      logger.debug('Webhook signature verified:', {
        header: secretHeaderName,
        path: req.path,
      });
      
      next();
    } catch (error) {
      next(error);
    }
  };
};

// Utility functions
const validateApiKey = async (apiKey: string): Promise<boolean> => {
  // TODO: Implement API key validation against database
  // This is a placeholder implementation
  try {
    const cachedKey = await cache.get(`api_key:${apiKey}`);
    return cachedKey !== null;
  } catch (error) {
    logger.error('Error validating API key:', error);
    return false;
  }
};

const verifySignature = (payload: any, signature: string, secret: string): boolean => {
  // TODO: Implement signature verification based on provider (GitHub, GitLab, etc.)
  // This is a placeholder implementation
  const crypto = require('crypto');
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(`sha256=${expectedSignature}`)
  );
};

// Token refresh utility
export const refreshToken = async (refreshTokenValue: string): Promise<string> => {
  try {
    const decoded = jwt.verify(refreshTokenValue, config.jwt.secret) as any;
    
    if (decoded.type !== 'refresh') {
      throw new AuthenticationError('Invalid refresh token');
    }
    
    // TODO: Fetch user data from database using decoded.userId
    // This is a placeholder - you'll need to implement user fetching
    const user = await getUserById(decoded.userId);
    
    if (!user) {
      throw new AuthenticationError('User not found');
    }
    
    // Generate new access token
    const newToken = generateToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: user.organizationId,
      permissions: user.permissions,
    });
    
    return newToken;
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      throw new AuthenticationError('Invalid refresh token');
    }
    if (error instanceof jwt.TokenExpiredError) {
      throw new AuthenticationError('Refresh token has expired');
    }
    throw error;
  }
};

// Placeholder for user fetching (implement with your database layer)
const getUserById = async (userId: string): Promise<any> => {
  // TODO: Implement user fetching from database
  return null;
};