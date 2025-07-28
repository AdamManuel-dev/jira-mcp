# GitLab Integration Module

## Overview

The GitLab integration module provides comprehensive connectivity with GitLab repositories through REST API v4, supporting both GitLab SaaS and self-hosted GitLab instances for repository synchronization, merge request tracking, and CI/CD pipeline monitoring in the Sprint Intelligence Alert System (SIAS).

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  GitLab Client  │────▶│ GitLab Service  │────▶│ GitLab Webhook  │
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

### 1. GitLabApiClient (`client.ts`)

**Purpose**: Low-level REST API client with OAuth 2.0 authentication for GitLab integration.

**Key Features**:
- OAuth 2.0 authentication with token refresh
- Support for both GitLab.com and self-hosted instances
- Comprehensive rate limiting and error handling
- Request caching with Redis
- Full GitLab API v4 coverage

**Main APIs**:
- **Projects**: `listProjects()`, `getProject()`
- **Merge Requests**: `listMergeRequests()`, `getMergeRequest()`
- **Commits**: `listCommits()`, `getCommit()`
- **Pipelines**: `listPipelines()`, `getPipeline()`
- **Issues**: `listIssues()`, `getIssue()` (GitLab Issues)
- **Webhooks**: Webhook management and configuration

**Supported Endpoints**:
- `/projects` - Project management and metadata
- `/merge_requests` - Merge request operations
- `/repository/commits` - Commit history and details
- `/pipelines` - CI/CD pipeline data
- `/issues` - GitLab issue tracking
- `/hooks` - Webhook configuration

## Configuration

### Environment Variables

```bash
# GitLab OAuth Configuration
GITLAB_CLIENT_ID=your_oauth_client_id
GITLAB_CLIENT_SECRET=your_oauth_client_secret
GITLAB_WEBHOOK_SECRET=your_webhook_secret

# Instance Configuration
GITLAB_BASE_URL=https://gitlab.your-company.com  # Optional for GitLab.com

# Performance Settings
GITLAB_RATE_LIMIT_REQUESTS_PER_MINUTE=300
GITLAB_REQUEST_TIMEOUT_MS=30000
GITLAB_MAX_RETRIES=3
GITLAB_PAGINATION_LIMIT=100
```

### OAuth Application Setup

1. **Create OAuth Application** in GitLab settings
2. **Configure scopes**:
   - `read_repository` - Read repository data
   - `read_user` - Read user profile
   - `api` - Full API access (for webhooks)
3. **Set redirect URI** for OAuth flow
4. **Configure webhook URLs** for real-time updates

## Usage Examples

### Basic Client Usage

```typescript
import { GitLabApiClient } from '@/integrations/gitlab/client';

const client = new GitLabApiClient({
  organizationId: 'org123',
  baseUrl: 'https://gitlab.example.com' // Optional for GitLab.com
});

await client.initialize();

// List accessible projects
const projects = await client.listProjects({
  membership: true,
  sort: 'last_activity_at',
  order: 'desc'
});

// Get specific project
const project = await client.getProject('project-id-or-path');
console.log(`Project: ${project.name} (${project.default_branch})`);

// List merge requests
const mergeRequests = await client.listMergeRequests('project-id', {
  state: 'opened',
  per_page: 50
});
```

### OAuth Authentication Flow

```typescript
// Generate OAuth authorization URL
const authUrl = await client.getAuthorizationUrl([
  'read_repository',
  'read_user',
  'api'
]);

// Handle OAuth callback
const tokens = await client.exchangeCodeForTokens(authCode);
console.log('Access token obtained');

// Refresh tokens automatically
await client.refreshAccessToken();
```

### Pipeline and CI/CD Integration

```typescript
// List project pipelines
const pipelines = await client.listPipelines('project-id', {
  status: 'running',
  ref: 'main',
  per_page: 20
});

// Get pipeline details with jobs
const pipeline = await client.getPipeline('project-id', 'pipeline-id');
console.log(`Pipeline ${pipeline.id}: ${pipeline.status}`);

// Get pipeline jobs
const jobs = await client.getPipelineJobs('project-id', 'pipeline-id');
jobs.forEach(job => {
  console.log(`Job: ${job.name} - ${job.status}`);
});
```

### Webhook Processing

