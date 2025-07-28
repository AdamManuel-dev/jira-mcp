/**
 * @fileoverview JIRA API types and interfaces
 * @lastmodified 2025-07-27T23:35:00Z
 * 
 * Features: Complete JIRA REST API v3 type definitions, OAuth types, webhook types
 * Main APIs: Issue types, project types, sprint types, user types, field types
 * Constraints: Based on JIRA REST API v3 specification
 * Patterns: Comprehensive type coverage, optional fields, union types for status/priority
 */

// OAuth 2.0 types
export interface JiraOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  authUrl?: string;
  tokenUrl?: string;
}

export interface JiraOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  tokenType: string;
  scope: string;
}

export interface JiraInstance {
  id: string;
  name: string;
  url: string;
  cloudId?: string;
  serverVersion?: string;
  versionNumbers?: number[];
  deploymentType: 'Cloud' | 'Server';
  baseUrl: string;
}

// Core JIRA entities
export interface JiraUser {
  accountId: string;
  accountType: 'atlassian' | 'app' | 'customer';
  emailAddress?: string;
  displayName: string;
  active: boolean;
  timeZone?: string;
  locale?: string;
  groups?: {
    size: number;
    items: Array<{
      name: string;
      groupId?: string;
    }>;
  };
  applicationRoles?: {
    size: number;
    items: Array<{
      key: string;
      name: string;
    }>;
  };
  expand?: string;
  self: string;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  description?: string;
  lead?: JiraUser;
  components: JiraComponent[];
  issueTypes: JiraIssueType[];
  versions: JiraVersion[];
  roles: Record<string, string>;
  avatarUrls: {
    '48x48': string;
    '24x24': string;
    '16x16': string;
    '32x32': string;
  };
  projectCategory?: {
    id: string;
    name: string;
    description?: string;
  };
  projectTypeKey: string;
  simplified: boolean;
  style: 'classic' | 'next-gen';
  isPrivate: boolean;
  properties?: Record<string, any>;
  entityId?: string;
  uuid?: string;
  self: string;
  expand?: string;
}

export interface JiraIssueType {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  subtask: boolean;
  avatarId?: number;
  hierarchyLevel: number;
  scope?: {
    type: 'PROJECT';
    project: {
      id: string;
      key: string;
      name: string;
    };
  };
  self: string;
}

export interface JiraComponent {
  id: string;
  name: string;
  description?: string;
  lead?: JiraUser;
  leadAccountId?: string;
  assigneeType: 'PROJECT_DEFAULT' | 'COMPONENT_LEAD' | 'PROJECT_LEAD' | 'UNASSIGNED';
  assignee?: JiraUser;
  realAssigneeType: 'PROJECT_DEFAULT' | 'COMPONENT_LEAD' | 'PROJECT_LEAD' | 'UNASSIGNED';
  realAssignee?: JiraUser;
  isAssigneeTypeValid: boolean;
  project: string;
  projectId: number;
  self: string;
}

export interface JiraVersion {
  id: string;
  name: string;
  description?: string;
  archived: boolean;
  released: boolean;
  startDate?: string;
  releaseDate?: string;
  overdue?: boolean;
  userStartDate?: string;
  userReleaseDate?: string;
  project?: string;
  projectId?: number;
  moveUnfixedIssuesTo?: string;
  operations?: Array<{
    id: string;
    styleClass: string;
    iconClass: string;
    label: string;
    href: string;
    weight: number;
  }>;
  remotelinks?: Array<{
    self: string;
    name: string;
  }>;
  self: string;
}

export interface JiraSprint {
  id: number;
  name: string;
  state: 'future' | 'active' | 'closed';
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  originBoardId: number;
  goal?: string;
  self: string;
}

export interface JiraIssue {
  id: string;
  key: string;
  self: string;
  expand?: string;
  fields: JiraIssueFields;
  renderedFields?: Record<string, any>;
  properties?: Record<string, any>;
  names?: Record<string, string>;
  schema?: Record<string, JiraFieldSchema>;
  transitions?: JiraTransition[];
  operations?: {
    linkGroups: Array<{
      id: string;
      styleClass: string;
      header: {
        id: string;
        styleClass: string;
        iconClass: string;
        label: string;
        title: string;
      };
      links: Array<{
        id: string;
        styleClass: string;
        iconClass: string;
        label: string;
        title: string;
        href: string;
        weight: number;
      }>;
      weight: number;
    }>;
  };
  editmeta?: {
    fields: Record<string, JiraFieldMeta>;
  };
  changelog?: {
    startAt: number;
    maxResults: number;
    total: number;
    histories: JiraChangeHistory[];
  };
  versionedRepresentations?: Record<string, Record<string, any>>;
  fieldsToInclude?: {
    included?: string[];
    actuallyIncluded?: string[];
    excluded?: string[];
  };
}

