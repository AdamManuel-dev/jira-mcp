# Bitbucket Integration Module

## Overview

The Bitbucket integration module provides comprehensive connectivity with Bitbucket repositories through REST API v2, supporting both Bitbucket Cloud and Server/Data Center deployments for repository synchronization and pull request tracking in the Sprint Intelligence Alert System (SIAS).

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Bitbucket Client│────▶│Bitbucket Service│────▶│Bitbucket Webhook│
│   (API Layer)   │     │ (Business Logic)│     │   (Events)      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   OAuth 2.0     │     │  Repository     │     │  Event Queue    │
│ (Authentication)│     │     Sync        │     │  (Processing)   │
│                 │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Components

### 1. BitbucketApiClient (`client.ts`)

**Purpose**: Low-level REST API client with OAuth 2.0 authentication for Bitbucket integration.

**Key Features**:
- OAuth 2.0 authentication with token refresh
- Support for both Bitbucket Cloud and Server/Data Center
- Rate limiting and error handling
- Request caching with Redis
- Comprehensive API coverage

**Main APIs**:
- **Repositories**: `listRepositories()`, `getRepository()`
- **Pull Requests**: `listPullRequests()`, `getPullRequest()`
- **Commits**: `listCommits()`, `getCommit()`
- **Pipelines**: `listPipelines()`, `getPipeline()` (Cloud only)
- **Webhooks**: Webhook management and configuration

**Supported Endpoints**:
- `/repositories` - Repository management
- `/pullrequests` - Pull request operations
- `/commits` - Commit history and details
- `/pipelines` - CI/CD pipeline data (Cloud)
- `/webhooks` - Webhook configuration

## Configuration

### Environment Variables

```bash
# Bitbucket OAuth Configuration
BITBUCKET_CLIENT_ID=your_oauth_client_id
BITBUCKET_CLIENT_SECRET=your_oauth_client_secret
BITBUCKET_WEBHOOK_SECRET=your_webhook_secret

# Server Configuration (for self-hosted instances)
BITBUCKET_BASE_URL=https://bitbucket.your-company.com  # Optional for Cloud

# Performance Settings
BITBUCKET_RATE_LIMIT_REQUESTS_PER_HOUR=1000
BITBUCKET_REQUEST_TIMEOUT_MS=30000
BITBUCKET_MAX_RETRIES=3
```

### OAuth Application Setup

1. **Create OAuth Consumer** in Bitbucket settings
2. **Configure permissions**:
   - Repositories: Read
   - Pull requests: Read
   - Webhooks: Read and write (for webhook management)
3. **Set callback URL** for OAuth flow
4. **Configure webhook endpoints** for real-time updates

## Usage Examples

### Basic Client Usage

```typescript
import { BitbucketApiClient } from '@/integrations/bitbucket/client';

const client = new BitbucketApiClient({
  organizationId: 'org123',
  workspace: 'my-workspace'
});

await client.initialize();

// List repositories in workspace
const repos = await client.listRepositories();
console.log(`Found ${repos.length} repositories`);

// Get specific repository
const repo = await client.getRepository('workspace', 'repo-name');
console.log(`Repository: ${repo.name} (${repo.language})`);

// List pull requests
const pullRequests = await client.listPullRequests('workspace', 'repo-name', {
  state: 'OPEN',
  pagelen: 50
});
```

### OAuth Flow Integration

```typescript
// Generate OAuth authorization URL
const authUrl = await client.getAuthorizationUrl([
  'repositories',
  'pullrequests'
]);

// Handle OAuth callback
const tokens = await client.exchangeCodeForTokens(authCode);
console.log('Access token obtained');

// Refresh tokens when needed
await client.refreshAccessToken();
```

### Webhook Processing

```typescript
import { BitbucketWebhookService } from '@/integrations/bitbucket/webhook';

const webhookService = new BitbucketWebhookService();

app.post('/webhooks/bitbucket', async (req, res) => {
  const signature = req.headers['x-hub-signature'];
  const event = req.headers['x-event-key'];
  
  const isValid = webhookService.verifySignature(req.body, signature);
  if (isValid) {
    await webhookService.processWebhook(event, req.body);
    res.status(200).send('OK');
  } else {
    res.status(401).send('Invalid signature');
  }
});
```