```typescript
import { GitLabWebhookService } from '@/integrations/gitlab/webhook';

const webhookService = new GitLabWebhookService();

app.post('/webhooks/gitlab', async (req, res) => {
  const token = req.headers['x-gitlab-token'];
  const event = req.headers['x-gitlab-event'];
  
  const isValid = webhookService.verifyToken(token);
  if (isValid) {
    await webhookService.processWebhook(event, req.body);
    res.status(200).send('OK');
  } else {
    res.status(401).send('Invalid token');
  }
});
```

## Data Models

### Core Types

```typescript
interface GitLabProject {
  id: number;
  name: string;
  name_with_namespace: string;
  path: string;
  path_with_namespace: string;
  description: string | null;
  default_branch: string;
  visibility: 'private' | 'internal' | 'public';
  issues_enabled: boolean;
  merge_requests_enabled: boolean;
  wiki_enabled: boolean;
  jobs_enabled: boolean;
  snippets_enabled: boolean;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  namespace: {
    id: number;
    name: string;
    path: string;
    kind: 'user' | 'group';
  };
  web_url: string;
  avatar_url: string | null;
  star_count: number;
  forks_count: number;
}

interface GitLabMergeRequest {
  id: number;
  iid: number;
  title: string;
  description: string;
  state: 'opened' | 'closed' | 'locked' | 'merged';
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  closed_at: string | null;
  author: GitLabUser;
  assignee: GitLabUser | null;
  assignees: GitLabUser[];
  reviewers: GitLabUser[];
  source_branch: string;
  target_branch: string;
  work_in_progress: boolean;
  draft: boolean;
  merge_when_pipeline_succeeds: boolean;
  merge_status: 'can_be_merged' | 'cannot_be_merged' | 'unchecked';
  sha: string;
  merge_commit_sha: string | null;
  squash_commit_sha: string | null;
  user_notes_count: number;
  changes_count: string;
  should_remove_source_branch: boolean;
  force_remove_source_branch: boolean;
  web_url: string;
}

interface GitLabPipeline {
  id: number;
  sha: string;
  ref: string;
  status: 'created' | 'waiting_for_resource' | 'preparing' | 'pending' | 
          'running' | 'success' | 'failed' | 'canceled' | 'skipped' | 
          'manual' | 'scheduled';
  created_at: string;
  updated_at: string;
  web_url: string;
  user: GitLabUser;
  duration: number | null;
  queued_duration: number | null;
  coverage: string | null;
}
```

## Authentication

### OAuth 2.0 Flow

GitLab uses OAuth 2.0 for secure API access:

1. **Authorization Request**: Redirect user to GitLab OAuth endpoint
2. **Code Exchange**: Exchange authorization code for access token
3. **Token Usage**: Include token in API requests
4. **Token Refresh**: Automatically refresh when expired

```typescript
class GitLabOAuthService {
  async getAuthorizationUrl(scopes: string[]): Promise<string> {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: scopes.join(' '),
      state: crypto.randomBytes(16).toString('hex')
    });
    
    return `${this.baseUrl}/oauth/authorize?${params}`;
  }
  
  async exchangeCodeForTokens(code: string): Promise<TokenResponse> {
    const response = await axios.post(`${this.baseUrl}/oauth/token`, {
      grant_type: 'authorization_code',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code: code,
      redirect_uri: this.redirectUri
    });
    
    return response.data;
  }
}
```

## API Coverage

### Projects API

```typescript
// List projects with filtering
const projects = await client.listProjects({
  membership: true,              // Only projects user is member of
  owned: false,                 // Include projects user doesn't own
  starred: false,               // Include starred projects
  archived: false,              // Exclude archived projects
  visibility: 'private',        // Filter by visibility
  order_by: 'last_activity_at', // Sort order
  sort: 'desc',                 // Sort direction
  search: 'my-project',         // Search query
  simple: false,                // Include full project details
  statistics: true,             // Include project statistics
  with_issues_enabled: true,    // Only projects with issues enabled
  with_merge_requests_enabled: true, // Only projects with MRs enabled
  min_access_level: 30          // Minimum access level (Developer)
});

// Get single project with additional details
const project = await client.getProject('project-id', {
  statistics: true,
  license: true,
  with_custom_attributes: true
});

// Get project members
const members = await client.getProjectMembers('project-id');

// Get project languages
const languages = await client.getProjectLanguages('project-id');
```

### Merge Requests API

