/**
 * @fileoverview Centralized logging utility for SIAS
 * @lastmodified 2025-07-27T23:15:00Z
 * 
 * Features: Structured logging, multiple transports, log levels, performance tracking
 * Main APIs: Logger instance with debug, info, warn, error methods
 * Constraints: Uses Winston for production, console for development
 * Patterns: Singleton logger, contextual logging, error sanitization
 */

import winston from 'winston';
import { config } from '@/config/environment';

// Custom log format
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS',
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level.toUpperCase()}]: ${message}${metaString}`;
  })
);

// Development format (more readable)
const devFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({
    format: 'HH:mm:ss',
  }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaString = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
    return `${timestamp} ${level}: ${message}${metaString}`;
  })
);

// Create transports based on environment
const transports: winston.transport[] = [];

if (config.isDevelopment()) {
  // Console transport for development
  transports.push(
    new winston.transports.Console({
      format: devFormat,
      level: config.monitoring.logLevel,
    })
  );
} else {
  // File transports for production
  transports.push(
    // Error log
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: logFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 10,
    }),
    
    // Combined log
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: logFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 10,
    }),
    
    // Console for production (structured)
    new winston.transports.Console({
      format: logFormat,
      level: config.monitoring.logLevel,
    })
  );
}

// Create logger instance
const logger = winston.createLogger({
  level: config.monitoring.logLevel,
  format: logFormat,
  defaultMeta: {
    service: 'sias',
    environment: config.nodeEnv,
    version: process.env.npm_package_version || '1.0.0',
  },
  transports,
  exitOnError: false,
});

// Performance logging utilities
class PerformanceLogger {
  private timers: Map<string, number> = new Map();

  start(label: string): void {
    this.timers.set(label, Date.now());
  }

  end(label: string, metadata?: Record<string, any>): number {
    const startTime = this.timers.get(label);
    if (!startTime) {
      logger.warn(`Performance timer '${label}' was not started`);
      return 0;
    }

    const duration = Date.now() - startTime;
    this.timers.delete(label);

    logger.info(`Performance: ${label}`, {
      duration: `${duration}ms`,
      ...metadata,
    });

    return duration;
  }

  measure<T>(label: string, fn: () => T, metadata?: Record<string, any>): T {
    this.start(label);
    try {
      const result = fn();
      this.end(label, metadata);
      return result;
    } catch (error) {
      this.end(label, { ...metadata, error: true });
      throw error;
    }
  }

  async measureAsync<T>(
    label: string, 
    fn: () => Promise<T>, 
    metadata?: Record<string, any>
  ): Promise<T> {
    this.start(label);
    try {
      const result = await fn();
      this.end(label, metadata);
      return result;
    } catch (error) {
      this.end(label, { ...metadata, error: true });
      throw error;
    }
  }
}

// Create performance logger instance
const perf = new PerformanceLogger();

// Context-aware logging utilities
class ContextLogger {
  constructor(private context: Record<string, any>) {}

  debug(message: string, meta?: Record<string, any>): void {
    logger.debug(message, { ...this.context, ...meta });
  }

  info(message: string, meta?: Record<string, any>): void {
    logger.info(message, { ...this.context, ...meta });
  }

  warn(message: string, meta?: Record<string, any>): void {
    logger.warn(message, { ...this.context, ...meta });
  }

  error(message: string, meta?: Record<string, any>): void {
    logger.error(message, { ...this.context, ...meta });
  }

  child(additionalContext: Record<string, any>): ContextLogger {
    return new ContextLogger({ ...this.context, ...additionalContext });
  }
}

// Utility functions
const createContextLogger = (context: Record<string, any>): ContextLogger => {
  return new ContextLogger(context);
};

// Sanitize sensitive data before logging
const sanitizeForLog = (data: any): any => {
  if (typeof data !== 'object' || data === null) {
    return data;
  }

  const sensitiveKeys = [
    'password',
    'token',
    'secret',
    'key',
    'authorization',
    'cookie',
    'credentials',
    'auth',
  ];

  const sanitized = { ...data };

  Object.keys(sanitized).forEach(key => {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof sanitized[key] === 'object') {
      sanitized[key] = sanitizeForLog(sanitized[key]);
    }
  });

  return sanitized;
};

// Request logging utility
const logRequest = (req: any, res: any, duration?: number) => {
  const logData = {
    method: req.method,
    url: req.originalUrl || req.url,
    statusCode: res.statusCode,
    userAgent: req.get('User-Agent'),
    ip: req.ip || req.connection.remoteAddress,
    userId: req.user?.id,
    duration: duration ? `${duration}ms` : undefined,
  };

  if (res.statusCode >= 400) {
    logger.warn('HTTP Request', logData);
  } else {
    logger.info('HTTP Request', logData);
  }
};

// Error logging utility
const logError = (error: Error, context?: Record<string, any>) => {
  const errorData = {
    name: error.name,
    message: error.message,
    stack: error.stack,
    ...sanitizeForLog(context || {}),
  };

  logger.error('Application Error', errorData);
};

// Database query logging
const logDatabaseQuery = (query: string, params?: any[], duration?: number, rowCount?: number) => {
  const logData = {
    query: query.replace(/\s+/g, ' ').trim(),
    params: sanitizeForLog(params),
    duration: duration ? `${duration}ms` : undefined,
    rowCount,
  };

  if (duration && duration > 1000) {
    logger.warn('Slow Database Query', logData);
  } else {
    logger.debug('Database Query', logData);
  }
};

// External API logging
const logExternalRequest = (
  method: string,
  url: string,
  statusCode?: number,
  duration?: number,
  error?: Error
) => {
  const logData = {
    method,
    url,
    statusCode,
    duration: duration ? `${duration}ms` : undefined,
    error: error ? error.message : undefined,
  };

  if (error || (statusCode && statusCode >= 400)) {
    logger.error('External API Request Failed', logData);
  } else {
    logger.info('External API Request', logData);
  }
};

export {
  logger,
  perf,
  createContextLogger,
  sanitizeForLog,
  logRequest,
  logError,
  logDatabaseQuery,
  logExternalRequest,
  ContextLogger,
};