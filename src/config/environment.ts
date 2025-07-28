/**
 * @fileoverview Environment configuration management for SIAS
 * @lastmodified 2025-07-27T23:15:00Z
 * 
 * Features: Type-safe environment configuration, validation, default values
 * Main APIs: Configuration object with nested structure, validation functions
 * Constraints: Requires environment variables for production, provides defaults for development
 * Patterns: Schema validation, type safety, hierarchical configuration
 */

import dotenv from 'dotenv';
import Joi from 'joi';

// Load environment variables
dotenv.config();

// Environment validation schema
const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3000),
  API_VERSION: Joi.string().default('v1'),
  
  // Database
  DATABASE_URL: Joi.string().uri().required(),
  DATABASE_HOST: Joi.string().default('localhost'),
  DATABASE_PORT: Joi.number().port().default(5432),
  DATABASE_NAME: Joi.string().required(),
  DATABASE_USER: Joi.string().required(),
  DATABASE_PASSWORD: Joi.string().required(),
  
  // Redis
  REDIS_URL: Joi.string().uri().default('redis://localhost:6379'),
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').default(''),
  
  // JWT
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('24h'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
  
  // JIRA
  JIRA_CLIENT_ID: Joi.string().required(),
  JIRA_CLIENT_SECRET: Joi.string().required(),
  JIRA_REDIRECT_URI: Joi.string().uri().required(),
  JIRA_SCOPES: Joi.string().default('read:jira-work,read:jira-user,write:jira-work'),
  
  // GitHub
  GITHUB_CLIENT_ID: Joi.string().required(),
  GITHUB_CLIENT_SECRET: Joi.string().required(),
  GITHUB_WEBHOOK_SECRET: Joi.string().required(),
  
  // GitLab
  GITLAB_CLIENT_ID: Joi.string().required(),
  GITLAB_CLIENT_SECRET: Joi.string().required(),
  GITLAB_WEBHOOK_SECRET: Joi.string().required(),
  
  // Bitbucket
  BITBUCKET_CLIENT_ID: Joi.string().required(),
  BITBUCKET_CLIENT_SECRET: Joi.string().required(),
  
  // Notifications
  EMAIL_SERVICE_API_KEY: Joi.string().required(),
  EMAIL_FROM_ADDRESS: Joi.string().email().required(),
  EMAIL_FROM_NAME: Joi.string().default('SIAS Alert System'),
  
  SLACK_BOT_TOKEN: Joi.string().optional(),
  SLACK_SIGNING_SECRET: Joi.string().optional(),
  
  TEAMS_WEBHOOK_URL: Joi.string().uri().optional(),
  
  SMS_SERVICE_SID: Joi.string().optional(),
  SMS_SERVICE_AUTH_TOKEN: Joi.string().optional(),
  SMS_FROM_NUMBER: Joi.string().optional(),
  
  // File Storage
  AWS_ACCESS_KEY_ID: Joi.string().required(),
  AWS_SECRET_ACCESS_KEY: Joi.string().required(),
  AWS_S3_BUCKET: Joi.string().required(),
  AWS_S3_REGION: Joi.string().default('us-east-1'),
  
  // ML
  ML_MODEL_API_URL: Joi.string().uri().default('http://localhost:8000'),
  ML_MODEL_API_KEY: Joi.string().optional(),
  
  // Monitoring
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
  SENTRY_DSN: Joi.string().uri().optional(),
  
  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: Joi.number().default(3600000), // 1 hour
  RATE_LIMIT_MAX_REQUESTS: Joi.number().default(1000),
  
  // WebSocket
  WS_HEARTBEAT_INTERVAL: Joi.number().default(30000),
  WS_MAX_CONNECTIONS: Joi.number().default(1000),
}).unknown();

const { error, value: envVars } = envSchema.validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