```typescript
// List merge requests with comprehensive filtering
const mergeRequests = await client.listMergeRequests('project-id', {
  state: 'opened',
  order_by: 'created_at',
  sort: 'desc',
  milestone: 'v1.0',
  view: 'simple',
  labels: 'bug,frontend',
  created_after: '2025-01-01T00:00:00Z',
  created_before: '2025-12-31T23:59:59Z',
  updated_after: '2025-07-01T00:00:00Z',
  updated_before: '2025-07-31T23:59:59Z',
  scope: 'created_by_me',
  author_id: 123,
  assignee_id: 456,
  my_reaction_emoji: 'thumbsup',
  source_branch: 'feature-branch',
  target_branch: 'main',
  search: 'authentication',
  wip: 'no'  // Exclude work-in-progress MRs
});

// Get merge request with detailed information
const mr = await client.getMergeRequest('project-id', 'merge-request-iid', {
  render_html: true,
  include_diverged_commits_count: true,
  include_rebase_in_progress: true
});

// Get merge request changes
const changes = await client.getMergeRequestChanges('project-id', 'mr-iid');

// Get merge request commits
const commits = await client.getMergeRequestCommits('project-id', 'mr-iid');

// Get merge request pipeline
const pipeline = await client.getMergeRequestPipeline('project-id', 'mr-iid');
```

### Commits API

```typescript
// List commits with filtering
const commits = await client.listCommits('project-id', {
  ref_name: 'main',
  since: '2025-07-01T00:00:00Z',
  until: '2025-07-31T23:59:59Z',
  path: 'src/',
  author: 'john.doe@example.com',
  all: false,
  with_stats: true,
  first_parent: false,
  order: 'default',
  trailers: false
});

// Get single commit
const commit = await client.getCommit('project-id', 'commit-sha', {
  stats: true
});

// Get commit diff
const diff = await client.getCommitDiff('project-id', 'commit-sha');

// Get commit comments
const comments = await client.getCommitComments('project-id', 'commit-sha');
```

### Pipelines API

```typescript
// List pipelines
const pipelines = await client.listPipelines('project-id', {
  scope: 'branches',
  status: 'success',
  ref: 'main',
  sha: 'commit-sha',
  yaml_errors: false,
  name: 'pipeline-name',
  username: 'user-name',
  updated_after: '2025-07-01T00:00:00Z',
  updated_before: '2025-07-31T23:59:59Z',
  order_by: 'id',
  sort: 'desc'
});

// Get pipeline details
const pipeline = await client.getPipeline('project-id', 'pipeline-id');

// Get pipeline jobs
const jobs = await client.getPipelineJobs('project-id', 'pipeline-id', {
  scope: ['success', 'failed']
});

// Get pipeline variables
const variables = await client.getPipelineVariables('project-id', 'pipeline-id');

// Retry pipeline
await client.retryPipeline('project-id', 'pipeline-id');

// Cancel pipeline
await client.cancelPipeline('project-id', 'pipeline-id');
```

## Rate Limiting

### GitLab Rate Limits

- **Standard Users**: 300 requests per minute
- **Premium/Ultimate**: Higher limits based on plan
- **Self-hosted**: Configurable by administrators

### Rate Limit Headers

```typescript
// GitLab includes rate limit information in response headers
interface GitLabRateLimit {
  limit: number;           // RateLimit-Limit
  remaining: number;       // RateLimit-Remaining
  reset: number;          // RateLimit-Reset
  resetTime: Date;        // RateLimit-ResetTime
  observedRequests: number; // RateLimit-Observed
}

// Monitor rate limits
const rateLimit = client.getRateLimitInfo();
if (rateLimit.remaining < 50) {
  logger.warn('Approaching GitLab rate limit', rateLimit);
  
  // Implement backoff
  const resetTime = new Date(rateLimit.resetTime);
  const delayMs = resetTime.getTime() - Date.now();
  await delay(Math.min(delayMs, 60000)); // Max 1 minute delay
}
```

## Error Handling

### GitLab API Error Responses

```typescript
interface GitLabError {
  message: string;
  error_description?: string;
  error?: string;
  error_uri?: string;
}

// Error handling with specific GitLab error types
class GitLabApiError extends Error {
  constructor(
    public status: number,
    public gitlabError: GitLabError,
    public url: string
  ) {
    super(`GitLab API Error (${status}): ${gitlabError.message}`);
    this.name = 'GitLabApiError';
  }
}

// Handle common error scenarios
async function handleGitLabError(error: AxiosError): Promise<never> {
  const response = error.response;
  
  if (!response) {
    throw new ExternalServiceError('GitLab', new Error('Network error'));
  }
  
  switch (response.status) {
    case 401:
      throw new AuthenticationError('GitLab authentication failed');
    case 403:
      throw new AuthenticationError('Insufficient GitLab permissions');
    case 404:
      throw new ExternalServiceError('GitLab', new Error('Resource not found'));
    case 429:
      const resetTime = response.headers['ratelimit-reset'];
      throw new RateLimitError(`Rate limit exceeded. Resets at ${resetTime}`);
    case 422:
      throw new ExternalServiceError('GitLab', new Error('Validation failed'));
    default:
      throw new GitLabApiError(response.status, response.data, error.config?.url || '');
  }
}
```

