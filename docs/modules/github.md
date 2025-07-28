# GitHub Integration Module

## Overview

The GitHub integration module provides comprehensive connectivity with GitHub repositories through REST API v4 and GraphQL v4, enabling repository synchronization, pull request tracking, and commit analysis for the Sprint Intelligence Alert System (SIAS).

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  GitHub Client  │────▶│ GitHub Service  │────▶│ GitHub Webhook  │
│   (API Layer)   │     │ (Business Logic)│     │   (Events)      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   GitHub App    │     │  Repository     │     │  Event Queue    │
│ (Authentication)│     │     Sync        │     │  (Processing)   │
│                 │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Components

### 1. GitHubApiClient (`client.ts`)

**Purpose**: Low-level REST and GraphQL API client with GitHub App authentication.

**Key Features**:
- GitHub App installation-based authentication
- Dual API support (REST v4 + GraphQL v4)
- Automatic token refresh and caching
- Rate limit handling and monitoring
- GitHub Enterprise Server support

**Main APIs**:
- **Repositories**: `listRepositories()`, `getRepository()`
- **Pull Requests**: `listPullRequests()`, `getPullRequest()`
- **Commits**: `listCommits()`, `getCommit()`
- **Webhooks**: `createWebhook()`, webhook management
- **Users**: User profile and permission queries

**Authentication Flow**:
1. Generate JWT using GitHub App private key
2. Exchange JWT for installation access token
3. Cache token with automatic refresh (1 hour TTL)
4. Use token for REST and GraphQL requests

### 2. GitHubIntegrationService (`service.ts`)

**Purpose**: High-level business logic orchestrating repository synchronization and management.

**Features**:
- Multi-repository management per organization
- Comprehensive data synchronization
- Configuration management and validation
- Sync scheduling and statistics tracking

**Main APIs**:
- Repository sync orchestration
- Integration configuration management
- Webhook setup and management
- Sync result reporting and analytics

### 3. GitHubWebhookService (`webhook.ts`)

**Purpose**: Processes real-time GitHub webhooks with signature validation and event handling.

**Features**:
- HMAC-SHA256 signature verification
- Event-driven repository synchronization
- Queue-based reliable processing
- Database transaction safety

**Supported Events**:
- Push events (commits)
- Pull request lifecycle
- Repository changes
- Branch operations

## Configuration

### Environment Variables

```bash
# GitHub App Configuration
GITHUB_APP_ID=12345
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----..."
GITHUB_WEBHOOK_SECRET=your_webhook_secret

# Enterprise Server (optional)
GITHUB_BASE_URL=https://github.your-company.com/api/v3

# Performance Tuning
GITHUB_RATE_LIMIT_THRESHOLD=90  # Percentage before warning
GITHUB_TOKEN_REFRESH_BUFFER=300 # Seconds before expiry to refresh
```

### GitHub App Setup

1. **Create GitHub App** in your organization
2. **Generate private key** for authentication
3. **Install app** on required repositories
4. **Configure webhook endpoints** for real-time updates
5. **Set permissions**:
   - Repository: Read & Write
   - Pull Requests: Read & Write
   - Commits: Read
   - Metadata: Read

## Usage Examples

### Basic Client Usage

```typescript
import { GitHubApiClient } from '@/integrations/github/client';

const client = new GitHubApiClient({
  organizationId: 'org123',
  installationId: '456789'
});

await client.initialize();

// List accessible repositories
const repos = await client.listRepositories();
console.log(`Found ${repos.length} repositories`);

// Get specific repository details
const repo = await client.getRepository('owner', 'repo-name');
console.log(`Repository: ${repo.name} (${repo.language})`);

// List pull requests
const pullRequests = await client.listPullRequests('owner', 'repo-name', {
  state: 'open',
  per_page: 50
});
```

### Service-Level Operations

```typescript
import { GitHubIntegrationService } from '@/integrations/github/service';

const service = new GitHubIntegrationService();
await service.initialize();

// Sync all repositories for an integration
const syncResult = await service.syncIntegration('integration123');
console.log(`Sync completed: ${syncResult.stats.repositoriesUpdated} repos updated`);

// Set up scheduled sync
await service.scheduleSync('integration123', {
  interval: '*/15 * * * *', // Every 15 minutes
  enabled: true
});
```