export interface JiraIssueFields {
  summary: string;
  description?: {
    type: 'doc';
    version: 1;
    content: any[];
  } | string;
  issuetype: JiraIssueType;
  project: JiraProject;
  reporter?: JiraUser;
  assignee?: JiraUser;
  created: string;
  updated: string;
  status: JiraStatus;
  priority?: JiraPriority;
  resolution?: JiraResolution;
  resolutiondate?: string;
  components: JiraComponent[];
  fixVersions: JiraVersion[];
  affectedVersions: JiraVersion[];
  labels: string[];
  environment?: string;
  duedate?: string;
  
  // Time tracking
  timeoriginalestimate?: number;
  timeestimate?: number;
  timespent?: number;
  aggregatetimeoriginalestimate?: number;
  aggregatetimeestimate?: number;
  aggregatetimespent?: number;
  worklog?: {
    startAt: number;
    maxResults: number;
    total: number;
    worklogs: JiraWorklog[];
  };
  
  // Agile fields
  sprint?: JiraSprint | JiraSprint[];
  customfield_10002?: JiraSprint | JiraSprint[]; // Common sprint field
  
  // Story points (common custom field)
  customfield_10001?: number;
  
  // Watchers
  watches?: {
    self: string;
    watchCount: number;
    isWatching: boolean;
  };
  
  // Comments
  comment?: {
    comments: JiraComment[];
    maxResults: number;
    total: number;
    startAt: number;
  };
  
  // Attachments
  attachment?: JiraAttachment[];
  
  // Issue links
  issuelinks?: JiraIssueLink[];
  
  // Sub-tasks
  subtasks?: Array<{
    id: string;
    key: string;
    self: string;
    fields: {
      summary: string;
      status: JiraStatus;
      priority: JiraPriority;
      issuetype: JiraIssueType;
    };
  }>;
  
  // Parent (for sub-tasks)
  parent?: {
    id: string;
    key: string;
    self: string;
    fields: {
      summary: string;
      status: JiraStatus;
      priority: JiraPriority;
      issuetype: JiraIssueType;
    };
  };
  
  // Epic link
  customfield_10003?: string; // Epic Link
  customfield_10004?: string; // Epic Name
  customfield_10005?: string; // Epic Status
  
  // Security level
  security?: {
    id: string;
    name: string;
    description?: string;
    self: string;
  };
  
  // Any additional custom fields
  [key: string]: any;
}

export interface JiraStatus {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  statusCategory: {
    id: number;
    key: 'new' | 'indeterminate' | 'done';
    colorName: 'blue-gray' | 'yellow' | 'green';
    name: 'To Do' | 'In Progress' | 'Done';
    self: string;
  };
  scope?: {
    type: 'PROJECT';
    project: {
      id: string;
      key: string;
      name: string;
    };
  };
  self: string;
}

export interface JiraPriority {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  statusColor?: string;
  self: string;
}

export interface JiraResolution {
  id: string;
  name: string;
  description?: string;
  self: string;
}

export interface JiraComment {
  id: string;
  author: JiraUser;
  body: {
    type: 'doc';
    version: 1;
    content: any[];
  } | string;
  updateAuthor?: JiraUser;
  created: string;
  updated: string;
  visibility?: {
    type: 'group' | 'role';
    value: string;
    identifier?: string;
  };
  properties?: Array<{
    key: string;
    value: any;
  }>;
  self: string;
}

export interface JiraWorklog {
  id: string;
  author: JiraUser;
  updateAuthor?: JiraUser;
  comment?: {
    type: 'doc';
    version: 1;
    content: any[];
  } | string;
  created: string;
  updated: string;
  visibility?: {
    type: 'group' | 'role';
    value: string;
    identifier?: string;
  };
  started: string;
  timeSpent: string;
  timeSpentSeconds: number;
  issueId: string;
  properties?: Array<{
    key: string;
    value: any;
  }>;
  self: string;
}

