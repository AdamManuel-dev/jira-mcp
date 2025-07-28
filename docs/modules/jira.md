# JIRA Integration Module

## Overview

The JIRA integration module provides comprehensive connectivity with Atlassian JIRA instances through REST API v3, enabling bidirectional synchronization of project data, issue tracking, and sprint management for the Sprint Intelligence Alert System (SIAS).

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   JIRA Client   │────▶│  JIRA Service   │────▶│  JIRA Webhook   │
│   (API Layer)   │     │ (Business Logic)│     │   (Events)      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  OAuth Service  │     │   Data Sync     │     │  Event Queue    │
│ (Authentication)│     │   (Projects,    │     │  (Processing)   │
│                 │     │ Issues, Sprints)│     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Components

### 1. JiraApiClient (`client.ts`)

**Purpose**: Low-level REST API client with authentication, rate limiting, and error handling.

**Key Features**:
- OAuth 2.0 authentication with automatic token refresh
- Circuit breaker pattern for resilience 
- Request/response caching with Redis
- Comprehensive rate limit handling
- Exponential backoff retry logic

**Main APIs**:
- **Projects**: `getProjects()`, `getProject()`
- **Issues**: `searchIssues()`, `getIssue()`, `createIssue()`, `updateIssue()`
- **Comments & Worklogs**: `getIssueComments()`, `addComment()`, `addWorklog()`
- **Sprints**: `getBoardSprints()`, `getSprint()`, `getSprintIssues()`
- **Users**: `getCurrentUser()`, `searchUsers()`
- **Metadata**: `getIssueTypes()`, `getStatuses()`, `getPriorities()`, `getCustomFields()`

### 2. JiraOAuthService (`oauth.ts`)

**Purpose**: Manages OAuth 2.0 authentication flow and token lifecycle.

**Features**:
- OAuth 2.0 with PKCE support
- Secure token storage and encryption
- Automatic token refresh
- Multi-instance support (Cloud and Server/Data Center)

**Main APIs**:
- Authorization URL generation
- Token exchange and refresh
- Instance discovery and validation

### 3. JiraIntegrationService (`service.ts`)

**Purpose**: High-level business logic orchestrating API client and data synchronization.

**Features**:
- Comprehensive data synchronization
- Project and sprint management
- Issue lifecycle tracking
- Statistics and monitoring

### 4. JiraWebhookService (`webhook.ts`)

**Purpose**: Processes real-time JIRA webhooks with reliability guarantees.

**Features**:
- Webhook signature validation
- Queue-based event processing
- Retry mechanism with exponential backoff
- Dead letter queue for failed events
- Event deduplication

## Configuration

### Environment Variables

```bash
# JIRA OAuth Configuration
JIRA_CLIENT_ID=your_oauth_client_id
JIRA_CLIENT_SECRET=your_oauth_client_secret

# Instance Configuration
JIRA_BASE_URL=https://your-instance.atlassian.net  # Optional for Cloud
JIRA_WEBHOOK_SECRET=your_webhook_secret

# Performance Tuning
JIRA_RATE_LIMIT_REQUESTS_PER_MINUTE=300
JIRA_CIRCUIT_BREAKER_THRESHOLD=5
JIRA_CIRCUIT_BREAKER_TIMEOUT_MS=60000
```

### Integration Setup

1. **Create OAuth Application** in JIRA
2. **Configure Webhook Endpoints** for real-time updates
3. **Set Permissions** for required scopes
4. **Initialize Client** with organization credentials

## Usage Examples

### Basic Client Usage

```typescript
import { JiraApiClient } from '@/integrations/jira/client';

const client = new JiraApiClient({
  organizationId: 'org123',
  userId: 'user456',
  instanceId: 'instance789'
});

// List all projects
const projects = await client.getProjects(['description', 'lead']);
console.log(`Found ${projects.length} projects`);

// Search issues with JQL
const issues = await client.searchIssues({
  jql: 'project = MYPROJ AND status = "In Progress"',
  maxResults: 50,
  fields: ['key', 'summary', 'status', 'assignee']
});
```

### Service-Level Operations

```typescript
import { JiraIntegrationService } from '@/integrations/jira/service';

const service = new JiraIntegrationService();
await service.initialize();

// Sync complete integration data
const syncResult = await service.syncIntegration('integration123');
console.log(`Sync completed: ${syncResult.stats.issuesCreated} issues created`);
```

### Webhook Processing