export const config = {
  nodeEnv: envVars.NODE_ENV,
  port: envVars.PORT,
  apiVersion: envVars.API_VERSION,
  
  database: {
    url: envVars.DATABASE_URL,
    host: envVars.DATABASE_HOST,
    port: envVars.DATABASE_PORT,
    name: envVars.DATABASE_NAME,
    user: envVars.DATABASE_USER,
    password: envVars.DATABASE_PASSWORD,
  },
  
  redis: {
    url: envVars.REDIS_URL,
    host: envVars.REDIS_HOST,
    port: envVars.REDIS_PORT,
    password: envVars.REDIS_PASSWORD,
  },
  
  jwt: {
    secret: envVars.JWT_SECRET,
    expiresIn: envVars.JWT_EXPIRES_IN,
    refreshExpiresIn: envVars.JWT_REFRESH_EXPIRES_IN,
  },
  
  integrations: {
    jira: {
      clientId: envVars.JIRA_CLIENT_ID,
      clientSecret: envVars.JIRA_CLIENT_SECRET,
      redirectUri: envVars.JIRA_REDIRECT_URI,
      scopes: envVars.JIRA_SCOPES.split(','),
    },
    github: {
      clientId: envVars.GITHUB_CLIENT_ID,
      clientSecret: envVars.GITHUB_CLIENT_SECRET,
      webhookSecret: envVars.GITHUB_WEBHOOK_SECRET,
    },
    gitlab: {
      clientId: envVars.GITLAB_CLIENT_ID,
      clientSecret: envVars.GITLAB_CLIENT_SECRET,
      webhookSecret: envVars.GITLAB_WEBHOOK_SECRET,
    },
    bitbucket: {
      clientId: envVars.BITBUCKET_CLIENT_ID,
      clientSecret: envVars.BITBUCKET_CLIENT_SECRET,
    },
  },
  
  notifications: {
    email: {
      apiKey: envVars.EMAIL_SERVICE_API_KEY,
      fromAddress: envVars.EMAIL_FROM_ADDRESS,
      fromName: envVars.EMAIL_FROM_NAME,
    },
    slack: {
      botToken: envVars.SLACK_BOT_TOKEN,
      signingSecret: envVars.SLACK_SIGNING_SECRET,
    },
    teams: {
      webhookUrl: envVars.TEAMS_WEBHOOK_URL,
    },
    sms: {
      serviceSid: envVars.SMS_SERVICE_SID,
      authToken: envVars.SMS_SERVICE_AUTH_TOKEN,
      fromNumber: envVars.SMS_FROM_NUMBER,
    },
  },
  
  storage: {
    aws: {
      accessKeyId: envVars.AWS_ACCESS_KEY_ID,
      secretAccessKey: envVars.AWS_SECRET_ACCESS_KEY,
      s3Bucket: envVars.AWS_S3_BUCKET,
      s3Region: envVars.AWS_S3_REGION,
    },
  },
  
  ml: {
    apiUrl: envVars.ML_MODEL_API_URL,
    apiKey: envVars.ML_MODEL_API_KEY,
  },
  
  monitoring: {
    logLevel: envVars.LOG_LEVEL,
    sentryDsn: envVars.SENTRY_DSN,
  },
  
  rateLimit: {
    windowMs: envVars.RATE_LIMIT_WINDOW_MS,
    maxRequests: envVars.RATE_LIMIT_MAX_REQUESTS,
  },
  
  websocket: {
    heartbeatInterval: envVars.WS_HEARTBEAT_INTERVAL,
    maxConnections: envVars.WS_MAX_CONNECTIONS,
  },
  
  cors: {
    origin: envVars.NODE_ENV === 'production' 
      ? ['https://yourdomain.com'] 
      : ['http://localhost:3000', 'http://localhost:3001'],
  },
  
  // Helper methods
  isDevelopment: () => envVars.NODE_ENV === 'development',
  isProduction: () => envVars.NODE_ENV === 'production',
  isTest: () => envVars.NODE_ENV === 'test',
};