## Data Models

### Core Types

```typescript
interface BitbucketRepository {
  uuid: string;
  name: string;
  full_name: string;
  description: string | null;
  is_private: boolean;
  language: string | null;
  created_on: string;
  updated_on: string;
  size: number;
  has_issues: boolean;
  has_wiki: boolean;
  fork_policy: 'allow_forks' | 'no_public_forks' | 'no_forks';
  links: {
    self: { href: string };
    html: { href: string };
    clone: Array<{ name: string; href: string }>;
  };
}

interface BitbucketPullRequest {
  id: number;
  title: string;
  description: string;
  state: 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED';
  created_on: string;
  updated_on: string;
  author: BitbucketUser;
  source: {
    branch: { name: string };
    commit: { hash: string };
    repository: BitbucketRepository;
  };
  destination: {
    branch: { name: string };
    commit: { hash: string };
    repository: BitbucketRepository;
  };
  reviewers: BitbucketUser[];
  participants: Array<{
    user: BitbucketUser;
    role: 'REVIEWER' | 'PARTICIPANT';
    approved: boolean;
  }>;
}
```

## Authentication

### OAuth 2.0 Flow

1. **Authorization**: Redirect user to Bitbucket OAuth endpoint
2. **Code Exchange**: Exchange authorization code for access token
3. **Token Refresh**: Automatically refresh tokens when expired
4. **Secure Storage**: Encrypt and store tokens in database

```typescript
// OAuth flow implementation
class BitbucketOAuthService {
  async getAuthorizationUrl(scopes: string[]): Promise<string> {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: scopes.join(' '),
      state: crypto.randomBytes(16).toString('hex')
    });
    
    return `https://bitbucket.org/site/oauth2/authorize?${params}`;
  }
  
  async exchangeCodeForTokens(code: string): Promise<TokenResponse> {
    // Implementation details...
  }
}
```

## API Coverage

### Repositories API

```typescript
// List repositories
const repos = await client.listRepositories({
  role: 'member',
  sort: 'updated_on',
  pagelen: 100
});

// Get repository details
const repo = await client.getRepository('workspace', 'repo-slug');

// List repository branches
const branches = await client.listBranches('workspace', 'repo-slug');

// Get branch details
const branch = await client.getBranch('workspace', 'repo-slug', 'main');
```

### Pull Requests API

```typescript
// List pull requests
const prs = await client.listPullRequests('workspace', 'repo-slug', {
  state: 'OPEN',
  sort: 'updated_on'
});

// Get pull request details
const pr = await client.getPullRequest('workspace', 'repo-slug', 123);

// List pull request commits
const commits = await client.getPullRequestCommits('workspace', 'repo-slug', 123);

// Get pull request diff
const diff = await client.getPullRequestDiff('workspace', 'repo-slug', 123);
```

### Commits API

```typescript
// List commits
const commits = await client.listCommits('workspace', 'repo-slug', {
  include: 'main',
  exclude: 'develop',
  pagelen: 50
});

// Get commit details
const commit = await client.getCommit('workspace', 'repo-slug', 'commit-hash');

// Get commit diff
const diff = await client.getCommitDiff('workspace', 'repo-slug', 'commit-hash');
```

### Pipelines API (Cloud Only)

```typescript
// List pipelines
const pipelines = await client.listPipelines('workspace', 'repo-slug', {
  target: { ref_name: 'main', ref_type: 'branch' },
  sort: '-created_on'
});

// Get pipeline details
const pipeline = await client.getPipeline('workspace', 'repo-slug', 'pipeline-uuid');