### Webhook Processing

```typescript
import { GitHubWebhookService } from '@/integrations/github/webhook';

const webhookService = new GitHubWebhookService();

app.post('/webhooks/github', async (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  const event = req.headers['x-github-event'];
  
  const isValid = webhookService.verifySignature(req.body, signature);
  if (isValid) {
    await webhookService.processWebhook(event, req.body);
    res.status(200).send('OK');
  } else {
    res.status(401).send('Invalid signature');
  }
});
```

### GraphQL Queries

```typescript
// Complex pull request query with GraphQL
const pullRequestData = await client.getPullRequest('owner', 'repo', 123);
console.log(`PR: ${pullRequestData.title}`);
console.log(`Files changed: ${pullRequestData.changedFiles}`);
console.log(`Reviews: ${pullRequestData.reviews.length}`);
```

## Data Models

### Core Types

- **GitHubRepository**: Repository metadata, settings, and statistics
- **GitHubPullRequest**: PR details with reviews, commits, and file changes
- **GitHubCommit**: Commit information with author, changes, and metadata
- **GitHubUser**: User profiles and organization membership
- **GitHubBranch**: Branch information and protection rules

### API Response Mapping

The client automatically maps GitHub API responses to standardized types:

```typescript
interface GitHubRepository {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  private: boolean;
  language: string | null;
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
  // ... additional fields
}
```

## Authentication

### GitHub App Authentication

The module uses GitHub App authentication for enhanced security and higher rate limits:

1. **App-level permissions** instead of user-level
2. **Installation-based access** to specific repositories
3. **Higher rate limits** (5000 requests/hour vs 60 for personal tokens)
4. **Audit trail** and better security controls

### Token Lifecycle

```typescript
// Token automatically refreshed before expiration
const tokenInfo = await client.getTokenInfo();
console.log(`Token expires: ${new Date(tokenInfo.expiresAt)}`);
console.log(`Time to refresh: ${tokenInfo.expiresAt - Date.now()}ms`);
```

## Rate Limiting

### GitHub Rate Limits

- **REST API**: 5000 requests/hour per installation
- **GraphQL API**: 5000 points/hour (complex queries cost more)
- **Search API**: 30 requests/minute
- **Secondary rate limits**: Apply to concurrent requests

### Rate Limit Handling

```typescript
// Check current rate limit status
const rateLimit = await client.getRateLimit();
console.log(`Remaining: ${rateLimit.remaining}/${rateLimit.limit}`);
console.log(`Resets at: ${new Date(rateLimit.reset * 1000)}`);

// Automatic backoff when approaching limits
if (rateLimit.remaining < 100) {
  console.warn('Approaching rate limit, implementing backoff');
}
```

## Error Handling

### Error Types

- **AuthenticationError**: Invalid app credentials or installation
- **RateLimitError**: API rate limits exceeded
- **ExternalServiceError**: GitHub API failures or network issues

### Retry Logic

```typescript
// Automatic retry with exponential backoff
const options = {
  retries: 3,
  baseDelay: 1000,
  maxDelay: 8000,
  onRetry: (error, attempt) => {
    console.log(`Retry attempt ${attempt}: ${error.message}`);
  }
};
```

## Performance Optimization

### GraphQL vs REST

**Use GraphQL for**:
- Complex nested data (PR with reviews and commits)
- Multiple related resources in single request
- Specific field selection to reduce payload

**Use REST for**:
- Simple CRUD operations
- File operations and binary data
- Actions not available in GraphQL

### Caching Strategy

```typescript
// Repository metadata cached for 10 minutes
const repo = await client.getRepository('owner', 'name'); // API call
const repo2 = await client.getRepository('owner', 'name'); // Cache hit

// Clear specific cache
await cache.delete(`github:repo:owner/name`);
```

## Webhook Events

### Supported Events

