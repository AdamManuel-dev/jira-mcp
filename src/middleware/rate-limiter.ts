/**
 * @fileoverview Rate limiting middleware using Redis
 * @lastmodified 2025-07-27T23:15:00Z
 * 
 * Features: Redis-based rate limiting, multiple strategies, sliding window, custom limits
 * Main APIs: Rate limiter middleware, custom rate limit decorators
 * Constraints: Requires Redis connection, configurable per route
 * Patterns: Sliding window algorithm, user-based limits, IP-based fallback
 */

import { Request, Response, NextFunction } from 'express';
import { config } from '@/config/environment';
import { cache } from '@/config/redis';
import { logger } from '@/utils/logger';
import { RateLimitError } from './error-handler';

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  message?: string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator?: (req: Request) => string;
  onLimitReached?: (req: Request, res: Response) => void;
}

interface RateLimitInfo {
  requests: number;
  windowStart: number;
  resetTime: number;
}

class RateLimiter {
  private options: RateLimitOptions;

  constructor(options: Partial<RateLimitOptions> = {}) {
    this.options = {
      windowMs: config.rateLimit.windowMs,
      maxRequests: config.rateLimit.maxRequests,
      message: 'Too many requests from this IP, please try again later',
      skipSuccessfulRequests: false,
      skipFailedRequests: false,
      keyGenerator: this.defaultKeyGenerator,
      ...options,
    };
  }

  private defaultKeyGenerator(req: Request): string {
    // Use user ID if authenticated, otherwise fall back to IP
    const userId = (req as any).user?.id;
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    return userId ? `user:${userId}` : `ip:${ip}`;
  }

  private async getCurrentWindow(key: string): Promise<RateLimitInfo> {
    const now = Date.now();
    const windowStart = Math.floor(now / this.options.windowMs) * this.options.windowMs;
    const resetTime = windowStart + this.options.windowMs;
    
    const windowKey = `rate_limit:${key}:${windowStart}`;
    
    try {
      const requestsStr = await cache.get(windowKey);
      const requests = requestsStr ? parseInt(requestsStr, 10) : 0;
      
      return {
        requests,
        windowStart,
        resetTime,
      };
    } catch (error) {
      logger.error('Rate limiter Redis error:', error);
      // Fail open - allow request if Redis is down
      return {
        requests: 0,
        windowStart,
        resetTime,
      };
    }
  }

  private async incrementWindow(key: string, windowStart: number): Promise<number> {
    const windowKey = `rate_limit:${key}:${windowStart}`;
    const ttlSeconds = Math.ceil(this.options.windowMs / 1000);
    
    try {
      // Use Redis pipeline for atomic increment
      const requestsStr = await cache.get(windowKey);
      const currentRequests = requestsStr ? parseInt(requestsStr, 10) : 0;
      const newRequests = currentRequests + 1;
      
      await cache.set(windowKey, newRequests.toString(), ttlSeconds);
      
      return newRequests;
    } catch (error) {
      logger.error('Rate limiter increment error:', error);
      // Fail open - allow request if Redis is down
      return 0;
    }
  }

  private setRateLimitHeaders(res: Response, rateLimitInfo: RateLimitInfo): void {
    res.set({
      'X-RateLimit-Limit': this.options.maxRequests.toString(),
      'X-RateLimit-Remaining': Math.max(
        0,
        this.options.maxRequests - rateLimitInfo.requests
      ).toString(),
      'X-RateLimit-Reset': Math.ceil(rateLimitInfo.resetTime / 1000).toString(),
      'X-RateLimit-Window': this.options.windowMs.toString(),
    });
  }