// Get pipeline steps
const steps = await client.getPipelineSteps('workspace', 'repo-slug', 'pipeline-uuid');
```

## Rate Limiting

### Bitbucket Rate Limits

- **Cloud**: 1000 requests/hour per user
- **Server/Data Center**: Configurable (typically higher)
- **Burst allowance**: Short bursts up to 200 requests/hour

### Rate Limit Handling

```typescript
// Check rate limit status
const rateLimitInfo = client.getRateLimitInfo();
console.log(`Remaining: ${rateLimitInfo.remaining}/${rateLimitInfo.limit}`);
console.log(`Resets at: ${new Date(rateLimitInfo.reset_time * 1000)}`);

// Automatic backoff when approaching limits
if (rateLimitInfo.remaining < 50) {
  console.warn('Approaching rate limit, implementing backoff');
  await delay(rateLimitInfo.reset_time_seconds * 1000);
}
```

## Error Handling

### Error Types

```typescript
// Custom error classes
class BitbucketAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BitbucketAuthenticationError';
  }
}

class BitbucketRateLimitError extends Error {
  constructor(resetTime: number) {
    super(`Rate limit exceeded. Resets at ${new Date(resetTime * 1000)}`);
    this.name = 'BitbucketRateLimitError';
  }
}

class BitbucketApiError extends Error {
  constructor(status: number, message: string) {
    super(`Bitbucket API error (${status}): ${message}`);
    this.name = 'BitbucketApiError';
  }
}
```

### Retry Strategy

```typescript
// Exponential backoff with jitter
const retryStrategy = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 8000,
  backoffFactor: 2,
  jitter: true
};

async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = retryStrategy
): Promise<T> {
  // Implementation with exponential backoff
}
```

## Webhook Events

### Supported Events

1. **Repository Events**
   - `repo:push` - New commits pushed
   - `repo:fork` - Repository forked
   - `repo:updated` - Repository settings changed

2. **Pull Request Events**
   - `pullrequest:created` - New pull request
   - `pullrequest:updated` - PR updated
   - `pullrequest:approved` - PR approved
   - `pullrequest:merged` - PR merged
   - `pullrequest:declined` - PR declined

3. **Pipeline Events** (Cloud only)
   - `repo:commit_status_created` - Build status updated
   - `repo:commit_status_updated` - Build status changed

### Webhook Configuration

```typescript
// Create webhook
const webhook = await client.createWebhook('workspace', 'repo-slug', {
  description: 'SIAS Integration Webhook',
  url: 'https://api.example.com/webhooks/bitbucket',
  active: true,
  events: [
    'repo:push',
    'pullrequest:created',
    'pullrequest:updated',
    'pullrequest:merged'
  ]
});
```

## Integration with JIRA

### Commit Message Parsing

```typescript
// Extract JIRA ticket references from Bitbucket commits
function extractJiraReferences(commitMessage: string): string[] {
  const jiraPattern = /([A-Z][A-Z0-9]+-\d+)/g;
  return commitMessage.match(jiraPattern) || [];
}

// Link commits to JIRA issues
async function linkCommitToJira(commit: BitbucketCommit) {
  const ticketRefs = extractJiraReferences(commit.message);
  
  for (const ticketRef of ticketRefs) {
    await updateJiraIssueWithCommit(ticketRef, {
      hash: commit.hash,
      message: commit.message,
      author: commit.author.display_name,
      repository: commit.repository.full_name,
      url: commit.links.html.href
    });
  }
}
```

### Smart Commit Processing

Bitbucket supports smart commits for JIRA integration:

```bash
# Commit messages that automatically update JIRA
git commit -m "PROJ-123 #time 2h #comment Fixed authentication bug"
git commit -m "PROJ-456 #resolve Fixed critical security vulnerability"
```

## Performance Optimization

### Caching Strategy

```typescript
// Repository metadata cached for 15 minutes
const cacheKey = `bitbucket:repo:${workspace}/${repo_slug}`;
const cachedRepo = await cache.get(cacheKey);

if (cachedRepo) {
  return JSON.parse(cachedRepo);
}

