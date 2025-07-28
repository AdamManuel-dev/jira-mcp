# 🤝 Contributing Guide

Welcome to the **JIRA Sprint Intelligence Alert System (SIAS)** project! This guide provides everything you need to know to contribute effectively to the codebase.

## 📋 Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Standards](#code-standards)
- [Testing Guidelines](#testing-guidelines)
- [Pull Request Process](#pull-request-process)
- [Issue Guidelines](#issue-guidelines)
- [Documentation](#documentation)
- [Community Guidelines](#community-guidelines)

## 🚀 Getting Started

### Prerequisites

Before contributing, ensure you have:

- **Node.js 18+** installed
- **PostgreSQL 14+** running locally
- **Redis 6+** available
- **Git** configured with your identity
- **IDE** with TypeScript support (VS Code recommended)

### Initial Setup

1. **Fork the Repository**
   ```bash
   # Fork on GitHub, then clone your fork
   git clone https://github.com/YOUR_USERNAME/jira-sprint-intelligence.git
   cd jira-sprint-intelligence
   ```

2. **Add Upstream Remote**
   ```bash
   git remote add upstream https://github.com/original-org/jira-sprint-intelligence.git
   git remote -v
   ```

3. **Install Dependencies**
   ```bash
   npm install
   ```

4. **Setup Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your local configuration
   ```

5. **Initialize Database**
   ```bash
   npm run db:setup
   npm run db:migrate
   npm run db:seed:dev
   ```

6. **Verify Setup**
   ```bash
   npm run dev
   # Should start without errors
   npm test
   # All tests should pass
   ```

## 🔄 Development Workflow

### Branch Strategy

We use **GitHub Flow** with feature branches:

```bash
# Start from main
git checkout main
git pull upstream main

# Create feature branch
git checkout -b feature/alert-snooze-functionality

# Work on your feature...
git add .
git commit -m "feat(alerts): add snooze functionality with duration options"

# Push to your fork
git push origin feature/alert-snooze-functionality

# Create Pull Request on GitHub
```

### Branch Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feature/description` | `feature/github-integration` |
| Bug Fix | `fix/description` | `fix/webhook-signature-validation` |
| Hotfix | `hotfix/description` | `hotfix/critical-memory-leak` |
| Documentation | `docs/description` | `docs/api-reference-update` |
| Refactor | `refactor/description` | `refactor/alert-detection-engine` |
| Performance | `perf/description` | `perf/database-query-optimization` |

### Commit Message Format

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

**Types:**
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting, etc.)
- `refactor:` Code refactoring
- `perf:` Performance improvements
- `test:` Adding or modifying tests
- `chore:` Maintenance tasks

**Examples:**
```bash
feat(alerts): add snooze functionality with configurable duration

Allow users to snooze alerts for specified time periods.
Includes UI controls and background job processing.

Closes #123

fix(jira): handle rate limiting in webhook processing

Add exponential backoff and retry logic for JIRA API calls
when rate limits are exceeded.

Fixes #456

docs(api): update authentication examples

Add OAuth 2.0 flow examples and error handling patterns.
```

### Development Scripts

```bash
# Development server with hot reload
npm run dev

# Run tests
npm test                    # All tests
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests only
npm run test:watch        # Watch mode
npm run test:coverage     # With coverage report

# Code quality
npm run lint              # ESLint check
npm run lint:fix         # Auto-fix issues
npm run format           # Prettier formatting
npm run type-check       # TypeScript validation

# Database operations
npm run db:migrate       # Run migrations
npm run db:rollback     # Rollback migrations
npm run db:seed         # Seed test data
npm run db:reset        # Reset database

# Build and deployment
npm run build           # Production build
npm run start          # Start production server
```

## 📏 Code Standards

### TypeScript Guidelines

1. **Strict Type Safety**
   ```typescript
   // ✅ Good: Explicit types
   interface UserPreferences {
     theme: 'light' | 'dark';
     notifications: boolean;
     timezone: string;
   }

   const updatePreferences = (
     userId: string, 
     preferences: UserPreferences
   ): Promise<void> => {
     // Implementation
   };

   // ❌ Bad: Any types
   const updatePreferences = (userId: any, preferences: any): any => {
     // Implementation
   };
   ```

2. **Use Modern ES6+ Features**
   ```typescript
   // ✅ Good: Destructuring and async/await
   const { alerts, pagination } = await alertService.getAlerts({
     organizationId,
     status: 'active'
   });

   // ❌ Bad: Verbose syntax
   alertService.getAlerts({ organizationId, status: 'active' })
     .then(function(result) {
       const alerts = result.alerts;
       const pagination = result.pagination;
     });
   ```

3. **Proper Error Handling**
   ```typescript
   // ✅ Good: Specific error types
   try {
     await jiraClient.updateIssue(issueKey, updateData);
   } catch (error) {
     if (error instanceof AuthenticationError) {
       await refreshTokens();
       return retry();
     }
     
     if (error instanceof RateLimitError) {
       await delay(error.retryAfter);
       return retry();
     }
     
     throw error;
   }
   ```

### Code Organization

1. **File Structure**
   ```typescript
   // ✅ Good: Logical imports order
   // Node modules
   import express from 'express';
   import { Request, Response } from 'express';
   
   // Internal modules (alphabetical)
   import { AlertService } from '@/services/alert-service';
   import { logger } from '@/utils/logger';
   import { validateRequest } from '@/utils/validation';
   
   // Types
   import { CreateAlertRequest, AlertResponse } from '@/types/alerts';
   ```

2. **Function Size and Complexity**
   ```typescript
   // ✅ Good: Small, focused functions
   const createAlert = async (
     organizationId: string,
     alertData: CreateAlertRequest
   ): Promise<AlertResponse> => {
     validateAlertData(alertData);
     const alert = await alertService.create(organizationId, alertData);
     await notificationService.sendAlert(alert);
     return formatAlertResponse(alert);
   };

   // ❌ Bad: Large, complex functions
   const processAlert = async (data: any) => {
     // 100+ lines of mixed logic
   };
   ```

3. **Constants and Configuration**
   ```typescript
   // ✅ Good: Named constants
   const ALERT_SEVERITY_LEVELS = {
     LOW: 'low',
     MEDIUM: 'medium',
     HIGH: 'high',
     CRITICAL: 'critical'
   } as const;

   const DEFAULT_PAGINATION_LIMIT = 50;
   const MAX_PAGINATION_LIMIT = 200;

   // ❌ Bad: Magic numbers
   if (alerts.length > 50) {
     // What does 50 represent?
   }
   ```

### Documentation Standards

1. **JSDoc Comments**
   ```typescript
   /**
    * Creates a new alert rule for the specified organization
    * 
    * @param organizationId - The organization identifier
    * @param ruleData - Alert rule configuration
    * @returns Promise resolving to the created alert rule
    * @throws {ValidationError} When rule data is invalid
    * @throws {AuthorizationError} When user lacks permissions
    * 
    * @example
    * ```typescript
    * const rule = await createAlertRule('org_123', {
    *   alertType: 'missing_estimate',
    *   severity: 'medium',
    *   conditions: { projectKeys: ['PROJ'] }
    * });
    * ```
    */
   async createAlertRule(
     organizationId: string,
     ruleData: CreateAlertRuleRequest
   ): Promise<AlertRule> {
     // Implementation
   }
   ```

2. **File Headers**
   ```typescript
   /**
    * @fileoverview JIRA webhook event processing with queue-based reliability
    * @lastmodified 2025-07-28T05:57:35Z
    * 
    * Features: Event validation, signature verification, retry logic, dead letter queue
    * Main APIs: handleWebhookEvent(), processEvent(), validateSignature()
    * Constraints: Requires Redis for queue, HMAC-SHA256 for validation
    * Patterns: Queue-based processing, exponential backoff, event deduplication
    */
   ```

### Testing Standards

1. **Unit Test Structure**
   ```typescript
   describe('AlertDetectionService', () => {
     let alertService: AlertDetectionService;
     let mockJiraClient: jest.Mocked<JiraApiClient>;

     beforeEach(() => {
       mockJiraClient = createMockJiraClient();
       alertService = new AlertDetectionService(mockJiraClient);
     });

     describe('processIssueAlerts', () => {
       it('should create alert when missing estimate rule triggers', async () => {
         // Arrange
         const issue = createMockIssue({ 
           key: 'PROJ-123',
           fields: { 
             timeoriginalestimate: null,
             created: '2025-07-27T10:00:00Z'  // 2 days ago
           }
         });
         const rule = createMockRule({ 
           alertType: 'missing_estimate',
           thresholds: { estimateRequiredAfterHours: 24 }
         });

         // Act
         const alerts = await alertService.processIssueAlerts(
           'org_123', 
           issue, 
           'created'
         );

         // Assert
         expect(alerts).toHaveLength(1);
         expect(alerts[0].alertType).toBe('missing_estimate');
         expect(alerts[0].issueKey).toBe('PROJ-123');
       });

       it('should not create duplicate alerts for same issue and rule', async () => {
         // Test implementation
       });
     });
   });
   ```

2. **Integration Test Examples**
   ```typescript
   describe('JIRA Integration', () => {
     let app: Express;
     let testDb: TestDatabase;

     beforeAll(async () => {
       testDb = await setupTestDatabase();
       app = createTestApp(testDb);
     });

     afterAll(async () => {
       await teardownTestDatabase(testDb);
     });

     it('should process webhook events end-to-end', async () => {
       // Create test data
       const organization = await testDb.createOrganization();
       const integration = await testDb.createJiraIntegration(organization.id);

       // Send webhook
       const response = await request(app)
         .post(`/webhooks/jira/${integration.id}`)
         .set('X-Hub-Signature-256', generateSignature(webhookPayload))
         .send(webhookPayload)
         .expect(200);

       // Verify processing
       expect(response.body.queued).toBe(true);
       
       // Wait for async processing
       await waitForQueueProcessing();
       
       // Verify alert creation
       const alerts = await testDb.findAlerts({ issueKey: 'PROJ-123' });
       expect(alerts).toHaveLength(1);
     });
   });
   ```

## 🧪 Testing Guidelines

### Test Organization

```
tests/
├── unit/                 # Unit tests
│   ├── services/
│   ├── integrations/
│   └── utils/
├── integration/          # Integration tests
│   ├── api/
│   ├── database/
│   └── webhooks/
├── e2e/                 # End-to-end tests
└── fixtures/            # Test data and mocks
    ├── jira-payloads/
    └── mock-responses/
```

### Testing Best Practices

1. **Test Naming**
   ```typescript
   // ✅ Good: Descriptive test names
   it('should create missing estimate alert when issue lacks time estimate after 24 hours', () => {});
   it('should not trigger alert when issue has story points assigned', () => {});

   // ❌ Bad: Vague test names
   it('should work', () => {});
   it('test alert creation', () => {});
   ```

2. **Test Data Management**
   ```typescript
   // ✅ Good: Factory functions for test data
   const createMockIssue = (overrides: Partial<JiraIssue> = {}): JiraIssue => ({
     id: 'issue_123',
     key: 'PROJ-123',
     fields: {
       summary: 'Test issue',
       status: { name: 'To Do' },
       created: '2025-07-28T10:00:00Z',
       ...overrides.fields
     },
     ...overrides
   });

   // ❌ Bad: Hardcoded test data
   const issue = {
     id: 'issue_123',
     key: 'PROJ-123',
     // ... lots of hardcoded data
   };
   ```

3. **Async Testing**
   ```typescript
   // ✅ Good: Proper async handling
   it('should process webhook event asynchronously', async () => {
     const promise = webhookService.handleEvent(event);
     await expect(promise).resolves.toMatchObject({
       eventId: expect.any(String),
       queued: true
     });
   });

   // ❌ Bad: Missing await
   it('should process webhook event', () => {
     const result = webhookService.handleEvent(event);
     expect(result.queued).toBe(true); // This will fail
   });
   ```

### Coverage Requirements

- **Minimum Coverage**: 80% overall
- **Critical Paths**: 95% coverage for alert detection, authentication, data processing
- **New Features**: 90% coverage required
- **Bug Fixes**: Must include regression tests

```bash
# Check coverage
npm run test:coverage

# Coverage thresholds in jest.config.js
module.exports = {
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    },
    './src/services/alert-detection.ts': {
      branches: 95,
      functions: 95,
      lines: 95,
      statements: 95
    }
  }
};
```

## 📝 Pull Request Process

### Before Submitting

1. **Code Quality Checklist**
   ```bash
   # Run all checks
   npm run lint
   npm run type-check
   npm run test
   npm run test:integration
   
   # Verify build
   npm run build
   ```

2. **Update Documentation**
   - Update API documentation for new endpoints
   - Add/update JSDoc comments for new functions
   - Update README if adding new features
   - Include code examples for complex changes

3. **Test Your Changes**
   - Add unit tests for new functionality
   - Add integration tests for API changes
   - Verify existing tests still pass
   - Test edge cases and error scenarios

### PR Template

When creating a PR, use this template:

```markdown
## Description
Brief description of changes and motivation.

## Type of Change
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update

## Changes Made
- Detailed list of changes
- Include any breaking changes
- Mention new dependencies

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing completed
- [ ] All existing tests pass

## Screenshots (if applicable)
Include screenshots for UI changes.

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] Tests added/updated
- [ ] No console.log statements
- [ ] Environment variables documented
```

### Review Process

1. **Automated Checks**
   - All CI checks must pass
   - Code coverage must meet thresholds
   - No merge conflicts
   - Branch is up to date with main

2. **Manual Review**
   - At least 2 reviewer approvals required
   - Reviewers check code quality, logic, and tests
   - Security review for authentication/authorization changes
   - Performance review for database/API changes

3. **Merge Requirements**
   - All conversations resolved
   - Automated checks passing
   - Required approvals received
   - Documentation updated

## 🐛 Issue Guidelines

### Bug Reports

Use the bug report template:

```markdown
**Bug Description**
Clear description of the bug.

**Steps to Reproduce**
1. Go to '...'
2. Click on '....'
3. Scroll down to '....'
4. See error

**Expected Behavior**
What you expected to happen.

**Actual Behavior**
What actually happened.

**Environment**
- OS: [e.g. macOS 13.5]
- Node.js version: [e.g. 18.17.0]
- Browser: [e.g. Chrome 115]
- SIAS version: [e.g. 1.2.3]

**Additional Context**
- Error logs
- Screenshots
- Related issues
```

### Feature Requests

Use the feature request template:

```markdown
**Feature Summary**
Brief description of the proposed feature.

**Problem Statement**
What problem does this solve?

**Proposed Solution**
Detailed description of the solution.

**Alternatives Considered**
Other solutions you've considered.

**Additional Context**
- Use cases
- Screenshots/mockups
- Implementation ideas
```

### Issue Labels

| Label | Description |
|-------|-------------|
| `bug` | Something isn't working |
| `enhancement` | New feature or request |
| `documentation` | Improvements to documentation |
| `good first issue` | Good for newcomers |
| `help wanted` | Extra attention is needed |
| `priority: high` | High priority issue |
| `priority: low` | Low priority issue |
| `area: api` | API related |
| `area: frontend` | Frontend related |
| `area: database` | Database related |
| `area: integration` | Integration related |

## 📚 Documentation

### Documentation Types

1. **Code Documentation**
   - JSDoc comments for all public functions
   - Inline comments for complex logic
   - README files for modules

2. **API Documentation**
   - OpenAPI/Swagger specifications
   - Request/response examples
   - Error code documentation

3. **User Documentation**
   - Setup and installation guides
   - Configuration documentation
   - Troubleshooting guides

### Writing Guidelines

1. **Be Clear and Concise**
   ```markdown
   <!-- ✅ Good -->
   ## Authentication
   
   SIAS uses JWT tokens for authentication. Include the token in the Authorization header:
   
   ```http
   Authorization: Bearer your-jwt-token
   ```
   
   <!-- ❌ Bad -->
   ## Auth Stuff
   
   You need to auth somehow. Use tokens or whatever.
   ```

2. **Include Examples**
   ```markdown
   <!-- ✅ Good -->
   ### Creating an Alert Rule
   
   ```typescript
   const rule = await alertService.createRule({
     alertType: 'missing_estimate',
     severity: 'medium',
     conditions: {
       projectKeys: ['PROJ'],
       issueTypes: ['Story']
     },
     thresholds: {
       estimateRequiredAfterHours: 24
     }
   });
   ```
   ```

3. **Keep Documentation Updated**
   - Update docs when changing APIs
   - Review docs during PR reviews
   - Use automated doc generation where possible

## 🌟 Community Guidelines

### Code of Conduct

We are committed to providing a welcoming and inclusive experience for everyone. Please:

- **Be respectful** in all interactions
- **Be collaborative** and help others learn
- **Be patient** with newcomers and different skill levels
- **Be constructive** in feedback and criticism

### Getting Help

- **Discord**: Join our developer community
- **GitHub Discussions**: Ask questions and share ideas
- **GitHub Issues**: Report bugs and request features
- **Documentation**: Check the docs first

### Recognition

We recognize contributors through:

- **Contributor list** in README
- **Release notes** mentioning contributors
- **Special badges** for significant contributions
- **Annual contributor awards**

---

Thank you for contributing to SIAS! Your efforts help make sprint intelligence better for development teams everywhere. 🚀