## Webhook Events

### Supported Events

1. **Push Events**
   - New commits pushed to repository
   - Branch creation/deletion
   - Tag creation/deletion

2. **Merge Request Events**
   - Merge request opened/closed/merged
   - Merge request updated
   - Merge request approved/unapproved

3. **Pipeline Events**
   - Pipeline started/succeeded/failed
   - Job status changes
   - Deployment events

4. **Issue Events** (GitLab Issues)
   - Issue opened/closed/updated
   - Issue assigned/unassigned
   - Label changes

### Webhook Configuration

```typescript
// Create project webhook
const webhook = await client.createWebhook('project-id', {
  url: 'https://api.example.com/webhooks/gitlab',
  push_events: true,
  issues_events: true,
  merge_requests_events: true,
  tag_push_events: true,
  note_events: false,
  job_events: true,
  pipeline_events: true,
  wiki_page_events: false,
  deployment_events: true,
  releases_events: true,
  subgroup_events: false,
  enable_ssl_verification: true,
  token: 'webhook-secret-token',
  push_events_branch_filter: 'main' // Only trigger on main branch
});

// List existing webhooks
const webhooks = await client.listWebhooks('project-id');

// Update webhook
await client.updateWebhook('project-id', 'webhook-id', {
  url: 'https://new-url.example.com/webhooks/gitlab',
  merge_requests_events: false
});

// Delete webhook
await client.deleteWebhook('project-id', 'webhook-id');
```

### Webhook Event Processing

```typescript
// Process different types of webhook events
class GitLabWebhookProcessor {
  async processPushEvent(payload: GitLabPushEvent): Promise<void> {
    const { project, commits, ref } = payload;
    
    logger.info('Processing GitLab push event', {
      project: project.path_with_namespace,
      branch: ref.replace('refs/heads/', ''),
      commitCount: commits.length
    });
    
    for (const commit of commits) {
      // Extract JIRA ticket references
      const ticketRefs = this.extractJiraReferences(commit.message);
      
      // Update commit record
      await this.updateCommitRecord(commit, ticketRefs, project);
      
      // Trigger sprint alerts if needed
      if (ticketRefs.length > 0) {
        await this.triggerSprintAlert(ticketRefs, commit, project);
      }
    }
  }
  
  async processMergeRequestEvent(payload: GitLabMergeRequestEvent): Promise<void> {
    const { object_attributes: mr, project } = payload;
    
    logger.info('Processing GitLab merge request event', {
      project: project.path_with_namespace,
      mergeRequest: mr.iid,
      action: mr.action,
      state: mr.state
    });
    
    // Update merge request record
    await this.updateMergeRequestRecord(mr, project);
    
    // Handle specific actions
    switch (mr.action) {
      case 'open':
        await this.handleMergeRequestOpened(mr, project);
        break;
      case 'merge':
        await this.handleMergeRequestMerged(mr, project);
        break;
      case 'close':
        await this.handleMergeRequestClosed(mr, project);
        break;
    }
  }
  
  async processPipelineEvent(payload: GitLabPipelineEvent): Promise<void> {
    const { object_attributes: pipeline, project } = payload;
    
    logger.info('Processing GitLab pipeline event', {
      project: project.path_with_namespace,
      pipeline: pipeline.id,
      status: pipeline.status,
      ref: pipeline.ref
    });
    
    // Update pipeline record
    await this.updatePipelineRecord(pipeline, project);
    
    // Handle pipeline completion
    if (['success', 'failed', 'canceled'].includes(pipeline.status)) {
      await this.handlePipelineCompletion(pipeline, project);
    }
  }
}
```

## Integration with JIRA

### Smart Commits

GitLab supports JIRA integration for smart commits:

```bash
# Commit messages that automatically update JIRA
git commit -m "PROJ-123 Fix authentication bug #time 2h #comment Updated OAuth flow"
git commit -m "PROJ-456 Resolve security vulnerability #resolve"
```