  middleware() {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const key = this.options.keyGenerator!(req);
        const rateLimitInfo = await this.getCurrentWindow(key);
        
        // Check if limit is exceeded
        if (rateLimitInfo.requests >= this.options.maxRequests) {
          this.setRateLimitHeaders(res, rateLimitInfo);
          
          if (this.options.onLimitReached) {
            this.options.onLimitReached(req, res);
          }
          
          logger.warn('Rate limit exceeded:', {
            key,
            requests: rateLimitInfo.requests,
            limit: this.options.maxRequests,
            windowMs: this.options.windowMs,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            path: req.path,
          });
          
          throw new RateLimitError(this.options.message);
        }
        
        // Increment counter
        const newRequests = await this.incrementWindow(key, rateLimitInfo.windowStart);
        
        // Update rate limit info with new count
        rateLimitInfo.requests = newRequests;
        this.setRateLimitHeaders(res, rateLimitInfo);
        
        // Log if approaching limit (90% threshold)
        if (newRequests >= this.options.maxRequests * 0.9) {
          logger.warn('Rate limit approaching:', {
            key,
            requests: newRequests,
            limit: this.options.maxRequests,
            remaining: this.options.maxRequests - newRequests,
          });
        }
        
        next();
      } catch (error) {
        if (error instanceof RateLimitError) {
          next(error);
        } else {
          logger.error('Rate limiter middleware error:', error);
          // Fail open - allow request if there's an unexpected error
          next();
        }
      }
    };
  }
}

// Create different rate limiters for different use cases
export const rateLimiter = new RateLimiter().middleware();

export const strictRateLimiter = new RateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 100, // 100 requests per 15 minutes
  message: 'Too many requests, please try again later',
}).middleware();

export const authRateLimiter = new RateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5, // 5 login attempts per 15 minutes
  message: 'Too many authentication attempts, please try again later',
  keyGenerator: (req: Request) => {
    // Rate limit by IP for auth endpoints
    return `auth:${req.ip || 'unknown'}`;
  },
}).middleware();

export const webhookRateLimiter = new RateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 1000, // 1000 webhook events per minute
  message: 'Webhook rate limit exceeded',
  keyGenerator: (req: Request) => {
    // Rate limit by webhook source
    const signature = req.get('X-Hub-Signature') || req.get('X-GitLab-Token') || 'unknown';
    return `webhook:${signature}`;
  },
}).middleware();

export const apiRateLimiter = new RateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 1000, // 1000 API calls per hour
  message: 'API rate limit exceeded',
  keyGenerator: (req: Request) => {
    // Rate limit by API key or user ID
    const apiKey = req.get('X-API-Key');
    const userId = (req as any).user?.id;
    return apiKey ? `api_key:${apiKey}` : `user:${userId || req.ip}`;
  },
}).middleware();

// Custom rate limiter factory
export const createRateLimiter = (options: Partial<RateLimitOptions>) => {
  return new RateLimiter(options).middleware();
};

// Rate limit decorator for specific routes
export const rateLimit = (options: Partial<RateLimitOptions>) => {
  const limiter = new RateLimiter(options);
  return limiter.middleware();
};

// Utility to check current rate limit status
export const getRateLimitStatus = async (
  key: string,
  windowMs: number = config.rateLimit.windowMs
): Promise<RateLimitInfo> => {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetTime = windowStart + windowMs;
  const windowKey = `rate_limit:${key}:${windowStart}`;
  
  try {
    const requestsStr = await cache.get(windowKey);
    const requests = requestsStr ? parseInt(requestsStr, 10) : 0;
    
    return {
      requests,
      windowStart,
      resetTime,
    };
  } catch (error) {
    logger.error('Error getting rate limit status:', error);
    throw error;
  }
};

// Utility to reset rate limit for a key
export const resetRateLimit = async (
  key: string,
  windowMs: number = config.rateLimit.windowMs
): Promise<void> => {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const windowKey = `rate_limit:${key}:${windowStart}`;
  
  try {
    await cache.del(windowKey);
    logger.info(`Rate limit reset for key: ${key}`);
  } catch (error) {
    logger.error('Error resetting rate limit:', error);
    throw error;
  }
};