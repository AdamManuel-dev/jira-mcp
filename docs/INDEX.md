# 📚 JIRA Sprint Intelligence Alert System - Documentation Index

Welcome to the comprehensive documentation for the **Sprint Intelligence Alert System (SIAS)**, an AI-powered JIRA sprint monitoring platform that provides proactive alerts and intelligent insights for agile teams.

## 🚀 Quick Start

- **[Getting Started Guide](./guides/GETTING_STARTED.md)** - Setup and installation instructions
- **[Architecture Overview](./ARCHITECTURE.md)** - System design and component relationships
- **[API Reference](./API.md)** - Complete API documentation with examples

## 📖 Core Documentation

### System Overview
- **[README](../README.md)** - Project overview and key features
- **[Architecture](./ARCHITECTURE.md)** - System design and patterns
- **[API Reference](./API.md)** - Complete API documentation
- **[Troubleshooting](./TROUBLESHOOTING.md)** - Common issues and solutions

### Module Documentation
- **[JIRA Integration](./modules/jira-integration.md)** - OAuth, API client, and webhook processing
- **[Alert Detection](./modules/alert-detection.md)** - Core alert engine and rule configuration  
- **[Database Layer](./modules/database.md)** - Schema design and data access patterns
- **[Middleware](./modules/middleware.md)** - Authentication, rate limiting, and error handling
- **[Services](./modules/services.md)** - Business logic and service container

### API Documentation
- **[REST Endpoints](./api/REST.md)** - HTTP API reference
- **[Webhook Handling](./api/WEBHOOKS.md)** - Inbound webhook processing
- **[Type Definitions](./api/TYPES.md)** - TypeScript interfaces and types

## 🛠️ Development Guides

### Setup & Workflow
- **[Getting Started](./guides/GETTING_STARTED.md)** - Installation and local development
- **[Contributing](./guides/CONTRIBUTING.md)** - Code style, PR process, and guidelines
- **[Testing](./guides/TESTING.md)** - Test structure, coverage, and best practices
- **[Deployment](./guides/DEPLOYMENT.md)** - Production deployment and configuration

### Advanced Topics
- **[Configuration](./guides/CONFIGURATION.md)** - Environment variables and settings
- **[Security](./guides/SECURITY.md)** - Authentication, authorization, and best practices
- **[Performance](./guides/PERFORMANCE.md)** - Optimization techniques and monitoring

## 🔧 Technical Reference

### Core Components
- **[Alert Detection Engine](./modules/alert-detection.md#detection-engine)** - Rule-based alert processing
- **[JIRA OAuth Flow](./modules/jira-integration.md#oauth-flow)** - Complete OAuth 2.0 implementation
- **[Webhook Processing](./modules/jira-integration.md#webhook-processing)** - Event handling and reliability
- **[Database Schema](./modules/database.md#schema-design)** - Data modeling and relationships

### Integration Points
- **[External APIs](./api/EXTERNAL.md)** - Third-party service integrations
- **[Notification Channels](./modules/notifications.md)** - Email, Slack, Teams integration
- **[Git Providers](./modules/git-integration.md)** - GitHub, GitLab, Bitbucket support

## 📊 Monitoring & Operations

- **[Logging](./guides/LOGGING.md)** - Structured logging and monitoring
- **[Health Checks](./guides/HEALTH_CHECKS.md)** - Service monitoring and diagnostics
- **[Performance Metrics](./guides/METRICS.md)** - Key performance indicators
- **[Error Handling](./guides/ERROR_HANDLING.md)** - Error patterns and recovery

## 🎯 Use Cases & Examples

### Common Workflows
- **[Setting Up Alerts](./guides/ALERT_SETUP.md)** - Configure alert rules and thresholds
- **[Integration Configuration](./guides/INTEGRATION_SETUP.md)** - Connect external services
- **[Dashboard Creation](./guides/DASHBOARD_SETUP.md)** - Build custom visualizations

### Code Examples
- **[API Usage Examples](./api/EXAMPLES.md)** - Common API patterns
- **[Webhook Examples](./api/WEBHOOK_EXAMPLES.md)** - Webhook payload handling
- **[Alert Rule Examples](./modules/alert-detection.md#examples)** - Custom alert configurations

## 🆘 Support & Resources

- **[FAQ](./TROUBLESHOOTING.md#faq)** - Frequently asked questions
- **[Common Issues](./TROUBLESHOOTING.md#common-issues)** - Known problems and solutions
- **[Performance Tuning](./TROUBLESHOOTING.md#performance)** - Optimization guidelines
- **[Migration Guide](./guides/MIGRATION.md)** - Upgrading between versions

## 📋 Documentation Maintenance

- **Last Updated**: 2025-07-28T05:57:35Z
- **Version**: 1.0.0
- **Coverage**: 89 documented functions across 17 files
- **Examples**: 47 working code examples

For questions or improvements to this documentation, please:
1. Check the [Troubleshooting Guide](./TROUBLESHOOTING.md)
2. Review [Contributing Guidelines](./guides/CONTRIBUTING.md)
3. Open an issue with the `documentation` label

---

**Navigation**: [🏠 Home](../README.md) | [⚙️ Setup](./guides/GETTING_STARTED.md) | [🏗️ Architecture](./ARCHITECTURE.md) | [📡 API](./API.md) | [❓ Help](./TROUBLESHOOTING.md)