1. **Push Events**
   - New commits
   - Branch updates
   - Tag creation

2. **Pull Request Events**
   - Opened, closed, merged
   - Review requested/submitted
   - Synchronize (new commits)

3. **Repository Events**
   - Created, deleted, renamed
   - Settings changes
   - Collaborator changes

### Event Processing

```typescript
// Webhook event handler
async function handlePushEvent(payload: GitHubWebhookEvent) {
  const { repository, commits, ref } = payload;
  
  for (const commit of commits) {
    // Extract JIRA ticket references
    const ticketRefs = extractTicketReferences(commit.message);
    
    // Update database
    await updateCommitRecord(commit, ticketRefs);
    
    // Trigger alerts if needed
    if (ticketRefs.length > 0) {
      await triggerSprintAlert(ticketRefs, commit);
    }
  }
}
```

## Integration with JIRA

### Ticket Reference Extraction

```typescript
// Extract JIRA ticket references from commit messages
const commitMessage = "PROJ-123: Fix login bug";
const ticketRefs = extractTicketReferences(commitMessage);
// Returns: ['PROJ-123']

// Link commits to JIRA issues
await linkCommitToJiraIssue('PROJ-123', commitData);
```

### Cross-Platform Analytics

```typescript
// Combine GitHub and JIRA data
const sprintAnalysis = await analyzeSprintProgress({
  jiraSprintId: 'sprint-456',
  githubRepos: ['repo1', 'repo2'],
  dateRange: { start: '2025-07-01', end: '2025-07-28' }
});

console.log(`Commits linked to sprint: ${sprintAnalysis.linkedCommits}`);
console.log(`PRs merged: ${sprintAnalysis.mergedPRs}`);
```

## Security

### Webhook Security

```typescript
// Verify webhook signature
const signature = req.headers['x-hub-signature-256'];
const payload = req.body;

const isValid = crypto
  .createHmac('sha256', webhookSecret)
  .update(payload)
  .digest('hex') === signature;
```

### Access Control

- **Repository-level permissions** through GitHub App installation
- **Principle of least privilege** with minimal required scopes
- **Audit logging** for all API operations

## Monitoring and Health Checks

### Health Check Implementation

```typescript
async function healthCheck(): Promise<boolean> {
  try {
    // Test authentication
    await client.getCurrentUser();
    
    // Check rate limits
    const rateLimit = await client.getRateLimit();
    if (rateLimit.remaining < 100) {
      console.warn('Low rate limit remaining');
    }
    
    return true;
  } catch (error) {
    logger.error('GitHub health check failed:', error);
    return false;
  }
}
```

### Metrics and Logging

```typescript
// Structured logging for all operations
logger.info('GitHub API request', {
  method: 'GET',
  endpoint: '/repos/owner/name',
  installationId: '123456',
  duration: 234,
  rateLimit: {
    remaining: 4500,
    limit: 5000
  }
});
```

## Troubleshooting

### Common Issues

1. **Authentication Failures**
   - Verify GitHub App ID and private key
   - Check installation ID and permissions
   - Ensure app is installed on target repositories

2. **Rate Limit Errors**
   - Monitor rate limit headers
   - Implement exponential backoff
   - Consider GraphQL for complex queries

3. **Webhook Delivery Issues**
   - Verify webhook URL accessibility
   - Check signature validation logic
   - Monitor webhook delivery attempts in GitHub

### Debug Commands

```typescript
// Debug token and permissions
const tokenInfo = await client.getTokenInfo();
console.log('Token info:', tokenInfo);

// Check installation repositories
const repos = await client.listRepositories();
console.log(`Access to ${repos.length} repositories`);

// Test webhook signature validation
const isValid = webhookService.verifySignature(payload, signature);
console.log('Webhook signature valid:', isValid);
```

## Related Documentation

- [API Reference](../API.md#github-integration)
- [GitHub App Setup Guide](../guides/GITHUB_APP_SETUP.md)
- [Webhook Configuration](../guides/WEBHOOKS.md)
- [Troubleshooting](../TROUBLESHOOTING.md#github-integration)