### Issue Linking

```typescript
// Extract and link JIRA issues from GitLab content
class GitLabJiraIntegration {
  extractJiraReferences(text: string): string[] {
    const jiraPattern = /([A-Z][A-Z0-9]+-\d+)/g;
    return text.match(jiraPattern) || [];
  }
  
  async linkCommitToJira(commit: GitLabCommit, project: GitLabProject): Promise<void> {
    const ticketRefs = this.extractJiraReferences(commit.message);
    
    for (const ticketRef of ticketRefs) {
      await this.updateJiraIssueWithCommit(ticketRef, {
        id: commit.id,
        message: commit.message,
        author: commit.author_name,
        author_email: commit.author_email,
        timestamp: commit.timestamp,
        url: commit.url,
        repository: project.path_with_namespace,
        branch: commit.ref
      });
    }
  }
  
  async linkMergeRequestToJira(mr: GitLabMergeRequest, project: GitLabProject): Promise<void> {
    const ticketRefs = [
      ...this.extractJiraReferences(mr.title),
      ...this.extractJiraReferences(mr.description)
    ];
    
    for (const ticketRef of ticketRefs) {
      await this.updateJiraIssueWithMergeRequest(ticketRef, {
        iid: mr.iid,
        title: mr.title,
        state: mr.state,
        author: mr.author.name,
        url: mr.web_url,
        repository: project.path_with_namespace,
        source_branch: mr.source_branch,
        target_branch: mr.target_branch,
        created_at: mr.created_at,
        updated_at: mr.updated_at
      });
    }
  }
}
```

## Performance Optimization

### Efficient Data Fetching

```typescript
// Use pagination effectively
async function fetchAllMergeRequests(
  projectId: string,
  options: ListMergeRequestsOptions = {}
): Promise<GitLabMergeRequest[]> {
  const allMRs: GitLabMergeRequest[] = [];
  let page = 1;
  const perPage = 100; // Maximum per page
  
  while (true) {
    const mrs = await client.listMergeRequests(projectId, {
      ...options,
      page,
      per_page: perPage
    });
    
    allMRs.push(...mrs);
    
    // Stop if we got fewer items than requested (last page)
    if (mrs.length < perPage) {
      break;
    }
    
    page++;
  }
  
  return allMRs;
}

// Use specific fields to reduce payload size
const lightweightProjects = await client.listProjects({
  simple: true,  // Reduces response size
  statistics: false,
  with_issues_enabled: true,
  archived: false
});
```

### Caching Strategies

```typescript
// Cache project metadata for longer periods
const projectCacheKey = `gitlab:project:${projectId}`;
const cachedProject = await cache.get(projectCacheKey);

if (cachedProject) {
  return JSON.parse(cachedProject);
}

const project = await client.getProject(projectId);
await cache.set(projectCacheKey, JSON.stringify(project), 1800); // 30 minutes

// Cache merge requests for shorter periods due to frequent updates
const mrCacheKey = `gitlab:mr:${projectId}:${mrIid}`;
await cache.set(mrCacheKey, JSON.stringify(mergeRequest), 300); // 5 minutes
```

## Security

### Token Security

```typescript
// Secure token storage with encryption
import { encrypt, decrypt } from '@/utils/encryption';

async function storeAccessToken(integrationId: string, token: string): Promise<void> {
  const encryptedToken = await encrypt(token, process.env.ENCRYPTION_KEY!);
  
  await database.query(
    'UPDATE gitlab_integrations SET encrypted_access_token = $1 WHERE id = $2',
    [encryptedToken, integrationId]
  );
}

async function getAccessToken(integrationId: string): Promise<string> {
  const result = await database.query(
    'SELECT encrypted_access_token FROM gitlab_integrations WHERE id = $1',
    [integrationId]
  );
  
  if (!result.rows[0]) {
    throw new Error('Integration not found');
  }
  
  return decrypt(result.rows[0].encrypted_access_token, process.env.ENCRYPTION_KEY!);
}
```

### Webhook Security

```typescript
// Verify webhook authenticity using secret token
function verifyWebhookToken(receivedToken: string, expectedToken: string): boolean {
  return crypto.timingSafeEqual(
    Buffer.from(receivedToken),
    Buffer.from(expectedToken)
  );
}

// Middleware for webhook verification
app.use('/webhooks/gitlab', (req, res, next) => {
  const token = req.headers['x-gitlab-token'];
  
  if (!token || !verifyWebhookToken(token, process.env.GITLAB_WEBHOOK_SECRET!)) {
    return res.status(401).json({ error: 'Invalid webhook token' });
  }
  
  next();
});
```

