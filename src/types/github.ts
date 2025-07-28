/**
 * @fileoverview GitHub API types and interfaces
 * @lastmodified 2025-07-28T02:05:00Z
 * 
 * Features: Complete GitHub API type definitions for REST and GraphQL APIs
 * Main APIs: Repositories, pull requests, commits, issues, webhooks, users
 * Constraints: Based on GitHub API v4 (GraphQL) and REST API v3
 * Patterns: Consistent naming with GitHub API, nullable fields, extended metadata
 */

export interface GitHubRepository {
  id: string;
  name: string;
  full_name: string;
  owner: GitHubUser;
  private: boolean;
  html_url: string;
  clone_url: string;
  default_branch: string;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  language?: string;
  topics: string[];
  archived: boolean;
  disabled: boolean;
  description?: string;
  homepage?: string;
  size?: number;
  stargazers_count?: number;
  watchers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
}

export interface GitHubUser {
  login: string;
  name?: string;
  email?: string;
  type: 'User' | 'Organization' | 'Bot';
  avatar_url?: string;
  html_url?: string;
}

export interface GitHubPullRequest {
  id: string;
  number: number;
  title: string;
  body?: string;
  state: 'open' | 'closed' | 'merged';
  created_at: string;
  updated_at: string;
  merged_at?: string;
  closed_at?: string;
  merged: boolean;
  mergeable?: boolean | null;
  author: GitHubUser | null;
  assignees?: GitHubUser[];
  requested_reviewers?: GitHubUser[];
  base: GitHubPullRequestRef;
  head: GitHubPullRequestRef;
  commits: GitHubCommit[];
  reviews: GitHubReview[];
  labels?: GitHubLabel[];
  milestone?: GitHubMilestone;
  draft?: boolean;
  additions?: number;
  deletions?: number;
  changed_files?: number;
}

export interface GitHubPullRequestRef {
  ref: string;
  sha: string;
  repo: GitHubRepository | null;
}

export interface GitHubCommit {
  sha: string;
  message: string;
  author: GitHubCommitUser;
  committer: GitHubCommitUser;
  url: string;
  stats?: GitHubCommitStats;
  files?: GitHubCommitFile[];
  parents?: GitHubCommitRef[];
}

export interface GitHubCommitUser {
  name: string;
  email: string;
  date: string;
}

export interface GitHubCommitStats {
  additions: number;
  deletions: number;
  total: number;
}

export interface GitHubCommitFile {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface GitHubCommitRef {
  sha: string;
  url: string;
}

export interface GitHubReview {
  id: string;
  state: 'PENDING' | 'COMMENTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'DISMISSED';
  author?: string;
  created_at: string;
  body?: string;
  commit_id?: string;
}

export interface GitHubIssue {
  id: string;
  number: number;
  title: string;
  body?: string;
  state: 'open' | 'closed';
  created_at: string;
  updated_at: string;
  closed_at?: string;
  author: GitHubUser;
  assignees: GitHubUser[];
  labels: GitHubLabel[];
  milestone?: GitHubMilestone;
  comments_count: number;
  locked: boolean;
}

export interface GitHubLabel {
  id: string;
  name: string;
  color: string;
  description?: string;
}

export interface GitHubMilestone {
  id: string;
  number: number;
  title: string;
  description?: string;
  state: 'open' | 'closed';
  created_at: string;
  updated_at: string;
  due_on?: string;
  closed_at?: string;
}

export interface GitHubBranch {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
  protected: boolean;
}

export interface GitHubWebhookEvent {
  action: string;
  repository: GitHubRepository;
  sender: GitHubUser;
  installation?: GitHubInstallation;
  
  // Pull Request events
  pull_request?: GitHubPullRequest;
  
  // Push events
  ref?: string;
  before?: string;
  after?: string;
  commits?: GitHubCommit[];
  
  // Issue events
  issue?: GitHubIssue;
  
  // Comment events
  comment?: GitHubComment;
  
  // Review events
  review?: GitHubReview;
  
  // Release events
  release?: GitHubRelease;
  
  // Branch events
  ref_type?: 'branch' | 'tag';
  master_branch?: string;
  pusher_type?: 'user' | 'deployer';
}

export interface GitHubComment {
  id: string;
  body: string;
  author: GitHubUser;
  created_at: string;
  updated_at: string;
  html_url: string;
}

export interface GitHubRelease {
  id: string;
  tag_name: string;
  name: string;
  body?: string;
  draft: boolean;
  prerelease: boolean;
  created_at: string;
  published_at?: string;
  author: GitHubUser;
  assets: GitHubReleaseAsset[];
}

export interface GitHubReleaseAsset {
  id: string;
  name: string;
  content_type: string;
  size: number;
  download_count: number;
  created_at: string;
  updated_at: string;
  browser_download_url: string;
}

export interface GitHubApp {
  id: string;
  name: string;
  slug: string;
  owner: GitHubUser;
  description?: string;
  external_url?: string;
  html_url: string;
  created_at: string;
  updated_at: string;
}

export interface GitHubInstallation {
  id: string;
  app_id: string;
  target_id: string;
  target_type: 'Organization' | 'User';
  permissions: Record<string, string>;
  events: string[];
  created_at: string;
  updated_at: string;
  single_file_name?: string;
  repository_selection: 'selected' | 'all';
}

export interface GitHubCheckRun {
  id: string;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'action_required' | 'stale';
  started_at?: string;
  completed_at?: string;
  output?: {
    title?: string;
    summary?: string;
    text?: string;
    annotations_count: number;
    annotations_url: string;
  };
  check_suite: {
    id: string;
  };
  app: GitHubApp;
  pull_requests: GitHubPullRequest[];
}

export interface GitHubWorkflowRun {
  id: string;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'action_required' | 'stale';
  workflow_id: string;
  run_number: number;
  created_at: string;
  updated_at: string;
  run_started_at: string;
  head_branch: string;
  head_sha: string;
  event: string;
  triggering_actor: GitHubUser;
  repository: GitHubRepository;
}

// Configuration interfaces
export interface GitHubIntegrationConfig {
  id: string;
  organizationId: string;
  installationId: string;
  name: string;
  baseUrl?: string; // For GitHub Enterprise
  isActive: boolean;
  settings: {
    syncInterval: number;
    enabledEvents: string[];
    repositoryFilters: string[];
    branchFilters: string[];
    webhookUrl: string;
    autoLinkTickets: boolean;
    syncPullRequests: boolean;
    syncCommits: boolean;
    syncIssues: boolean;
    syncReleases: boolean;
  };
}

// Webhook signature verification
export interface GitHubWebhookSignature {
  algorithm: string;
  signature: string;
}

// Rate limiting
export interface GitHubRateLimit {
  limit: number;
  remaining: number;
  reset: number;
  used: number;
  resource: string;
}

// Search interfaces
export interface GitHubSearchQuery {
  q: string;
  sort?: 'created' | 'updated' | 'comments';
  order?: 'asc' | 'desc';
  per_page?: number;
  page?: number;
}

export interface GitHubSearchResults<T> {
  total_count: number;
  incomplete_results: boolean;
  items: T[];
}

// Event processing
export interface ProcessedGitHubEvent {
  id: string;
  type: string;
  action: string;
  repository: string;
  timestamp: string;
  processed: boolean;
  data: GitHubWebhookEvent;
  ticketReferences: string[];
  error?: string;
}