const repo = await this.fetchRepository(workspace, repo_slug);
await cache.set(cacheKey, JSON.stringify(repo), 900); // 15 minutes
```

### Pagination Optimization

```typescript
// Efficient pagination handling
async function fetchAllPullRequests(workspace: string, repo: string) {
  const allPRs: BitbucketPullRequest[] = [];
  let nextUrl: string | null = null;
  
  do {
    const response = await client.request(nextUrl || `/repositories/${workspace}/${repo}/pullrequests`);
    allPRs.push(...response.values);
    nextUrl = response.next;
  } while (nextUrl);
  
  return allPRs;
}
```

## Security Considerations

### OAuth Token Security

```typescript
// Secure token storage with encryption
const encryptedToken = await encrypt(accessToken, encryptionKey);
await database.query(
  'UPDATE integrations SET encrypted_token = $1 WHERE id = $2',
  [encryptedToken, integrationId]
);

// Token validation before use
async function validateToken(token: string): Promise<boolean> {
  try {
    await client.getCurrentUser();
    return true;
  } catch (error) {
    if (error instanceof BitbucketAuthenticationError) {
      await refreshToken();
      return false;
    }
    throw error;
  }
}
```

### Webhook Security

```typescript
// HMAC signature verification
function verifyWebhookSignature(payload: string, signature: string): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(payload)
    .digest('hex');
    
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
```

## Monitoring and Health Checks

### Health Check Implementation

```typescript
async function healthCheck(): Promise<{
  status: 'healthy' | 'unhealthy';
  details: Record<string, any>;
}> {
  try {
    // Test authentication
    const user = await client.getCurrentUser();
    
    // Check rate limits
    const rateLimit = client.getRateLimitInfo();
    
    // Test repository access
    const repos = await client.listRepositories({ pagelen: 1 });
    
    return {
      status: 'healthy',
      details: {
        authenticated: true,
        user: user.display_name,
        rateLimit: rateLimit,
        repositoryAccess: repos.length > 0
      }
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      details: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    };
  }
}
```

### Metrics Collection

```typescript
// Performance and usage metrics
const metrics = {
  requestCount: 0,
  errorCount: 0,
  averageResponseTime: 0,
  rateLimitHits: 0,
  lastSuccessfulSync: null
};

// Middleware for request tracking
function trackRequest(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    metrics.requestCount++;
    metrics.averageResponseTime = 
      (metrics.averageResponseTime + duration) / 2;
    
    if (res.statusCode >= 400) {
      metrics.errorCount++;
    }
  });
  
  next();
}
```

## Troubleshooting

### Common Issues

1. **OAuth Authentication Failures**
   ```typescript
   // Debug OAuth flow
   console.log('OAuth client ID:', config.bitbucket.clientId);
   console.log('Redirect URI:', config.bitbucket.redirectUri);
   console.log('Token expiry:', new Date(tokenExpiresAt));
   ```

2. **Rate Limit Exceeded**
   ```typescript
   // Monitor rate limit usage
   const rateLimitInfo = client.getRateLimitInfo();
   if (rateLimitInfo.remaining < 100) {
     logger.warn('Approaching Bitbucket rate limit', rateLimitInfo);
   }
   ```

3. **Webhook Delivery Issues**
   ```typescript
   // Verify webhook configuration
   const webhooks = await client.listWebhooks(workspace, repo);
   console.log('Configured webhooks:', webhooks);
   
   // Test webhook endpoint
   const response = await fetch(webhookUrl, {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify(testPayload)
   });
   ```

### Debug Tools

```typescript
// Enable debug logging
process.env.DEBUG = 'bitbucket:*';

// Clear cache for debugging
await cache.del(`bitbucket:*`);

// Test API connectivity
const testResult = await client.testConnection();
console.log('Bitbucket connectivity:', testResult);
```

## Related Documentation

- [API Reference](../API.md#bitbucket-integration)
- [OAuth Setup Guide](../guides/BITBUCKET_OAUTH.md)
- [Webhook Configuration](../guides/WEBHOOKS.md)
- [Troubleshooting](../TROUBLESHOOTING.md#bitbucket-integration)