## Monitoring and Health Checks

### Health Check Implementation

```typescript
async function performGitLabHealthCheck(): Promise<HealthCheckResult> {
  const results: HealthCheckResult = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    checks: {}
  };
  
  try {
    // Test authentication
    const startTime = Date.now();
    const user = await client.getCurrentUser();
    results.checks.authentication = {
      status: 'pass',
      responseTime: Date.now() - startTime,
      details: { username: user.username }
    };
    
    // Check rate limits
    const rateLimit = client.getRateLimitInfo();
    results.checks.rateLimit = {
      status: rateLimit.remaining > 50 ? 'pass' : 'warn',
      details: rateLimit
    };
    
    // Test project access
    const projects = await client.listProjects({ per_page: 1 });
    results.checks.projectAccess = {
      status: 'pass',
      details: { accessible_projects: projects.length }
    };
    
  } catch (error) {
    results.status = 'unhealthy';
    results.checks.error = {
      status: 'fail',
      details: { error: error.message }
    };
  }
  
  return results;
}
```

### Metrics and Monitoring

```typescript
// Collect integration metrics
const metrics = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  averageResponseTime: 0,
  rateLimitHits: 0,
  lastSyncTime: null,
  webhooksProcessed: 0,
  activeIntegrations: 0
};

// Request interceptor for metrics
axios.interceptors.response.use(
  (response) => {
    metrics.totalRequests++;
    metrics.successfulRequests++;
    
    const responseTime = Date.now() - response.config.metadata?.startTime;
    metrics.averageResponseTime = 
      (metrics.averageResponseTime + responseTime) / 2;
    
    return response;
  },
  (error) => {
    metrics.totalRequests++;
    metrics.failedRequests++;
    
    if (error.response?.status === 429) {
      metrics.rateLimitHits++;
    }
    
    return Promise.reject(error);
  }
);
```

## Troubleshooting

### Common Issues

1. **OAuth Authentication Problems**
   ```typescript
   // Debug OAuth configuration
   console.log('GitLab OAuth Config:', {
     clientId: config.gitlab.clientId,
     baseUrl: config.gitlab.baseUrl,
     redirectUri: config.gitlab.redirectUri
   });
   
   // Check token validity
   try {
     const user = await client.getCurrentUser();
     console.log('Token valid for user:', user.username);
   } catch (error) {
     console.error('Token validation failed:', error.message);
   }
   ```

2. **Rate Limiting Issues**
   ```typescript
   // Monitor rate limit usage
   const rateLimit = client.getRateLimitInfo();
   console.log('Rate Limit Status:', {
     remaining: rateLimit.remaining,
     limit: rateLimit.limit,
     resetTime: new Date(rateLimit.resetTime)
   });
   
   // Implement adaptive throttling
   if (rateLimit.remaining < 50) {
     const delayMs = Math.min(60000, rateLimit.resetTime - Date.now());
     console.log(`Throttling requests for ${delayMs}ms`);
     await delay(delayMs);
   }
   ```

3. **Webhook Delivery Problems**
   ```typescript
   // Test webhook endpoint accessibility
   const webhookUrl = 'https://api.example.com/webhooks/gitlab';
   try {
     const response = await axios.post(webhookUrl, {
       object_kind: 'test',
       event_type: 'test'
     }, {
       headers: {
         'X-Gitlab-Event': 'Test Hook',
         'X-Gitlab-Token': process.env.GITLAB_WEBHOOK_SECRET
       }
     });
     console.log('Webhook endpoint accessible:', response.status);
   } catch (error) {
     console.error('Webhook endpoint test failed:', error.message);
   }
   ```

### Debug Tools

```typescript
// Enable debug logging
process.env.DEBUG = 'gitlab:*';

// Clear GitLab-specific cache
await cache.del('gitlab:*');

// Test API connectivity with detailed logging
const testResult = await client.testConnection();
console.log('GitLab API connectivity test:', testResult);
```

## Related Documentation

- [API Reference](../API.md#gitlab-integration)
- [OAuth Setup Guide](../guides/GITLAB_OAUTH.md)
- [Webhook Configuration](../guides/WEBHOOKS.md)
- [CI/CD Integration](../guides/CICD_INTEGRATION.md)
- [Troubleshooting](../TROUBLESHOOTING.md#gitlab-integration)