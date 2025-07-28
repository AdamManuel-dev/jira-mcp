# Integrations API Reference

## Overview

This document provides comprehensive API reference for all integration modules in the Sprint Intelligence Alert System (SIAS). Each integration provides standardized interfaces for authentication, data synchronization, and webhook processing.

## Table of Contents

- [JIRA Integration](#jira-integration)
- [GitHub Integration](#github-integration)  
- [Bitbucket Integration](#bitbucket-integration)
- [GitLab Integration](#gitlab-integration)
- [Common Patterns](#common-patterns)
- [Error Handling](#error-handling)

---

## JIRA Integration

### JiraApiClient

Core API client for JIRA REST API v3 operations with OAuth 2.0 authentication, circuit breaker pattern, and comprehensive error handling.

#### Constructor

```typescript
constructor(config: JiraClientConfig)
```

**Parameters:**
- `config.organizationId` (string): Organization identifier
- `config.userId` (string): User identifier for authentication  
- `config.instanceId` (string): JIRA instance identifier
- `config.baseUrl?` (string): Optional custom base URL for JIRA Server/Data Center
- `config.timeout?` (number): Request timeout in milliseconds (default: 30000)
- `config.maxRetries?` (number): Maximum retry attempts (default: 3)

#### Projects API

##### getProjects()

```typescript
async getProjects(expand?: string[]): Promise<JiraProject[]>
```

Retrieves all accessible projects from JIRA instance with optional field expansion. Results are cached for 10 minutes to improve performance.

**Parameters:**
- `expand?` (string[]): Optional fields to expand (e.g., ['description', 'lead', 'components'])

**Returns:** Array of JIRA projects with basic information and expanded fields

**Throws:**
- `AuthenticationError`: When user lacks project access permissions
- `ExternalServiceError`: For API communication errors

**Example:**
```typescript
const projects = await client.getProjects(['description', 'lead']);
console.log(`Found ${projects.length} projects`);
```

##### getProject()  

```typescript
async getProject(projectIdOrKey: string, expand?: string[]): Promise<JiraProject>
```

Retrieves detailed information for a specific JIRA project. Results are cached for 5 minutes.

**Parameters:**
- `projectIdOrKey` (string): Project key (e.g., 'PROJ') or numeric ID
- `expand?` (string[]): Optional fields to expand for additional details

**Returns:** Complete project information including metadata

**Throws:**
- `ExternalServiceError`: When project is not found or inaccessible

#### Issues API

##### searchIssues()

```typescript
async searchIssues(searchRequest: JiraSearchRequest): Promise<JiraSearchResponse>
```

Searches for JIRA issues using JQL (JIRA Query Language) with support for pagination and field selection.

**Parameters:**
- `searchRequest.jql` (string): JQL query string
- `searchRequest.startAt?` (number): Zero-based starting index for pagination
- `searchRequest.maxResults?` (number): Maximum results to return (max 1000)
- `searchRequest.fields?` (string[]): Specific fields to retrieve
- `searchRequest.expand?` (string[]): Fields to expand (e.g., ['changelog', 'transitions'])

**Returns:** Search results with issues, pagination info, and total count

**Throws:**
- `ExternalServiceError`: When JQL syntax is invalid or search fails

**Example:**
```typescript
const results = await client.searchIssues({
  jql: 'project = MYPROJ AND status = "In Progress"',
  maxResults: 50,
  fields: ['key', 'summary', 'status', 'assignee']
});
```

##### getIssue()

```typescript
async getIssue(issueIdOrKey: string, expand?: string[], fields?: string[]): Promise<JiraIssue>
```

Retrieves detailed information for a specific JIRA issue. Results are cached for 1 minute.

**Parameters:**
- `issueIdOrKey` (string): Issue key (e.g., 'PROJ-123') or numeric ID
- `expand?` (string[]): Optional fields to expand (e.g., ['changelog', 'transitions'])
- `fields?` (string[]): Specific fields to retrieve (default: all fields)

**Returns:** Complete issue information including fields and metadata

**Throws:**
- `ExternalServiceError`: When issue is not found or inaccessible

#### Sprints API

##### getBoardSprints()

```typescript
async getBoardSprints(boardId: number, state?: string): Promise<JiraSprint[]>
```

Retrieves sprints associated with a JIRA Agile board. Results are cached for 5 minutes.

**Parameters:**
- `boardId` (number): Numeric ID of the JIRA board
- `state?` (string): Optional sprint state filter ('active', 'future', 'closed')

**Returns:** Array of sprints matching the specified criteria

**Throws:**
- `ExternalServiceError`: When board is not found or inaccessible

##### getSprintIssues()

```typescript
async getSprintIssues(sprintId: number, startAt?: number, maxResults?: number): Promise<JiraSearchResponse>
```

Retrieves all issues assigned to a specific sprint with optimized field selection for sprint reporting.

**Parameters:**
- `sprintId` (number): Numeric ID of the sprint
- `startAt?` (number): Zero-based index for pagination (default: 0)
- `maxResults?` (number): Maximum issues per page (default: 100)

**Returns:** Search results with issues and sprint-specific metadata including story points

---

## GitHub Integration

### GitHubApiClient

GitHub REST API v4 and GraphQL v4 client with GitHub App authentication, supporting both GitHub Cloud and Enterprise Server.

#### Constructor

```typescript
constructor(config: GitHubClientConfig)
```

**Parameters:**
- `config.organizationId` (string): Organization identifier
- `config.installationId` (string): GitHub App installation ID
- `config.baseUrl?` (string): Optional base URL for GitHub Enterprise Server
- `config.timeout?` (number): Request timeout in milliseconds (default: 30000)
- `config.maxRetries?` (number): Maximum retry attempts (default: 3)

#### Initialization

##### initialize()

```typescript
async initialize(): Promise<void>
```

Initializes the client with GitHub App authentication. Generates installation access token and configures both REST and GraphQL clients. Must be called before using API methods.

**Throws:**
- `AuthenticationError`: When app credentials are invalid or installation not found
- `ExternalServiceError`: When GitHub API is unreachable

**Example:**
```typescript
const client = new GitHubApiClient({ organizationId: 'org1', installationId: '123' });
await client.initialize();
```

#### Repositories API

##### listRepositories()

```typescript
async listRepositories(): Promise<GitHubRepository[]>
```

Retrieves all repositories accessible to the GitHub App installation with metadata and permissions.

**Returns:** Array of repositories with metadata and access permissions

**Throws:**
- `AuthenticationError`: When installation token is invalid
- `ExternalServiceError`: When GitHub API request fails

**Example:**
```typescript
const repos = await client.listRepositories();
console.log(`Found ${repos.length} accessible repositories`);
const publicRepos = repos.filter(repo => !repo.private);
```

##### getRepository()

```typescript
async getRepository(owner: string, repo: string): Promise<GitHubRepository>
```

Retrieves detailed information for a specific repository including statistics and configuration.

**Parameters:**
- `owner` (string): Repository owner username or organization
- `repo` (string): Repository name

**Returns:** Complete repository information including metadata

**Throws:**
- `ExternalServiceError`: When repository is not found or inaccessible

#### Pull Requests API

##### listPullRequests()

```typescript
async listPullRequests(owner: string, repo: string, options?: ListPullRequestsOptions): Promise<GitHubPullRequest[]>
```

Lists pull requests for a repository with comprehensive filtering options.

**Parameters:**
- `owner` (string): Repository owner
- `repo` (string): Repository name  
- `options.state?` (string): Filter by state ('open', 'closed', 'all')
- `options.head?` (string): Filter by head branch
- `options.base?` (string): Filter by base branch
- `options.sort?` (string): Sort by ('created', 'updated', 'popularity')
- `options.direction?` (string): Sort direction ('asc', 'desc')
- `options.per_page?` (number): Items per page (max 100)

**Returns:** Array of pull requests matching criteria

##### getPullRequest()

```typescript
async getPullRequest(owner: string, repo: string, pullNumber: number): Promise<GitHubPullRequest>
```

Retrieves detailed information for a specific pull request using GraphQL for comprehensive data including reviews, commits, and file changes.

**Parameters:**
- `owner` (string): Repository owner
- `repo` (string): Repository name
- `pullNumber` (number): Pull request number

**Returns:** Comprehensive pull request data with nested information

---

## Bitbucket Integration

### BitbucketApiClient

Bitbucket REST API v2 client with OAuth 2.0 authentication, supporting both Bitbucket Cloud and Server/Data Center deployments.

#### Constructor

```typescript
constructor(config: BitbucketClientConfig)
```

**Parameters:**
- `config.organizationId` (string): Organization identifier
- `config.workspace` (string): Bitbucket workspace name
- `config.baseUrl?` (string): Optional base URL for Bitbucket Server/Data Center

#### Repositories API

##### listRepositories()

```typescript
async listRepositories(options?: ListRepositoriesOptions): Promise<BitbucketRepository[]>
```

Lists repositories in the workspace with filtering and sorting options.

**Parameters:**
- `options.role?` (string): Filter by user role ('admin', 'contributor', 'member')
- `options.sort?` (string): Sort by field ('created_on', 'updated_on', 'name')
- `options.pagelen?` (number): Number of items per page (max 100)

**Returns:** Array of repository objects with metadata

##### getRepository()

```typescript
async getRepository(workspace: string, repoSlug: string): Promise<BitbucketRepository>
```

Retrieves detailed information for a specific repository including settings and statistics.

**Parameters:**
- `workspace` (string): Bitbucket workspace name
- `repoSlug` (string): Repository slug/name

**Returns:** Complete repository information

---

## GitLab Integration

### GitLabApiClient

GitLab REST API v4 client with OAuth 2.0 authentication, supporting both GitLab SaaS and self-hosted instances.

#### Constructor

```typescript
constructor(config: GitLabClientConfig)
```

**Parameters:**
- `config.organizationId` (string): Organization identifier
- `config.baseUrl?` (string): Optional base URL for self-hosted GitLab instances

#### Projects API

##### listProjects()

```typescript
async listProjects(options?: ListProjectsOptions): Promise<GitLabProject[]>
```

Lists projects accessible to the authenticated user with extensive filtering options.

**Parameters:**
- `options.membership?` (boolean): Only projects user is member of
- `options.owned?` (boolean): Only projects user owns
- `options.visibility?` (string): Filter by visibility ('private', 'internal', 'public')
- `options.order_by?` (string): Sort by field ('id', 'name', 'created_at', 'last_activity_at')
- `options.sort?` (string): Sort direction ('asc', 'desc')
- `options.search?` (string): Search query
- `options.statistics?` (boolean): Include project statistics

**Returns:** Array of project objects with metadata

##### listMergeRequests()

```typescript
async listMergeRequests(projectId: string, options?: ListMergeRequestsOptions): Promise<GitLabMergeRequest[]>
```

Lists merge requests for a project with comprehensive filtering capabilities.

**Parameters:**
- `projectId` (string): Project ID or path
- `options.state?` (string): Filter by state ('opened', 'closed', 'merged')
- `options.labels?` (string): Comma-separated list of labels
- `options.milestone?` (string): Filter by milestone
- `options.author_id?` (number): Filter by author ID
- `options.assignee_id?` (number): Filter by assignee ID
- `options.created_after?` (string): ISO 8601 date string
- `options.created_before?` (string): ISO 8601 date string

**Returns:** Array of merge request objects

---

## Common Patterns

### Authentication

All integration clients follow consistent authentication patterns:

```typescript
// OAuth-based integrations (Bitbucket, GitLab)
const client = new IntegrationClient(config);
await client.authenticate(oauthTokens);

// App-based integrations (GitHub)
const client = new GitHubApiClient(config);
await client.initialize();

// JIRA uses internal OAuth service
const client = new JiraApiClient(config);
// Authentication handled internally via JiraOAuthService
```

### Pagination

All list operations support consistent pagination with platform-specific adaptations:

```typescript
// JIRA pagination (zero-based)
const jiraResults = await jiraClient.searchIssues({
  jql: 'project = PROJ',
  startAt: 0,
  maxResults: 50
});

// GitHub/GitLab/Bitbucket pagination (page-based)
const githubResults = await githubClient.listPullRequests('owner', 'repo', {
  page: 1,
  per_page: 50
});
```

### Error Handling

All clients throw standardized error types with consistent interfaces:

```typescript
try {
  const data = await client.getData();
} catch (error) {
  if (error instanceof AuthenticationError) {
    // Handle authentication failure - refresh tokens
    await client.refreshAuthentication();
  } else if (error instanceof RateLimitError) {
    // Handle rate limiting - implement backoff
    const resetTime = error.resetTime;
    await delay(resetTime - Date.now());
  } else if (error instanceof ExternalServiceError) {
    // Handle API errors - log and potentially retry
    logger.error('API error:', error);
  }
}
```

### Rate Limiting

All clients implement rate limit monitoring with service-specific limits:

```typescript
// Check rate limit status
const rateLimit = client.getRateLimitInfo();
console.log(`${rateLimit.remaining}/${rateLimit.limit} requests remaining`);

// Different limits per service:
// - JIRA: 300 requests/minute (default)
// - GitHub: 5000 requests/hour (GitHub App)
// - Bitbucket: 1000 requests/hour
// - GitLab: 300 requests/minute
```

### Caching

All clients use Redis-based caching with appropriate TTL values:

```typescript
// Cache patterns:
// - Project/Repository metadata: 10-15 minutes
// - Issues/PRs/MRs: 1-5 minutes  
// - User profiles: 5 minutes
// - System metadata: 1 hour

// Cache keys follow pattern: {service}:{resource}:{identifier}
// Examples:
// - jira:project:PROJ-123
// - github:repo:owner/name
// - gitlab:mr:project-id/123
```

### Health Checks

All clients provide health check capabilities for monitoring:

```typescript
// Basic connectivity test
const isHealthy = await client.testConnection();

// Detailed health status
const health = await client.getHealthStatus();
console.log('Service health:', health);

// Common health check components:
// - Authentication validity
// - Rate limit status  
// - API connectivity
// - Response time metrics
```

---

## Error Handling

### Error Types

#### AuthenticationError

Thrown when authentication fails or tokens are invalid/expired.

```typescript
class AuthenticationError extends Error {
  constructor(message: string, service?: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}
```

**Common scenarios:**
- OAuth token expired or revoked
- Invalid API credentials
- Insufficient permissions for operation
- App installation removed or suspended

#### RateLimitError

Thrown when API rate limits are exceeded, includes reset timing information.

```typescript
class RateLimitError extends Error {
  constructor(message: string, resetTime?: number) {
    super(message);
    this.name = 'RateLimitError';
    this.resetTime = resetTime;
  }
}
```

**Properties:**
- `resetTime`: Timestamp when rate limit resets (milliseconds)

#### ExternalServiceError

Thrown for general API errors, network issues, and service unavailability.

```typescript
class ExternalServiceError extends Error {
  constructor(service: string, originalError: Error, statusCode?: number) {
    super(`${service} API error: ${originalError.message}`);
    this.name = 'ExternalServiceError';
    this.service = service;
    this.statusCode = statusCode;
  }
}
```

**Properties:**
- `service`: Name of the external service ('JIRA', 'GitHub', etc.)
- `statusCode`: HTTP status code if available
- `originalError`: Original error from the underlying API client

### Error Handling Best Practices

1. **Always handle authentication errors** by attempting token refresh
2. **Implement exponential backoff** for rate limit and temporary errors
3. **Use circuit breaker pattern** for resilience against service failures
4. **Log errors with context** for debugging and monitoring
5. **Provide meaningful error messages** to end users

### Example: Robust Error Handling

```typescript
async function robustApiOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  let attempt = 0;
  
  while (attempt < maxRetries) {
    try {
      return await operation();
    } catch (error) {
      attempt++;
      
      if (error instanceof AuthenticationError) {
        // Try to refresh authentication once
        if (attempt === 1) {
          await refreshAuthentication();
          continue;
        }
        throw error; // Give up after one refresh attempt
      }
      
      if (error instanceof RateLimitError) {
        // Wait for rate limit reset with exponential backoff
        const baseDelay = 1000 * Math.pow(2, attempt - 1);
        const resetDelay = error.resetTime ? error.resetTime - Date.now() : 0;
        const delay = Math.max(baseDelay, resetDelay);
        
        await new Promise(resolve => setTimeout(resolve, Math.min(delay, 60000)));
        continue;
      }
      
      if (error instanceof ExternalServiceError) {
        // Retry with exponential backoff for 5xx errors
        if (error.statusCode && error.statusCode >= 500 && attempt < maxRetries) {
          const delay = 1000 * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
      
      // Non-retryable error or max retries reached
      throw error;
    }
  }
  
  throw new Error(`Operation failed after ${maxRetries} attempts`);
}
```

This comprehensive API reference provides detailed information for integrating with all supported platforms while maintaining consistency and reliability across different services.