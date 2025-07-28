/**
 * @fileoverview GraphQL schema definition for SIAS API
 * @lastmodified 2025-07-28T00:00:00Z
 * 
 * Features: Complete GraphQL schema with queries, mutations, subscriptions for all SIAS entities
 * Main APIs: Type definitions, query/mutation/subscription schemas, input/output types
 * Constraints: Follows GraphQL best practices, includes proper authentication/authorization
 * Patterns: Schema-first approach, nested resolvers, subscription-based real-time updates
 */

import { gql } from 'apollo-server-express';

export const typeDefs = gql`
  # Scalars
  scalar DateTime
  scalar JSON

  # Enums
  enum AlertType {
    MISSING_ESTIMATE
    TIME_TRACKING_MISSING
    DEVELOPMENT_ARTIFACTS_MISSING
    SPRINT_DEADLINE_RISK
    RESPONSE_TIME_VIOLATION
    EARLY_COMPLETION_OPPORTUNITY
  }

  enum AlertSeverity {
    LOW
    MEDIUM
    HIGH
    CRITICAL
  }

  enum AlertStatus {
    ACTIVE
    ACKNOWLEDGED
    RESOLVED
    DISMISSED
  }

  enum SprintStatus {
    PLANNING
    ACTIVE
    COMPLETED
    CANCELLED
  }

  enum UserRole {
    ADMIN
    TEAM_LEAD
    DEVELOPER
    STAKEHOLDER
  }

  enum IntegrationType {
    JIRA_CLOUD
    JIRA_SERVER
    GITHUB
    GITLAB
    BITBUCKET
  }

  # Core Types
  type User {
    id: ID!
    email: String!
    name: String!
    role: UserRole!
    organizationId: ID!
    preferences: UserPreferences
    teams: [Team!]!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type Organization {
    id: ID!
    name: String!
    domain: String
    settings: OrganizationSettings
    users: [User!]!
    teams: [Team!]!
    integrations: [Integration!]!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type Team {
    id: ID!
    name: String!
    organizationId: ID!
    members: [User!]!
    sprints: [Sprint!]!
    config: TeamConfig
    analytics: TeamAnalytics
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type Sprint {
    id: ID!
    name: String!
    teamId: ID!
    jiraSprintId: String
    startDate: DateTime!
    endDate: DateTime!
    status: SprintStatus!
    tasks: [Task!]!
    alerts: [Alert!]!
    health: SprintHealth
    analytics: SprintAnalytics
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type Task {
    id: ID!
    jiraTicketId: String!
    summary: String!
    description: String
    sprintId: ID
    assigneeId: ID
    status: String!
    priority: String!
    estimate: Float
    timeSpent: Float
    remainingWork: Float
    artifacts: [DevelopmentArtifact!]!
    alerts: [Alert!]!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type Alert {
    id: ID!
    type: AlertType!
    severity: AlertSeverity!
    status: AlertStatus!
    title: String!
    message: String!
    context: JSON
    sprintId: ID
    taskId: ID
    triggeredAt: DateTime!
    acknowledgedAt: DateTime
    acknowledgedBy: ID
    resolvedAt: DateTime
    visualization: AlertVisualization
  }

  type DevelopmentArtifact {
    id: ID!
    taskId: ID!
    type: String! # commit, pull_request, branch, deployment
    externalId: String!
    title: String!
    url: String
    status: String!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type Integration {
    id: ID!
    organizationId: ID!
    type: IntegrationType!
    name: String!
    config: JSON!
    status: String!
    lastSyncAt: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type Notification {
    id: ID!
    userId: ID!
    type: String!
    title: String!
    message: String!
    data: JSON
    isRead: Boolean!
    createdAt: DateTime!
    readAt: DateTime
  }

  # Nested Types
  type UserPreferences {
    notifications: NotificationPreferences!
    dashboard: DashboardPreferences!
    timezone: String!
  }

  type NotificationPreferences {
    email: Boolean!
    slack: Boolean!
    push: Boolean!
    digest: DigestPreferences!
    alertTypes: [AlertType!]!
    channels: [String!]!
  }

  type DigestPreferences {
    enabled: Boolean!
    frequency: String! # daily, weekly
    time: String! # HH:MM format
  }

  type DashboardPreferences {
    layout: JSON!
    widgets: [String!]!
    refreshInterval: Int!
  }

  type OrganizationSettings {
    timezone: String!
    workingHours: WorkingHours!
    holidays: [String!]!
    alertThresholds: AlertThresholds!
  }

  type WorkingHours {
    start: String! # HH:MM format
    end: String! # HH:MM format
    days: [Int!]! # 0-6, Sunday-Saturday
  }

  type AlertThresholds {
    missingEstimate: ThresholdConfig!
    timeTracking: ThresholdConfig!
    responseTime: ThresholdConfig!
    sprintDeadline: ThresholdConfig!
  }

  type ThresholdConfig {
    enabled: Boolean!
    warning: Float!
    critical: Float!
    unit: String!
  }

  type TeamConfig {
    estimationField: String!
    timeTrackingRequired: Boolean!
    responseTimeThreshold: Int! # in hours
    workingHours: WorkingHours!
    alertSettings: TeamAlertSettings!
  }

  type TeamAlertSettings {
    enabledTypes: [AlertType!]!
    channels: [String!]!
    escalationPolicy: EscalationPolicy!
  }

  type EscalationPolicy {
    enabled: Boolean!
    levels: [EscalationLevel!]!
  }

  type EscalationLevel {
    delayMinutes: Int!
    recipients: [ID!]!
    channels: [String!]!
  }

  type SprintHealth {
    score: Float! # 0-100
    risks: [RiskFactor!]!
    recommendations: [String!]!
    trend: String! # improving, stable, declining
    lastCalculated: DateTime!
  }

  type RiskFactor {
    type: String!
    severity: AlertSeverity!
    impact: Float! # 0-1
    description: String!
    mitigation: String
  }

  type SprintAnalytics {
    velocity: VelocityMetrics!
    completion: CompletionMetrics!
    quality: QualityMetrics!
    collaboration: CollaborationMetrics!
  }

  type VelocityMetrics {
    current: Float!
    average: Float!
    trend: Float! # percentage change
    predictedCompletion: DateTime
  }

  type CompletionMetrics {
    completed: Int!
    inProgress: Int!
    todo: Int!
    percentage: Float!
  }

  type QualityMetrics {
    artifactCoverage: Float! # percentage
    timeTrackingCompliance: Float! # percentage
    responseTimeAverage: Float! # hours
  }

  type CollaborationMetrics {
    mentions: Int!
    comments: Int!
    averageResponseTime: Float! # hours
  }

  type TeamAnalytics {
    velocity: [VelocityDataPoint!]!
    capacity: CapacityMetrics!
    performance: PerformanceMetrics!
    trends: TrendMetrics!
  }

  type VelocityDataPoint {
    sprintId: ID!
    value: Float!
    date: DateTime!
  }

  type CapacityMetrics {
    totalHours: Float!
    availableHours: Float!
    utilization: Float! # percentage
  }

  type PerformanceMetrics {
    averageVelocity: Float!
    consistencyScore: Float! # 0-100
    qualityScore: Float! # 0-100
  }

  type TrendMetrics {
    velocity: String! # improving, stable, declining
    quality: String!
    efficiency: String!
  }

  type AlertVisualization {
    chartType: String!
    data: JSON!
    config: JSON!
  }

  # Input Types
  input CreateUserInput {
    email: String!
    name: String!
    role: UserRole!
    organizationId: ID!
  }

  input UpdateUserInput {
    name: String
    role: UserRole
  }

  input UserPreferencesInput {
    notifications: NotificationPreferencesInput
    dashboard: DashboardPreferencesInput
    timezone: String
  }

  input NotificationPreferencesInput {
    email: Boolean
    slack: Boolean
    push: Boolean
    digest: DigestPreferencesInput
    alertTypes: [AlertType!]
    channels: [String!]
  }

  input DigestPreferencesInput {
    enabled: Boolean
    frequency: String
    time: String
  }

  input DashboardPreferencesInput {
    layout: JSON
    widgets: [String!]
    refreshInterval: Int
  }

  input CreateTeamInput {
    name: String!
    organizationId: ID!
    memberIds: [ID!]
  }

  input UpdateTeamInput {
    name: String
    memberIds: [ID!]
  }

  input TeamConfigInput {
    estimationField: String
    timeTrackingRequired: Boolean
    responseTimeThreshold: Int
    workingHours: WorkingHoursInput
    alertSettings: TeamAlertSettingsInput
  }

  input WorkingHoursInput {
    start: String
    end: String
    days: [Int!]
  }

  input TeamAlertSettingsInput {
    enabledTypes: [AlertType!]
    channels: [String!]
    escalationPolicy: EscalationPolicyInput
  }

  input EscalationPolicyInput {
    enabled: Boolean
    levels: [EscalationLevelInput!]
  }

  input EscalationLevelInput {
    delayMinutes: Int!
    recipients: [ID!]!
    channels: [String!]!
  }

  input CreateIntegrationInput {
    organizationId: ID!
    type: IntegrationType!
    name: String!
    config: JSON!
  }

  input UpdateIntegrationInput {
    name: String
    config: JSON
  }

  input AlertFilter {
    types: [AlertType!]
    severities: [AlertSeverity!]
    statuses: [AlertStatus!]
    sprintIds: [ID!]
    taskIds: [ID!]
    dateRange: DateRangeInput
  }

  input DateRangeInput {
    start: DateTime!
    end: DateTime!
  }

  input AcknowledgeAlertInput {
    alertId: ID!
    comment: String
  }

  input AnalyticsQueryInput {
    entityType: String! # sprint, team, organization
    entityId: ID!
    metrics: [String!]!
    dateRange: DateRangeInput!
    groupBy: String # day, week, month
  }

  # Queries
  type Query {
    # User queries
    me: User
    user(id: ID!): User
    users(organizationId: ID): [User!]!

    # Organization queries
    organization(id: ID!): Organization
    organizations: [Organization!]!

    # Team queries
    team(id: ID!): Team
    teams(organizationId: ID): [Team!]!
    myTeams: [Team!]!

    # Sprint queries
    sprint(id: ID!): Sprint
    sprints(teamId: ID, status: SprintStatus): [Sprint!]!
    activeSprints(teamId: ID): [Sprint!]!

    # Task queries
    task(id: ID!): Task
    tasks(sprintId: ID, assigneeId: ID): [Task!]!
    myTasks: [Task!]!

    # Alert queries
    alert(id: ID!): Alert
    alerts(filter: AlertFilter): [Alert!]!
    myAlerts: [Alert!]!
    sprintAlerts(sprintId: ID!): [Alert!]!

    # Integration queries
    integration(id: ID!): Integration
    integrations(organizationId: ID, type: IntegrationType): [Integration!]!

    # Notification queries
    notifications(limit: Int = 50): [Notification!]!
    unreadNotifications: [Notification!]!

    # Analytics queries
    analytics(query: AnalyticsQueryInput!): JSON!
    dashboardData(teamId: ID): JSON!
    sprintHealth(sprintId: ID!): SprintHealth!
  }

  # Mutations
  type Mutation {
    # User mutations
    createUser(input: CreateUserInput!): User!
    updateUser(id: ID!, input: UpdateUserInput!): User!
    updateMyProfile(input: UpdateUserInput!): User!
    updateMyPreferences(input: UserPreferencesInput!): User!
    deleteUser(id: ID!): Boolean!

    # Team mutations
    createTeam(input: CreateTeamInput!): Team!
    updateTeam(id: ID!, input: UpdateTeamInput!): Team!
    updateTeamConfig(id: ID!, input: TeamConfigInput!): Team!
    deleteTeam(id: ID!): Boolean!
    addTeamMember(teamId: ID!, userId: ID!): Team!
    removeTeamMember(teamId: ID!, userId: ID!): Team!

    # Integration mutations
    createIntegration(input: CreateIntegrationInput!): Integration!
    updateIntegration(id: ID!, input: UpdateIntegrationInput!): Integration!
    deleteIntegration(id: ID!): Boolean!
    testIntegration(id: ID!): Boolean!
    syncIntegration(id: ID!): Boolean!

    # Alert mutations
    acknowledgeAlert(input: AcknowledgeAlertInput!): Alert!
    acknowledgeAlerts(alertIds: [ID!]!, comment: String): [Alert!]!
    resolveAlert(alertId: ID!, comment: String): Alert!
    dismissAlert(alertId: ID!, comment: String): Alert!

    # Notification mutations
    markNotificationRead(id: ID!): Notification!
    markAllNotificationsRead: Boolean!
    deleteNotification(id: ID!): Boolean!

    # System mutations
    triggerSync(integrationType: IntegrationType, organizationId: ID): Boolean!
    recalculateAlerts(sprintId: ID): Boolean!
  }

  # Subscriptions
  type Subscription {
    # Alert subscriptions
    alertCreated(teamId: ID): Alert!
    alertUpdated(alertId: ID): Alert!
    alertsUpdated(teamId: ID): [Alert!]!

    # Sprint subscriptions
    sprintUpdated(sprintId: ID!): Sprint!
    sprintHealthUpdated(sprintId: ID!): SprintHealth!

    # Task subscriptions
    taskUpdated(taskId: ID!): Task!
    tasksUpdated(sprintId: ID!): [Task!]!

    # Notification subscriptions
    notificationReceived: Notification!

    # Dashboard subscriptions
    dashboardDataUpdated(teamId: ID): JSON!
  }
`;