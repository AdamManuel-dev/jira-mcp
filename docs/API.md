# 📡 API Reference

Complete API documentation for the **JIRA Sprint Intelligence Alert System (SIAS)**. This document covers all REST endpoints, webhooks, authentication, and data models.

## 📋 Table of Contents

- [Authentication](#authentication)
- [Base URLs & Versioning](#base-urls--versioning)
- [Error Handling](#error-handling)
- [Rate Limiting](#rate-limiting)
- [Core Endpoints](#core-endpoints)
- [Webhook Endpoints](#webhook-endpoints)
- [Data Models](#data-models)

## 🔐 Authentication

SIAS uses JWT-based authentication with refresh tokens for secure API access.

### Authentication Flow

```javascript
// 1. Login and get tokens
const response = await fetch('/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'secure_password'
  })
});

const { accessToken, refreshToken } = await response.json();

// 2. Use access token for API calls
const apiResponse = await fetch('/api/v1/alerts', {
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  }
});

// 3. Refresh token when needed
const refreshResponse = await fetch('/api/v1/auth/refresh', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ refreshToken })
});
```

### Authentication Headers

| Header | Value | Required | Description |
|--------|-------|----------|-------------|
| `Authorization` | `Bearer <token>` | Yes | JWT access token |
| `Content-Type` | `application/json` | Yes | Request content type |
| `X-Organization-ID` | `<org_id>` | Yes* | Organization context |

*Required for organization-scoped endpoints

## 🌐 Base URLs & Versioning

### Environment URLs
- **Development**: `http://localhost:3000`
- **Staging**: `https://staging-api.sias.example.com`
- **Production**: `https://api.sias.example.com`

### API Versioning
All endpoints are versioned with `/api/v1` prefix:
```
https://api.sias.example.com/api/v1/{endpoint}
```

## ❌ Error Handling

SIAS uses consistent error response format across all endpoints:

```typescript
interface ErrorResponse {
  error: {
    code: string;           // Machine-readable error code
    message: string;        // Human-readable error message
    details?: any;          // Additional error context
    timestamp: string;      // ISO 8601 timestamp
    requestId: string;      // Request correlation ID
  };
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `INVALID_TOKEN` | 401 | Invalid or expired access token |
| `INSUFFICIENT_PERMISSIONS` | 403 | User lacks required permissions |
| `RESOURCE_NOT_FOUND` | 404 | Requested resource doesn't exist |
| `VALIDATION_ERROR` | 400 | Request validation failed |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |

### Example Error Response

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid alert rule configuration",
    "details": {
      "field": "thresholds.estimateRequiredAfterHours",
      "value": -1,
      "constraint": "Must be a positive number"
    },
    "timestamp": "2025-07-28T05:57:35Z",
    "requestId": "req_abc123def456"
  }
}
```

## 🚦 Rate Limiting

API requests are rate limited to ensure system stability:

### Rate Limits by Endpoint Type

| Endpoint Type | Limit | Window | Headers |
|---------------|-------|--------|---------|
| Authentication | 10 req/min | Per IP | `X-RateLimit-*` |
| Read Operations | 1000 req/hour | Per user | `X-RateLimit-*` |
| Write Operations | 100 req/hour | Per user | `X-RateLimit-*` |
| Webhook Processing | 10000 req/hour | Per integration | `X-RateLimit-*` |

### Rate Limit Headers

```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1690537055
X-RateLimit-Window: 3600
```

## 🎯 Core Endpoints

### Authentication Endpoints

#### `POST /api/v1/auth/login`
Authenticate user and receive access tokens.

**Request Body:**
```typescript
{
  email: string;          // User email address
  password: string;       // User password
  organizationId?: string; // Optional organization ID
}
```

**Response:**
```typescript
{
  user: {
    id: string;
    email: string;
    name: string;
    organizationId: string;
    role: string;
  };
  tokens: {
    accessToken: string;    // JWT access token (1 hour)
    refreshToken: string;   // Refresh token (30 days)
    expiresIn: number;      // Token expiration in seconds
  };
}
```

#### `POST /api/v1/auth/refresh`
Refresh expired access token.

**Request Body:**
```typescript
{
  refreshToken: string;   // Valid refresh token
}
```

**Response:**
```typescript
{
  accessToken: string;    // New JWT access token
  expiresIn: number;      // Token expiration in seconds
}
```

### Organization Management

#### `GET /api/v1/organizations`
List user's organizations.

**Response:**
```typescript
{
  organizations: Array<{
    id: string;
    name: string;
    slug: string;
    role: 'admin' | 'member' | 'viewer';
    settings: {
      timezone: string;
      workingHours: {
        start: string;      // HH:mm format
        end: string;        // HH:mm format
      };
      workingDays: number[]; // 0-6, Sunday=0
    };
  }>;
}
```

#### `POST /api/v1/organizations`
Create new organization.

**Request Body:**
```typescript
{
  name: string;           // Organization name
  slug: string;           // URL-friendly identifier
  settings?: {
    timezone?: string;
    workingHours?: {
      start: string;
      end: string;
    };
    workingDays?: number[];
  };
}
```

### Integration Management

#### `GET /api/v1/integrations`
List organization's integrations.

**Query Parameters:**
- `provider` (optional): Filter by provider (`jira`, `github`, `gitlab`)
- `status` (optional): Filter by status (`active`, `inactive`, `error`)

**Response:**
```typescript
{
  integrations: Array<{
    id: string;
    provider: string;
    name: string;
    status: 'active' | 'inactive' | 'error';
    config: {
      instanceUrl?: string;
      apiVersion?: string;
      lastSyncAt?: string;
    };
    createdAt: string;
    updatedAt: string;
  }>;
}
```

#### `POST /api/v1/integrations/jira/setup`
Initialize JIRA integration setup.

**Request Body:**
```typescript
{
  name: string;           // Integration name
  redirectUrl?: string;   // OAuth redirect URL
}
```

**Response:**
```typescript
{
  authUrl: string;        // OAuth authorization URL
  state: string;          // OAuth state parameter
  integrationId: string;  // Integration ID for completion
}
```

#### `POST /api/v1/integrations/jira/complete`
Complete JIRA OAuth flow.

**Request Body:**
```typescript
{
  code: string;           // OAuth authorization code
  state: string;          // OAuth state parameter
}
```

**Response:**
```typescript
{
  integration: {
    id: string;
    name: string;
    status: 'active';
    instances: Array<{
      id: string;
      name: string;
      url: string;
      deploymentType: 'Cloud' | 'Server';
    }>;
  };
}
```

### Alert Management

#### `GET /api/v1/alerts`
List organization's alerts.

**Query Parameters:**
- `status` (optional): Filter by status (`active`, `acknowledged`, `resolved`)
- `severity` (optional): Filter by severity (`critical`, `high`, `medium`, `low`)
- `assignee` (optional): Filter by assignee ID
- `project` (optional): Filter by project key
- `limit` (optional): Number of results (default: 50, max: 200)
- `offset` (optional): Pagination offset (default: 0)

**Response:**
```typescript
{
  alerts: Array<{
    id: string;
    type: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    title: string;
    description: string;
    status: 'active' | 'acknowledged' | 'resolved';
    issueKey: string;
    projectKey: string;
    assignee?: {
      id: string;
      name: string;
      email: string;
    };
    metadata: {
      issueData: object;
      sprintData?: object;
      contextData: object;
    };
    detectedAt: string;
    acknowledgedAt?: string;
    resolvedAt?: string;
  }>;
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}
```

#### `POST /api/v1/alerts/{alertId}/acknowledge`
Acknowledge an alert.

**Request Body:**
```typescript
{
  note?: string;          // Optional acknowledgment note
}
```

**Response:**
```typescript
{
  alert: {
    id: string;
    status: 'acknowledged';
    acknowledgedAt: string;
    acknowledgedBy: {
      id: string;
      name: string;
    };
  };
}
```

### Alert Rules Management

#### `GET /api/v1/alert-rules`
List organization's alert rules.

**Response:**
```typescript
{
  rules: Array<{
    id: string;
    alertType: string;
    isEnabled: boolean;
    severity: string;
    conditions: {
      projectKeys?: string[];
      issueTypes?: string[];
      statuses?: string[];
    };
    thresholds: {
      estimateRequiredAfterHours?: number;
      timeTrackingRequiredAfterHours?: number;
      // ... other thresholds
    };
    notificationSettings: {
      channels: string[];
      frequency: string;
    };
  }>;
}
```

#### `POST /api/v1/alert-rules`
Create new alert rule.

**Request Body:**
```typescript
{
  alertType: string;      // Alert type identifier
  severity: 'critical' | 'high' | 'medium' | 'low';
  conditions: {
    projectKeys?: string[];
    issueTypes?: string[];
    statuses?: string[];
    assigneeIds?: string[];
  };
  thresholds: {
    [key: string]: number; // Threshold values
  };
  filters: {
    excludeStatuses?: string[];
    includeOnlyAssigned?: boolean;
  };
  notificationSettings: {
    channels: Array<'email' | 'slack' | 'teams'>;
    frequency: 'immediate' | 'hourly' | 'daily';
  };
}
```

## 🪝 Webhook Endpoints

### JIRA Webhook Processing

#### `POST /webhooks/jira/{integrationId}`
Process incoming JIRA webhook events.

**Headers:**
- `X-Atlassian-Webhook-Identifier`: Unique event identifier
- `X-Hub-Signature-256`: HMAC-SHA256 signature

**Request Body:** JIRA webhook payload (varies by event type)

**Response:**
```typescript
{
  eventId: string;        // Internal event ID
  queued: boolean;        // Whether event was queued
  status: 'processed' | 'queued' | 'duplicate';
}
```

### Generic Webhook Endpoint

#### `POST /webhooks/{provider}/{integrationId}`
Generic webhook endpoint for other providers.

**Headers:**
- Provider-specific signature headers
- `Content-Type`: `application/json`

## 📊 Data Models

### Alert Model

```typescript
interface Alert {
  id: string;
  organizationId: string;
  ruleId: string;
  alertType: 'missing_estimate' | 'missing_time_tracking' | /* ... */;
  severity: 'critical' | 'high' | 'medium' | 'low';
  issueKey: string;
  issueId: string;
  title: string;
  description: string;
  metadata: AlertMetadata;
  assigneeId?: string;
  projectKey: string;
  sprintId?: string;
  status: 'active' | 'acknowledged' | 'resolved' | 'suppressed';
  detectedAt: Date;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  resolvedAt?: Date;
  suppressedUntil?: Date;
}
```

### Alert Rule Model

```typescript
interface AlertRule {
  id: string;
  organizationId: string;
  alertType: string;
  isEnabled: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  conditions: AlertConditions;
  thresholds: AlertThresholds;
  filters: AlertFilters;
  notificationSettings: NotificationSettings;
  createdAt: Date;
  updatedAt: Date;
}
```

### Integration Model

```typescript
interface Integration {
  id: string;
  organizationId: string;
  provider: 'jira' | 'github' | 'gitlab' | 'bitbucket';
  name: string;
  config: {
    instanceId?: string;
    baseUrl?: string;
    apiVersion?: string;
    settings: Record<string, any>;
  };
  credentials: {
    // Encrypted credential storage
  };
  isActive: boolean;
  lastSyncAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

## 📈 Health & Monitoring

### Health Check Endpoint

#### `GET /health`
Application health status.

**Response:**
```typescript
{
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;         // Seconds since startup
  version: string;        // Application version
  services: {
    database: 'connected' | 'disconnected';
    redis: 'connected' | 'disconnected';
    queue: 'operational' | 'degraded';
  };
  metrics: {
    activeAlerts: number;
    processedEvents: number;
    queuedJobs: number;
  };
}
```

### Metrics Endpoint

#### `GET /metrics`
Prometheus-compatible metrics.

Returns metrics in Prometheus format for monitoring integration.

---

**Related Documentation**:
- [Getting Started](./guides/GETTING_STARTED.md) - Setup and authentication
- [Alert Detection Guide](./modules/alert-detection.md) - Alert rule configuration
- [JIRA Integration](./modules/jira-integration.md) - JIRA setup and configuration
- [Webhook Reference](./api/WEBHOOKS.md) - Detailed webhook documentation