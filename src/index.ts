/**
 * @fileoverview Main application entry point for JIRA Sprint Intelligence Alert System
 * @lastmodified 2025-07-28T05:57:35Z
 * 
 * Features: Express server setup, middleware configuration, route registration, database initialization, graceful shutdown
 * Main APIs: Server initialization, health monitoring, process management, service lifecycle
 * Constraints: Requires environment variables, PostgreSQL connection, Redis cache, service dependencies
 * Patterns: Clean shutdown with resource cleanup, comprehensive error logging, middleware chain, service container
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { config } from '@/config/environment';
import { logger } from '@/utils/logger';
import { errorHandler } from '@/middleware/error-handler';
import { rateLimiter } from '@/middleware/rate-limiter';
import { authMiddleware } from '@/middleware/auth';
import { connectDatabase } from '@/database/connection';
import { connectRedis } from '@/config/redis';
import { initializeServices } from '@/services';
import { registerRoutes } from '@/config/routes';

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: config.cors.origin,
  credentials: true,
}));

// Parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(compression());

// Rate limiting
app.use(rateLimiter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: config.nodeEnv,
  });
});

// API routes
app.use(`/api/${config.apiVersion}`, authMiddleware, registerRoutes());

// Error handling
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.originalUrl} not found`,
    timestamp: new Date().toISOString(),
  });
});

async function startServer(): Promise<void> {
  try {
    // Connect to database
    await connectDatabase();
    logger.info('Database connected successfully');

    // Connect to Redis
    await connectRedis();
    logger.info('Redis connected successfully');

    // Initialize services
    await initializeServices();
    logger.info('Services initialized successfully');

    // Start server
    const server = app.listen(config.port, () => {
      logger.info(`SIAS server running on port ${config.port} in ${config.nodeEnv} mode`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, shutting down gracefully');
      server.close(() => {
        logger.info('Process terminated');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT received, shutting down gracefully');
      server.close(() => {
        logger.info('Process terminated');
        process.exit(0);
      });
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the application
if (require.main === module) {
  startServer();
}

export { app };