```typescript
import { JiraWebhookService } from '@/integrations/jira/webhook';

const webhookService = new JiraWebhookService();

// Process incoming webhook
app.post('/webhooks/jira', async (req, res) => {
  const isValid = await webhookService.validateSignature(req.body, req.headers);
  if (isValid) {
    await webhookService.processEvent(req.body);
    res.status(200).send('OK');
  } else {
    res.status(401).send('Invalid signature');
  }
});
```

## Data Models

### Core Types

- **JiraProject**: Project metadata and configuration
- **JiraIssue**: Complete issue data with fields and relationships
- **JiraSprint**: Sprint information with dates and scope
- **JiraUser**: User profiles and permissions
- **JiraComment/JiraWorklog**: Issue activity records

### Search and Pagination

All list operations support pagination:
```typescript
interface JiraSearchRequest {
  jql: string;
  startAt?: number;
  maxResults?: number;
  fields?: string[];
  expand?: string[];
}
```

## Error Handling

### Error Types

- **AuthenticationError**: OAuth token issues, expired credentials
- **RateLimitError**: API rate limits exceeded
- **ExternalServiceError**: JIRA API failures, network issues

### Circuit Breaker

The client implements circuit breaker pattern:
- **Closed**: Normal operation
- **Open**: Service unavailable, requests fail fast
- **Half-Open**: Testing recovery with limited requests

### Retry Logic

- **Exponential backoff** for transient failures
- **Maximum retry count** configurable per request type
- **Jitter** added to prevent thundering herd

## Performance Considerations

### Caching Strategy

- **Projects**: 10 minutes (rarely change)
- **Issues**: 1 minute (frequently updated)
- **Metadata**: 1 hour (issue types, statuses, priorities)
- **User profiles**: 5 minutes

### Rate Limiting

- **Default limit**: 300 requests/minute
- **Burst handling**: Token bucket algorithm
- **Proactive throttling**: Warn at 90% capacity

### Optimization Tips

1. **Use field filtering** to reduce payload size
2. **Batch operations** when possible
3. **Leverage caching** for repeated requests
4. **Monitor rate limits** and adjust request patterns

## Security

### Authentication

- **OAuth 2.0** with PKCE for enhanced security
- **Token encryption** at rest
- **Automatic rotation** of access tokens

### Webhook Security

- **HMAC signature verification** using shared secret
- **Request origin validation**
- **Replay attack prevention** with timestamps

## Monitoring and Debugging

### Logging

All operations include structured logging:
```typescript
logger.info('JIRA API request', {
  method: 'GET',
  endpoint: '/project',
  organizationId: 'org123',
  duration: 245,
  cacheHit: false
});
```

### Health Checks

```typescript
// Test connectivity
const isHealthy = await client.testConnection();

// Check rate limits
const rateLimit = client.getRateLimitInfo();
if (rateLimit.remaining < 10) {
  console.warn('Rate limit approaching');
}

// Circuit breaker status
const cbState = client.getCircuitBreakerState();
if (cbState.state === 'open') {
  console.error('Circuit breaker is open');
}
```

## Troubleshooting

### Common Issues

1. **Authentication Failures**
   - Verify OAuth credentials and scopes
   - Check token expiration and refresh logic
   - Validate JIRA instance URL

2. **Rate Limit Errors**
   - Implement backoff and retry logic
   - Reduce request frequency
   - Use caching to minimize API calls

3. **Webhook Delivery Issues**
   - Verify webhook URL accessibility
   - Check signature validation
   - Monitor event queue for failures

### Debug Tools

```typescript
// Enable debug logging
process.env.LOG_LEVEL = 'debug';

// Reset circuit breaker
client.resetCircuitBreaker();

// Clear cache
await cache.clear('jira:*');
```

## Migration and Upgrades

### Version Compatibility

- **JIRA Cloud**: REST API v3
- **JIRA Server/Data Center**: 8.0+
- **OAuth**: 2.0 with PKCE support

### Breaking Changes

When upgrading JIRA integration:
1. Review API version compatibility
2. Update OAuth application settings
3. Test webhook endpoints
4. Verify custom field mappings

## Related Documentation

- [API Reference](../API.md#jira-integration)
- [Authentication Guide](../guides/AUTHENTICATION.md)
- [Webhook Configuration](../guides/WEBHOOKS.md)
- [Troubleshooting](../TROUBLESHOOTING.md#jira-integration)