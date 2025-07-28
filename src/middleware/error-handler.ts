/**
 * @fileoverview Global error handling middleware for Express
 * @lastmodified 2025-07-27T23:15:00Z
 * 
 * Features: Centralized error handling, error categorization, logging, response formatting
 * Main APIs: Error middleware function, custom error classes
 * Constraints: Must be last middleware in chain, handles all error types
 * Patterns: Error inheritance, consistent response format, security-aware error messages
 */

import { Request, Response, NextFunction } from 'express';
import { logger, logError } from '@/utils/logger';
import { config } from '@/config/environment';

// Custom error classes
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly code?: string;
  public readonly context?: Record<string, any>;

  constructor(
    message: string,
    statusCode: number = 500,
    isOperational: boolean = true,
    code?: string,
    context?: Record<string, any>
  ) {
    super(message);
    
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.code = code;
    this.context = context;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, field?: string, value?: any) {
    super(message, 400, true, 'VALIDATION_ERROR', { field, value });
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required') {
    super(message, 401, true, 'AUTHENTICATION_ERROR');
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 403, true, 'AUTHORIZATION_ERROR');
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404, true, 'NOT_FOUND_ERROR', { resource });
  }
}

export class ConflictError extends AppError {
  constructor(message: string, conflictingField?: string) {
    super(message, 409, true, 'CONFLICT_ERROR', { conflictingField });
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Too many requests') {
    super(message, 429, true, 'RATE_LIMIT_ERROR');
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, originalError?: Error) {
    super(
      `External service error: ${service}`,
      502,
      true,
      'EXTERNAL_SERVICE_ERROR',
      { service, originalError: originalError?.message }
    );
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, originalError?: Error) {
    super(
      `Database error: ${message}`,
      500,
      true,
      'DATABASE_ERROR',
      { originalError: originalError?.message }
    );
  }
}

// Error response interface
interface ErrorResponse {
  error: {
    message: string;
    code?: string;
    statusCode: number;
    timestamp: string;
    requestId?: string;
    details?: any;
    stack?: string;
  };
}

// Handle different types of errors
const handleCastError = (error: any): AppError => {
  return new ValidationError(`Invalid ${error.path}: ${error.value}`);
};

const handleDuplicateFieldsError = (error: any): AppError => {
  const field = Object.keys(error.keyValue)[0];
  const value = error.keyValue[field];
  return new ConflictError(`Duplicate field value: ${field} = ${value}`, field);
};

const handleValidationError = (error: any): AppError => {
  const errors = Object.values(error.errors).map((err: any) => err.message);
  return new ValidationError(`Invalid input data: ${errors.join('. ')}`);
};

const handleJWTError = (): AppError => {
  return new AuthenticationError('Invalid token. Please log in again');
};

const handleJWTExpiredError = (): AppError => {
  return new AuthenticationError('Your token has expired. Please log in again');
};

const handlePostgresError = (error: any): AppError => {
  switch (error.code) {
    case '23505': // Unique violation
      return new ConflictError('Duplicate entry found');
    case '23503': // Foreign key violation
      return new ValidationError('Referenced record does not exist');
    case '23502': // Not null violation
      return new ValidationError('Required field is missing');
    case '22001': // String data right truncation
      return new ValidationError('Data too long for field');
    case '23514': // Check constraint violation
      return new ValidationError('Data violates business rules');
    default:
      return new DatabaseError(error.message, error);
  }
};

// Send error response
const sendErrorDev = (err: AppError, req: Request, res: Response): void => {
  const errorResponse: ErrorResponse = {
    error: {
      message: err.message,
      code: err.code,
      statusCode: err.statusCode,
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'] as string,
      details: err.context,
      stack: err.stack,
    },
  };

  res.status(err.statusCode).json(errorResponse);
};

const sendErrorProd = (err: AppError, req: Request, res: Response): void => {
  // Only send operational errors to client in production
  if (err.isOperational) {
    const errorResponse: ErrorResponse = {
      error: {
        message: err.message,
        code: err.code,
        statusCode: err.statusCode,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string,
      },
    };

    res.status(err.statusCode).json(errorResponse);
  } else {
    // Send generic error message for programming errors
    const errorResponse: ErrorResponse = {
      error: {
        message: 'Something went wrong!',
        code: 'INTERNAL_SERVER_ERROR',
        statusCode: 500,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string,
      },
    };

    res.status(500).json(errorResponse);
  }
};

// Main error handling middleware
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  let error = { ...err } as AppError;
  error.message = err.message;

  // Log error with context
  logError(err, {
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: (req as any).user?.id,
    requestId: req.headers['x-request-id'],
  });

  // Convert known errors to AppError instances
  if (err.name === 'CastError') {
    error = handleCastError(err);
  } else if (err.name === 'MongoError' && (err as any).code === 11000) {
    error = handleDuplicateFieldsError(err);
  } else if (err.name === 'ValidationError') {
    error = handleValidationError(err);
  } else if (err.name === 'JsonWebTokenError') {
    error = handleJWTError();
  } else if (err.name === 'TokenExpiredError') {
    error = handleJWTExpiredError();
  } else if ((err as any).code && typeof (err as any).code === 'string') {
    // PostgreSQL errors
    error = handlePostgresError(err);
  } else if (!(err instanceof AppError)) {
    // Unknown errors - convert to generic AppError
    error = new AppError(
      config.isProduction() ? 'Something went wrong!' : err.message,
      500,
      false
    );
  }

  // Send response based on environment
  if (config.isDevelopment()) {
    sendErrorDev(error, req, res);
  } else {
    sendErrorProd(error, req, res);
  }
};

// Async error wrapper
export const catchAsync = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// 404 handler for unmatched routes
export const notFoundHandler = (req: Request, res: Response, next: NextFunction): void => {
  const error = new NotFoundError(`Route ${req.originalUrl}`);
  next(error);
};

// Unhandled rejection handler
export const handleUnhandledRejection = (): void => {
  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    logger.error('Unhandled Rejection:', {
      reason: reason?.message || reason,
      stack: reason?.stack,
      promise: promise.toString(),
    });
    
    // Graceful shutdown
    process.exit(1);
  });
};

// Uncaught exception handler
export const handleUncaughtException = (): void => {
  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught Exception:', {
      message: error.message,
      stack: error.stack,
    });
    
    // Graceful shutdown
    process.exit(1);
  });
};

// Graceful shutdown handler
export const handleGracefulShutdown = (server: any): void => {
  const shutdown = (signal: string) => {
    logger.info(`${signal} received. Starting graceful shutdown...`);
    
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
    
    // Force close after 30 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after 30 seconds');
      process.exit(1);
    }, 30000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};