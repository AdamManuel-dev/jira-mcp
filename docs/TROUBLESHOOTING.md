# 🛠️ Troubleshooting Guide

Comprehensive troubleshooting guide for the **JIRA Sprint Intelligence Alert System (SIAS)**. This guide covers common issues, debugging techniques, and solutions for various system components.

## 📋 Table of Contents

- [Quick Diagnostics](#quick-diagnostics)
- [Application Issues](#application-issues)
- [Database Problems](#database-problems)
- [Integration Issues](#integration-issues)
- [Performance Problems](#performance-problems)
- [Deployment Issues](#deployment-issues)
- [FAQ](#faq)

## 🔍 Quick Diagnostics

### Health Check Dashboard

Start troubleshooting with the built-in health check:

```bash
# Basic health check
curl http://localhost:3000/health

# Detailed service status
curl http://localhost:3000/health?detailed=true

# Component-specific checks
curl http://localhost:3000/health/database
curl http://localhost:3000/health/redis  
curl http://localhost:3000/health/integrations
```

### System Status Overview

```bash
# Check all services at once
npm run health-check

# Expected output:
✅ Database: Connected (PostgreSQL 15.4)
✅ Redis: Connected (Redis 7.0.12)
✅ Queue: Operational (0 pending jobs)
⚠️  JIRA Integration: 2/3 instances healthy
✅ Email Service: Connected (SendGrid)
```

### Log Analysis

```bash
# View recent logs
npm run logs

# Filter by log level
npm run logs -- --level error

# Follow logs in real-time
npm run logs -- --follow

# Search logs for specific issues
npm run logs -- --grep "authentication"
```

## 🚨 Application Issues

### Startup Problems

#### Issue: Application Won't Start

**Symptoms**:
- Server exits immediately
- "Cannot find module" errors
- Port binding failures

**Diagnostic Commands**:
```bash
# Check Node.js version
node --version

# Verify dependencies
npm ls --depth=0

# Check environment variables
npm run env:check

# Test TypeScript compilation
npm run type-check
```

**Common Solutions**:

1. **Missing Dependencies**:
   ```bash
   # Clean install
   rm -rf node_modules package-lock.json
   npm install
   ```

2. **Port Conflicts**:
   ```bash
   # Find process using port
   lsof -i :3000
   
   # Use different port
   PORT=3001 npm run dev
   ```

3. **Environment Issues**:
   ```bash
   # Copy environment template
   cp .env.example .env
   
   # Validate environment
   npm run env:validate
   ```

#### Issue: TypeScript Compilation Errors

**Symptoms**:
- Build failures
- Module resolution errors
- Type checking failures

**Solutions**:

1. **Path Mapping Issues**:
   ```bash
   # Check tsconfig.json paths configuration
   cat tsconfig.json | jq '.compilerOptions.paths'
   
   # Verify baseUrl setting
   cat tsconfig.json | jq '.compilerOptions.baseUrl'
   ```

2. **Missing Type Definitions**:
   ```bash
   # Install missing types
   npm install --save-dev @types/node @types/express
   
   # Check for type conflicts
   npm ls @types/
   ```

3. **Cache Issues**:
   ```bash
   # Clear TypeScript cache
   rm -rf dist/ .tsbuildinfo
   
   # Clear npm cache
   npm cache clean --force
   ```

### Runtime Errors

#### Issue: Uncaught Exceptions

**Symptoms**:
- Server crashes unexpectedly
- Process exits with error code
- Incomplete request processing

**Debug Steps**:

1. **Enable Debug Mode**:
   ```bash
   # Start with debug logging
   LOG_LEVEL=debug npm run dev
   
   # Enable Node.js debugging
   node --inspect src/index.ts
   ```

2. **Check Error Logs**:
   ```bash
   # View error logs
   tail -f logs/error.log
   
   # Search for specific errors
   grep -i "uncaught" logs/error.log
   ```

3. **Memory Issues**:
   ```bash
   # Monitor memory usage
   node --max-old-space-size=4096 src/index.ts
   
   # Check for memory leaks
   npm run dev -- --inspect --expose-gc
   ```

## 💾 Database Problems

### Connection Issues

#### Issue: Database Connection Failed

**Error Messages**:
- `connect ECONNREFUSED 127.0.0.1:5432`
- `password authentication failed`
- `database "sias" does not exist`

**Diagnostic Steps**:

1. **Check PostgreSQL Status**:
   ```bash
   # macOS
   brew services list | grep postgresql
   
   # Linux
   sudo systemctl status postgresql
   
   # Test connection manually
   psql -h localhost -U sias_user -d sias_development
   ```

2. **Verify Connection String**:
   ```bash
   # Check DATABASE_URL
   echo $DATABASE_URL
   
   # Test connection with URL
   psql "$DATABASE_URL"
   ```

3. **Network Connectivity**:
   ```bash
   # Test port connectivity
   telnet localhost 5432
   
   # Check firewall rules
   sudo ufw status
   ```

**Solutions**:

1. **Start PostgreSQL**:
   ```bash
   # macOS
   brew services start postgresql@15
   
   # Linux
   sudo systemctl start postgresql
   sudo systemctl enable postgresql
   ```

2. **Create Database and User**:
   ```sql
   -- Connect as superuser
   sudo -u postgres psql
   
   -- Create database
   CREATE DATABASE sias_development;
   
   -- Create user
   CREATE USER sias_user WITH ENCRYPTED PASSWORD 'your_password';
   
   -- Grant permissions
   GRANT ALL PRIVILEGES ON DATABASE sias_development TO sias_user;
   ```

3. **Fix Authentication**:
   ```bash
   # Edit pg_hba.conf
   sudo nano /etc/postgresql/15/main/pg_hba.conf
   
   # Add line:
   local   sias_development   sias_user   md5
   
   # Restart PostgreSQL
   sudo systemctl restart postgresql
   ```

### Migration Issues

#### Issue: Migration Failures

**Error Messages**:
- `Migration table not found`
- `Column already exists`
- `Constraint violation`

**Solutions**:

1. **Check Migration Status**:
   ```bash
   # View migration status
   npm run db:migrate:status
   
   # View migration history
   npm run db:migrate:list
   ```

2. **Reset Migrations**:
   ```bash
   # Rollback all migrations
   npm run db:migrate:down
   
   # Re-run migrations
   npm run db:migrate:up
   ```

3. **Manual Migration Repair**:
   ```sql
   -- Connect to database
   psql -d sias_development
   
   -- Check migration table
   SELECT * FROM knex_migrations ORDER BY batch DESC;
   
   -- Remove failed migration
   DELETE FROM knex_migrations WHERE name = 'failed_migration_name';
   ```

### Performance Issues

#### Issue: Slow Database Queries

**Symptoms**:
- High response times
- Database timeouts
- High CPU usage

**Diagnostic Tools**:

1. **Enable Query Logging**:
   ```sql
   -- Enable slow query logging
   ALTER SYSTEM SET log_min_duration_statement = 1000;
   SELECT pg_reload_conf();
   
   -- View slow queries
   SELECT query, mean_exec_time, calls 
   FROM pg_stat_statements 
   ORDER BY mean_exec_time DESC 
   LIMIT 10;
   ```

2. **Analyze Query Plans**:
   ```sql
   -- Explain query performance
   EXPLAIN ANALYZE SELECT * FROM alerts 
   WHERE organization_id = 'org_123' AND status = 'active';
   
   -- Check index usage
   SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read
   FROM pg_stat_user_indexes;
   ```

**Solutions**:

1. **Add Missing Indexes**:
   ```sql
   -- Alert queries
   CREATE INDEX CONCURRENTLY idx_alerts_org_status 
   ON alerts(organization_id, status);
   
   -- Issue queries
   CREATE INDEX CONCURRENTLY idx_tickets_project_updated 
   ON tickets(project_id, updated_at);
   
   -- User queries
   CREATE INDEX CONCURRENTLY idx_users_org_active 
   ON users(organization_id) WHERE is_active = true;
   ```

2. **Optimize Queries**:
   ```typescript
   // Use selective fields
   const alerts = await query(`
     SELECT id, title, severity, status, detected_at
     FROM alerts 
     WHERE organization_id = $1 AND status = 'active'
     ORDER BY detected_at DESC
     LIMIT 50
   `, [organizationId]);
   ```

3. **Connection Pool Tuning**:
   ```bash
   # Environment variables
   DATABASE_POOL_MIN=5
   DATABASE_POOL_MAX=20
   DATABASE_TIMEOUT=30000
   DATABASE_IDLE_TIMEOUT=10000
   ```

## 🔌 Integration Issues

### JIRA Integration Problems

#### Issue: OAuth Authentication Failures

**Error Messages**:
- `Invalid authorization code`
- `Token has expired`
- `Insufficient permissions`

**Debug Steps**:

1. **Check OAuth Configuration**:
   ```bash
   # Verify environment variables
   echo $JIRA_CLIENT_ID
   echo $JIRA_CLIENT_SECRET
   echo $JIRA_REDIRECT_URI
   ```

2. **Test OAuth Flow**:
   ```bash
   # Test authorization URL generation
   curl -X POST http://localhost:3000/api/v1/integrations/jira/setup \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"name":"Test Integration"}'
   ```

3. **Check Token Storage**:
   ```bash
   # Check Redis for stored tokens
   redis-cli KEYS "jira_tokens:*"
   
   # View token data (be careful with sensitive data)
   redis-cli GET "jira_tokens:org_123:user_456"
   ```

**Solutions**:

1. **Verify JIRA App Configuration**:
   - Check [Atlassian Developer Console](https://developer.atlassian.com/console)
   - Verify callback URL matches exactly
   - Confirm required scopes are granted
   - Check app is distributed to your organization

2. **Token Refresh Issues**:
   ```typescript
   // Force token refresh
   const tokens = await oauthService.refreshTokens(organizationId, userId);
   
   // Clear invalid tokens
   await cache.del(`jira_tokens:${organizationId}:${userId}`);
   ```

3. **Permission Issues**:
   ```bash
   # Check user permissions in JIRA
   curl -H "Authorization: Bearer $ACCESS_TOKEN" \
     "https://api.atlassian.com/oauth/token/accessible-resources"
   ```

#### Issue: API Rate Limiting

**Error Messages**:
- `HTTP 429: Too Many Requests`
- `Rate limit exceeded`
- `Retry after X seconds`

**Solutions**:

1. **Check Rate Limit Status**:
   ```typescript
   // Get current rate limit info
   const rateLimitInfo = client.getRateLimitInfo();
   console.log('Remaining requests:', rateLimitInfo.remaining);
   console.log('Reset time:', new Date(rateLimitInfo.resetTime * 1000));
   ```

2. **Implement Backoff Strategy**:
   ```typescript
   // Configure retry delays
   const retryConfig = {
     maxRetries: 3,
     baseDelay: 1000,
     maxDelay: 30000,
     backoffFactor: 2
   };
   
   // Respect rate limit headers
   if (response.headers['retry-after']) {
     const retryAfter = parseInt(response.headers['retry-after']) * 1000;
     await delay(retryAfter);
   }
   ```

3. **Optimize API Usage**:
   ```typescript
   // Batch requests
   const issues = await client.searchIssues({
     jql: 'project = PROJ',
     maxResults: 100,  // Request more items per call
     fields: ['key', 'summary', 'status'] // Request only needed fields
   });
   
   // Use pagination efficiently
   let startAt = 0;
   const batchSize = 100;
   while (hasMoreResults) {
     const batch = await client.searchIssues({
       jql,
       startAt,
       maxResults: batchSize
     });
     startAt += batchSize;
     hasMoreResults = batch.total > startAt;
   }
   ```

### Webhook Processing Issues

#### Issue: Webhook Events Not Processing

**Symptoms**:
- Events queued but not processed
- Missing alerts for JIRA changes
- Webhook endpoint timeouts

**Debug Steps**:

1. **Check Webhook Registration**:
   ```bash
   # List registered webhooks in JIRA
   curl -H "Authorization: Bearer $ACCESS_TOKEN" \
     "https://your-instance.atlassian.net/rest/api/3/webhook"
   ```

2. **Verify Event Reception**:
   ```bash
   # Check webhook event logs
   grep "webhook" logs/application.log | tail -20
   
   # Monitor webhook endpoint
   curl -X POST http://localhost:3000/webhooks/jira/test \
     -H "Content-Type: application/json" \
     -d '{"test": true}'
   ```

3. **Queue Status**:
   ```bash
   # Check queue depth
   redis-cli LLEN jira:webhook:events
   
   # View queued jobs
   redis-cli LRANGE jira:webhook:events 0 10
   ```

**Solutions**:

1. **Restart Webhook Processing**:
   ```bash
   # Clear stuck jobs
   redis-cli DEL jira:webhook:events
   
   # Restart queue processors
   npm run queue:restart
   ```

2. **Verify Signature Validation**:
   ```typescript
   // Debug webhook signature
   const isValid = webhookService.validateSignature(
     payload,
     signature,
     webhookSecret
   );
   console.log('Signature valid:', isValid);
   ```

3. **Check Network Connectivity**:
   ```bash
   # Test webhook URL accessibility
   curl -I https://your-app.com/webhooks/jira/test
   
   # Check firewall rules
   netstat -tlnp | grep :3000
   ```

## ⚡ Performance Problems

### High Memory Usage

**Symptoms**:
- Application crashes with out-of-memory errors
- Gradual memory increase over time
- Slow garbage collection

**Diagnostic Tools**:

1. **Memory Profiling**:
   ```bash
   # Start with memory monitoring
   node --max-old-space-size=4096 --inspect src/index.ts
   
   # Generate heap dump
   kill -USR2 $PID
   
   # Analyze heap dump
   npm install -g clinic
   clinic doctor -- node src/index.ts
   ```

2. **Monitor Memory Usage**:
   ```typescript
   // Add memory monitoring
   setInterval(() => {
     const usage = process.memoryUsage();
     logger.info('Memory usage:', {
       rss: `${Math.round(usage.rss / 1024 / 1024)} MB`,
       heapTotal: `${Math.round(usage.heapTotal / 1024 / 1024)} MB`,
       heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)} MB`,
       external: `${Math.round(usage.external / 1024 / 1024)} MB`
     });
   }, 30000);
   ```

**Solutions**:

1. **Optimize Database Queries**:
   ```typescript
   // Stream large result sets
   const stream = query.stream('SELECT * FROM tickets WHERE project_id = $1', [projectId]);
   stream.on('data', (row) => {
     processTicket(row);
   });
   
   // Use pagination for large datasets
   const limit = 1000;
   let offset = 0;
   while (true) {
     const batch = await query('SELECT * FROM tickets LIMIT $1 OFFSET $2', [limit, offset]);
     if (batch.length === 0) break;
     await processBatch(batch);
     offset += limit;
   }
   ```

2. **Implement Object Pooling**:
   ```typescript
   // Pool expensive objects
   const clientPool = new Map<string, JiraApiClient>();
   
   const getClient = (instanceId: string) => {
     if (!clientPool.has(instanceId)) {
       clientPool.set(instanceId, new JiraApiClient({ instanceId }));
     }
     return clientPool.get(instanceId);
   };
   ```

3. **Clear Unnecessary References**:
   ```typescript
   // Clear event listeners
   process.removeAllListeners('uncaughtException');
   
   // Clear timeouts and intervals
   clearTimeout(timeoutId);
   clearInterval(intervalId);
   
   // Null large objects
   largeDataStructure = null;
   ```

### High CPU Usage

**Symptoms**:
- Server becomes unresponsive
- High load averages
- Slow API responses

**Solutions**:

1. **Optimize CPU-Intensive Operations**:
   ```typescript
   // Use worker threads for heavy processing
   import { Worker, isMainThread, parentPort } from 'worker_threads';
   
   if (isMainThread) {
     const worker = new Worker(__filename);
     worker.postMessage(data);
   } else {
     parentPort?.on('message', (data) => {
       const result = heavyProcessing(data);
       parentPort?.postMessage(result);
     });
   }
   ```

2. **Implement Caching**:
   ```typescript
   // Cache expensive computations
   const cache = new Map<string, any>();
   
   const expensiveFunction = async (input: string) => {
     if (cache.has(input)) {
       return cache.get(input);
     }
     
     const result = await performExpensiveOperation(input);
     cache.set(input, result);
     return result;
   };
   ```

3. **Batch Operations**:
   ```typescript
   // Batch database operations
   const batchInsert = async (records: any[]) => {
     const batchSize = 100;
     for (let i = 0; i < records.length; i += batchSize) {
       const batch = records.slice(i, i + batchSize);
       await db.batchInsert('table_name', batch);
     }
   };
   ```

## 🚀 Deployment Issues

### Docker Problems

#### Issue: Container Build Failures

**Common Errors**:
- `COPY failed: no such file or directory`
- `npm ERR! Cannot read property`
- `Permission denied`

**Solutions**:

1. **Check Dockerfile**:
   ```dockerfile
   # Ensure proper file copying
   COPY package*.json ./
   RUN npm ci --only=production
   
   # Set proper permissions
   RUN chown -R node:node /app
   USER node
   ```

2. **Optimize Build Context**:
   ```bash
   # Create .dockerignore
   node_modules
   npm-debug.log
   .git
   .env
   README.md
   docs/
   tests/
   ```

3. **Multi-stage Builds**:
   ```dockerfile
   # Build stage
   FROM node:18-alpine AS builder
   WORKDIR /app
   COPY package*.json ./
   RUN npm ci
   COPY . .
   RUN npm run build
   
   # Production stage
   FROM node:18-alpine AS production
   WORKDIR /app
   COPY package*.json ./
   RUN npm ci --only=production
   COPY --from=builder /app/dist ./dist
   CMD ["node", "dist/index.js"]
   ```

#### Issue: Container Runtime Problems

**Symptoms**:
- Container exits immediately
- Health checks failing
- Network connectivity issues

**Debug Steps**:

1. **Check Container Logs**:
   ```bash
   # View container logs
   docker logs container_name
   
   # Follow logs in real-time
   docker logs -f container_name
   
   # Check exit code
   docker ps -a
   ```

2. **Debug Inside Container**:
   ```bash
   # Enter running container
   docker exec -it container_name sh
   
   # Run container interactively
   docker run -it --rm image_name sh
   ```

3. **Network Debugging**:
   ```bash
   # Check container networking
   docker network ls
   docker network inspect bridge
   
   # Test connectivity
   docker exec container_name ping database_host
   ```

### Environment-Specific Issues

#### Issue: Environment Variable Problems

**Symptoms**:
- Configuration not loaded
- Service connections failing
- Feature flags not working

**Solutions**:

1. **Verify Environment Loading**:
   ```bash
   # Check environment in container
   docker exec container_name env | grep JIRA
   
   # Validate configuration
   docker exec container_name node -e "console.log(process.env.DATABASE_URL)"
   ```

2. **Secret Management**:
   ```bash
   # Use Docker secrets
   echo "your_secret" | docker secret create db_password -
   
   # Mount secrets in compose
   services:
     app:
       secrets:
         - db_password
   ```

3. **Configuration Validation**:
   ```typescript
   // Add startup validation
   const validateConfig = () => {
     const required = ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET'];
     const missing = required.filter(key => !process.env[key]);
     
     if (missing.length > 0) {
       throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
     }
   };
   
   validateConfig();
   ```

## ❓ FAQ

### General Questions

**Q: How do I check if SIAS is running correctly?**

A: Use the health check endpoint and verify all services are operational:
```bash
curl http://localhost:3000/health
```

**Q: What are the minimum system requirements?**

A: Node.js 18+, PostgreSQL 14+, Redis 6+, 2GB RAM, 10GB storage for basic usage.

**Q: How do I backup the database?**

A: Use pg_dump for PostgreSQL backups:
```bash
pg_dump -h localhost -U sias_user sias_development > backup.sql
```

### Integration Questions

**Q: Can I use JIRA Server instead of JIRA Cloud?**

A: Yes, but OAuth configuration differs. Update the base URL and authentication flow for Server instances.

**Q: How many JIRA instances can I connect?**

A: There's no hard limit, but consider API rate limits and resource usage for each instance.

**Q: Why are my webhook events not processing?**

A: Check webhook registration, network connectivity, and signature validation. Verify JIRA can reach your webhook endpoint.

### Performance Questions

**Q: How do I optimize database performance?**

A: Add appropriate indexes, optimize queries, and use connection pooling. Monitor slow query logs.

**Q: What causes high memory usage?**

A: Large result sets, memory leaks, or inefficient caching. Use streaming for large datasets and monitor memory usage.

**Q: How can I reduce API response times?**

A: Implement caching, optimize database queries, and use CDN for static assets.

### Security Questions

**Q: How are JIRA credentials stored?**

A: OAuth tokens are encrypted and stored in Redis with TTL. Never store passwords directly.

**Q: Is webhook data encrypted?**

A: Webhook payloads are validated using HMAC-SHA256 signatures and transmitted over HTTPS.

**Q: How do I rotate API keys?**

A: Update environment variables and restart the application. Consider using a secrets management service.

---

**Still having issues?**
1. Check the [GitHub Issues](https://github.com/your-org/jira-sprint-intelligence/issues)
2. Review [Configuration Guide](./guides/CONFIGURATION.md)
3. Join our [Discord Community](https://discord.gg/your-community)
4. Contact support at support@yourcompany.com