export interface JiraAttachment {
  id: string;
  filename: string;
  author: JiraUser;
  created: string;
  size: number;
  mimeType: string;
  content: string;
  thumbnail?: string;
  self: string;
}

export interface JiraIssueLink {
  id: string;
  type: {
    id: string;
    name: string;
    inward: string;
    outward: string;
    self: string;
  };
  inwardIssue?: {
    id: string;
    key: string;
    self: string;
    fields: {
      summary: string;
      status: JiraStatus;
      priority: JiraPriority;
      issuetype: JiraIssueType;
    };
  };
  outwardIssue?: {
    id: string;
    key: string;
    self: string;
    fields: {
      summary: string;
      status: JiraStatus;
      priority: JiraPriority;
      issuetype: JiraIssueType;
    };
  };
  self: string;
}

export interface JiraTransition {
  id: string;
  name: string;
  to: JiraStatus;
  hasScreen: boolean;
  isGlobal: boolean;
  isInitial: boolean;
  isAvailable: boolean;
  isConditional: boolean;
  fields?: Record<string, JiraFieldMeta>;
  expand?: string;
  looped?: boolean;
}

export interface JiraFieldSchema {
  type: string;
  items?: string;
  system?: string;
  custom?: string;
  customId?: number;
  configuration?: Record<string, any>;
}

export interface JiraFieldMeta {
  required: boolean;
  schema: JiraFieldSchema;
  name: string;
  key: string;
  autoCompleteUrl?: string;
  hasDefaultValue?: boolean;
  operations: string[];
  allowedValues?: any[];
  defaultValue?: any;
}

export interface JiraChangeHistory {
  id: string;
  author: JiraUser;
  created: string;
  items: Array<{
    field: string;
    fieldtype: string;
    fieldId?: string;
    from?: string;
    fromString?: string;
    to?: string;
    toString?: string;
    tmpFromAccountId?: string;
    tmpToAccountId?: string;
  }>;
}

// Search and filtering
export interface JiraSearchRequest {
  jql: string;
  startAt?: number;
  maxResults?: number;
  fields?: string[];
  expand?: string[];
  properties?: string[];
  fieldsByKeys?: boolean;
  validateQuery?: 'strict' | 'warn' | 'none';
}

export interface JiraSearchResponse {
  expand?: string;
  startAt: number;
  maxResults: number;
  total: number;
  issues: JiraIssue[];
  warningMessages?: string[];
  names?: Record<string, string>;
  schema?: Record<string, JiraFieldSchema>;
}

// Webhook types
export interface JiraWebhookEvent {
  timestamp: number;
  webhookEvent: string;
  user?: JiraUser;
  issue?: JiraIssue;
  project?: JiraProject;
  sprint?: JiraSprint;
  comment?: JiraComment;
  worklog?: JiraWorklog;
  changelog?: JiraChangeHistory;
  issue_event_type_name?: string;
  matchedWebhookIds?: number[];
}

// API Response types
export interface JiraApiResponse<T = any> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

export interface JiraApiError {
  errorMessages: string[];
  errors: Record<string, string>;
  status?: number;
}

// Custom field types (common ones)
export interface JiraCustomFields {
  storyPoints?: number;
  epicLink?: string;
  epicName?: string;
  epicStatus?: string;
  sprint?: JiraSprint | JiraSprint[];
  flagged?: boolean;
  rank?: string;
  teamField?: string;
  businessValue?: number;
  acceptanceCriteria?: string;
  testPlan?: string;
  
  // Time tracking custom fields
  originalEstimate?: number;
  remainingEstimate?: number;
  loggedTime?: number;
  
  // Custom select fields
  severity?: {
    id: string;
    value: string;
  };
  
  // Custom multi-select fields
  affectedSystems?: Array<{
    id: string;
    value: string;
  }>;
  
  // Custom date fields
  targetDate?: string;
  actualStartDate?: string;
  actualEndDate?: string;
  
  // Custom user fields
  reviewer?: JiraUser;
  qaEngineer?: JiraUser;
  
  // Generic custom field
  [customFieldKey: string]: any;
}