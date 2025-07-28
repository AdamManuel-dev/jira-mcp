# 🚀 Getting Started Guide

Complete setup guide for the **JIRA Sprint Intelligence Alert System (SIAS)**. This guide covers installation, configuration, and initial setup for both development and production environments.

## 📋 Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Development Setup](#development-setup)
- [Configuration](#configuration)
- [Database Setup](#database-setup)
- [Integration Configuration](#integration-configuration)
- [Running the Application](#running-the-application)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)

## 🔧 Prerequisites

### System Requirements

| Component | Minimum Version | Recommended |
|-----------|----------------|-------------|
| **Node.js** | 18.0.0 | 20.x LTS |
| **npm** | 8.0.0 | 10.x |
| **PostgreSQL** | 14.0 | 15.x |
| **Redis** | 6.0 | 7.x |
| **Memory** | 2GB RAM | 4GB RAM |
| **Storage** | 10GB | 50GB |

### Required Accounts & Credentials

- **JIRA Instance**: Cloud or Server with admin access
- **Database**: PostgreSQL instance with database creation privileges
- **Cache**: Redis instance or cluster
- **Email Service**: SendGrid, AWS SES, or SMTP server (optional)
- **Git Provider**: GitHub, GitLab, or Bitbucket access (optional)

## ⚡ Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/your-org/jira-sprint-intelligence.git
cd jira-sprint-intelligence
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Setup

```bash
# Copy environment template
cp .env.example .env

# Edit configuration
nano .env
```

### 4. Database Initialization

```bash
# Create database
createdb sias_development

# Run migrations
npm run db:migrate

# Seed initial data (optional)
npm run db:seed
```

### 5. Start Development Server

```bash
npm run dev
```

The application will be available at `http://localhost:3000`

## 🛠️ Development Setup

### Project Structure Overview

```
jira-sprint-intelligence/
├── src/                      # Source code
│   ├── config/              # Configuration management
│   ├── controllers/         # HTTP request handlers
│   ├── database/           # Database schema and migrations
│   ├── integrations/       # External service integrations
│   ├── middleware/         # Express middleware
│   ├── services/           # Business logic services
│   ├── types/              # TypeScript type definitions
│   └── utils/              # Shared utilities
├── tests/                   # Test suites
├── docs/                    # Documentation
├── scripts/                 # Utility scripts
└── package.json            # Dependencies and scripts
```

### Development Scripts

```bash
# Development server with hot reload
npm run dev

# Build for production
npm run build

# Run tests
npm test
npm run test:watch          # Watch mode
npm run test:coverage       # With coverage

# Code quality
npm run lint                # ESLint
npm run lint:fix            # Auto-fix issues
npm run format              # Prettier formatting

# Database management
npm run db:migrate          # Run migrations
npm run db:rollback         # Rollback last migration
npm run db:seed             # Seed development data
npm run db:reset            # Reset database

# Type checking
npm run type-check          # TypeScript validation
```

### IDE Configuration

#### VS Code Extensions (Recommended)

Create `.vscode/extensions.json`:

```json
{
  "recommendations": [
    "esbenp.prettier-vscode",
    "dbaeumer.vscode-eslint",
    "ms-vscode.vscode-typescript-next",
    "bradlc.vscode-tailwindcss",
    "ms-vscode.vscode-json",
    "redhat.vscode-yaml"
  ]
}
```

#### VS Code Settings

Create `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "eslint.validate": ["typescript", "javascript"],
  "typescript.preferences.importModuleSpecifier": "relative",
  "files.exclude": {
    "**/node_modules": true,
    "**/dist": true,
    "**/.env": true
  }
}
```

## ⚙️ Configuration

### Environment Variables

Create `.env` file with the following configuration:

```bash
# Application Configuration
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug
BASE_URL=http://localhost:3000

# Database Configuration
DATABASE_URL=postgresql://username:password@localhost:5432/sias_development
DATABASE_SSL=false
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10

# Redis Configuration
REDIS_URL=redis://localhost:6379
REDIS_PREFIX=sias:dev
REDIS_TTL_DEFAULT=300

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_REFRESH_SECRET=your-refresh-token-secret
JWT_EXPIRY=1h
JWT_REFRESH_EXPIRY=30d

# JIRA Integration
JIRA_CLIENT_ID=your-jira-oauth-client-id
JIRA_CLIENT_SECRET=your-jira-oauth-client-secret
JIRA_REDIRECT_URI=http://localhost:3000/integrations/jira/callback
JIRA_SCOPES=read:jira-user,read:jira-work,write:jira-work,manage:jira-webhook

# Notification Services (Optional)
SENDGRID_API_KEY=your-sendgrid-api-key
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
TEAMS_WEBHOOK_URL=https://your-teams-webhook-url

# File Storage (Optional)
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_S3_BUCKET=your-s3-bucket-name
AWS_REGION=us-east-1

# Security Configuration
CORS_ORIGIN=http://localhost:3000
RATE_LIMIT_WINDOW=15
RATE_LIMIT_MAX_REQUESTS=100
SESSION_SECRET=your-session-secret
```

### Configuration Validation

The application validates all environment variables on startup:

```typescript
// Environment validation schema
const configSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'staging', 'production').required(),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string().uri().required(),
  REDIS_URL: Joi.string().uri().required(),
  JWT_SECRET: Joi.string().min(32).required(),
  // ... additional validations
});
```

## 🗄️ Database Setup

### PostgreSQL Installation

#### macOS (Homebrew)
```bash
brew install postgresql@15
brew services start postgresql@15
```

#### Ubuntu/Debian
```bash
sudo apt update
sudo apt install postgresql-15 postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

#### Windows
Download and install from [PostgreSQL Official Site](https://www.postgresql.org/download/windows/)

### Database Creation

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database and user
CREATE DATABASE sias_development;
CREATE USER sias_user WITH ENCRYPTED PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE sias_development TO sias_user;

# Grant additional permissions
GRANT USAGE ON SCHEMA public TO sias_user;
GRANT CREATE ON SCHEMA public TO sias_user;

# Exit psql
\q
```

### Schema Migration

```bash
# Run database migrations
npm run db:migrate

# Verify migration status
npm run db:migrate:status

# Rollback if needed
npm run db:rollback
```

### Sample Data (Development)

```bash
# Load sample data for development
npm run db:seed

# This creates:
# - Sample organization
# - Test users with different roles
# - Example alert rules
# - Mock JIRA projects and issues
```

## 🔌 Integration Configuration

### JIRA OAuth Setup

1. **Create JIRA App**:
   - Go to [Atlassian Developer Console](https://developer.atlassian.com/console)
   - Create new app with OAuth 2.0 (3LO)
   - Add scopes: `read:jira-user`, `read:jira-work`, `write:jira-work`, `manage:jira-webhook`

2. **Configure Callback URL**:
   ```
   http://localhost:3000/integrations/jira/callback
   ```

3. **Update Environment**:
   ```bash
   JIRA_CLIENT_ID=your-app-client-id
   JIRA_CLIENT_SECRET=your-app-client-secret
   ```

### Optional Integrations

#### GitHub Integration

```bash
# GitHub OAuth App
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
GITHUB_REDIRECT_URI=http://localhost:3000/integrations/github/callback
```

#### SendGrid Email

```bash
# SendGrid API Configuration
SENDGRID_API_KEY=SG.your-sendgrid-api-key
SENDGRID_FROM_EMAIL=alerts@yourcompany.com
SENDGRID_FROM_NAME="SIAS Alert System"
```

#### Slack Integration

```bash
# Slack Bot Configuration
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
SLACK_SIGNING_SECRET=your-slack-signing-secret
```

## 🚀 Running the Application

### Development Mode

```bash
# Start with hot reload
npm run dev

# Start with debugging
npm run dev:debug

# Start with specific log level
LOG_LEVEL=debug npm run dev
```

### Production Mode

```bash
# Build application
npm run build

# Start production server
npm start

# Start with PM2 (recommended)
pm2 start ecosystem.config.js --env production
```

### Docker Setup (Alternative)

```bash
# Build container
docker build -t sias .

# Run with docker-compose
docker-compose up -d

# Check logs
docker-compose logs -f app
```

### Health Checks

Once running, verify the application:

```bash
# Health check endpoint
curl http://localhost:3000/health

# Expected response:
{
  "status": "healthy",
  "timestamp": "2025-07-28T05:57:35Z",
  "services": {
    "database": "connected",
    "redis": "connected",
    "queue": "operational"
  }
}
```

## ✅ Verification

### 1. Service Health Check

```bash
# Check all services
curl http://localhost:3000/health

# Check specific service
curl http://localhost:3000/health/database
curl http://localhost:3000/health/redis
```

### 2. API Endpoints

```bash
# Test authentication endpoint
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}'

# Test protected endpoint
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  http://localhost:3000/api/v1/organizations
```

### 3. Integration Tests

```bash
# Run integration tests
npm run test:integration

# Test specific integration
npm run test:integration -- --grep "JIRA"
```

### 4. Database Verification

```bash
# Connect to database
psql -d sias_development -U sias_user

# Check tables
\dt

# Verify data
SELECT * FROM organizations LIMIT 5;
SELECT * FROM users LIMIT 5;
```

## 🚨 Troubleshooting

### Common Issues

#### 1. Database Connection Failed

**Problem**: `Error: connect ECONNREFUSED 127.0.0.1:5432`

**Solutions**:
```bash
# Check PostgreSQL status
brew services list | grep postgresql
sudo systemctl status postgresql

# Restart PostgreSQL
brew services restart postgresql
sudo systemctl restart postgresql

# Verify connection string
echo $DATABASE_URL
```

#### 2. Redis Connection Failed

**Problem**: `Error: Redis connection failed`

**Solutions**:
```bash
# Check Redis status
redis-cli ping

# Start Redis
brew services start redis
sudo systemctl start redis

# Check Redis URL
echo $REDIS_URL
```

#### 3. Port Already in Use

**Problem**: `Error: listen EADDRINUSE :::3000`

**Solutions**:
```bash
# Find process using port
lsof -i :3000

# Kill process
kill -9 PID

# Use different port
PORT=3001 npm run dev
```

#### 4. Environment Variables Not Loaded

**Problem**: `Error: Missing required environment variable`

**Solutions**:
```bash
# Check .env file exists
ls -la .env

# Verify .env format (no spaces around =)
cat .env | grep -v '^#' | grep '='

# Load environment manually
source .env
```

#### 5. TypeScript Compilation Errors

**Problem**: `Error: Cannot find module '@/config/environment'`

**Solutions**:
```bash
# Check tsconfig.json paths
cat tsconfig.json | grep -A 10 '"paths"'

# Clear build cache
rm -rf dist/
rm -rf node_modules/.cache/

# Reinstall dependencies
npm ci
```

### Getting Help

1. **Check Logs**: Review application logs for detailed error messages
2. **Debug Mode**: Run with `LOG_LEVEL=debug` for verbose logging
3. **Health Endpoint**: Use `/health` endpoint to identify failing services
4. **Database Logs**: Check PostgreSQL logs for database issues
5. **Documentation**: Review specific module documentation
6. **GitHub Issues**: Search existing issues or create new one

### Performance Optimization

#### Development Environment

```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=4096"

# Enable TypeScript incremental compilation
# Add to tsconfig.json:
{
  "compilerOptions": {
    "incremental": true,
    "tsBuildInfoFile": ".tsbuildinfo"
  }
}
```

#### Database Optimization

```sql
-- Create indexes for better performance
CREATE INDEX CONCURRENTLY idx_alerts_organization_status 
ON alerts(organization_id, status) WHERE status = 'active';

CREATE INDEX CONCURRENTLY idx_tickets_project_updated 
ON tickets(project_id, updated_at);

-- Analyze tables for query planning
ANALYZE;
```

---

**Next Steps**:
- [Configuration Guide](./CONFIGURATION.md) - Detailed configuration options
- [API Documentation](../API.md) - Complete API reference
- [JIRA Integration Setup](../modules/jira-integration.md) - JIRA-specific configuration
- [Contributing Guide](./CONTRIBUTING.md) - Development workflow