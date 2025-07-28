/**
 * @fileoverview JIRA integration service combining OAuth and API client
 * @lastmodified 2025-07-27T23:35:00Z
 * 
 * Features: Complete JIRA integration, instance management, sync operations, field mapping
 * Main APIs: Integration setup, data synchronization, field discovery, webhook management
 * Constraints: Requires OAuth tokens, manages multiple instances per organization
 * Patterns: Service facade, instance pooling, configuration management, sync scheduling
 */

import { BaseService } from '@/services';
import { query, transaction } from '@/database/connection';
import { cache } from '@/config/redis';
import { logger, perf } from '@/utils/logger';
import { JiraOAuthService } from './oauth';
import { JiraApiClient } from './client';
import {
  JiraInstance,
  JiraProject,
  JiraSprint,
  JiraIssue,
  JiraUser,
  JiraCustomFields,
  JiraIssueType,
  JiraStatus,
  JiraPriority,
} from '@/types/jira';

interface JiraIntegrationConfig {
  id: string;
  organizationId: string;
  name: string;
  instanceId: string;
  baseUrl: string;
  isActive: boolean;
  settings: {
    syncInterval: number; // minutes
    enabledFeatures: string[];
    fieldMappings: Record<string, string>;
    projectFilters: string[];
    sprintBoards: number[];
  };
}

interface SyncResult {
  success: boolean;
  stats: {
    projectsCreated: number;
    projectsUpdated: number;
    sprintsCreated: number;
    sprintsUpdated: number;
    issuesCreated: number;
    issuesUpdated: number;
    usersCreated: number;
    usersUpdated: number;
  };
  errors: string[];
  duration: number;
}

export class JiraIntegrationService extends BaseService {
  private oauthService!: JiraOAuthService;
  private clientPool: Map<string, JiraApiClient> = new Map();

  async initialize(): Promise<void> {
    this.oauthService = new JiraOAuthService();
    this.logger.info('JIRA Integration Service initialized');
  }

  /**
   * Setup new JIRA integration
   */
  async setupIntegration(
    organizationId: string,
    userId: string,
    name: string,
    redirectUrl?: string
  ): Promise<{ authUrl: string; state: string }> {
    try {
      this.logger.info('Setting up JIRA integration', {
        organizationId,
        userId,
        name,
      });

      // Generate OAuth authorization URL
      const authResult = await this.oauthService.generateAuthUrl(
        organizationId,
        userId,
        redirectUrl
      );

      return authResult;
    } catch (error) {
      this.logger.error('Failed to setup JIRA integration:', error);
      throw error;
    }
  }

  /**
   * Complete OAuth flow and create integration
   */
  async completeOAuthFlow(
    code: string,
    state: string
  ): Promise<{ integrationId: string; instances: JiraInstance[] }> {
    try {
      // Exchange code for tokens
      const { tokens, organizationId, userId } = await this.oauthService.exchangeCodeForTokens(
        code,
        state
      );

      // Get accessible JIRA instances
      const instances = await this.oauthService.getAccessibleResources(organizationId, userId);

      if (instances.length === 0) {
        throw new Error('No accessible JIRA instances found');
      }

      // Create integration record for the first instance (user can add more later)
      const primaryInstance = instances[0];
      const integrationId = await this.createIntegrationRecord(
        organizationId,
        primaryInstance,
        {
          syncInterval: 15, // 15 minutes
          enabledFeatures: ['issues', 'sprints', 'comments', 'worklogs'],
          fieldMappings: {},
          projectFilters: [],
          sprintBoards: [],
        }
      );

      this.logger.info('JIRA OAuth flow completed', {
        organizationId,
        userId,
        integrationId,
        instanceCount: instances.length,
      });

      return { integrationId, instances };
    } catch (error) {
      this.logger.error('Failed to complete JIRA OAuth flow:', error);
      throw error;
    }
  }

  /**
   * Get or create API client for integration
   */
  private async getApiClient(integrationId: string): Promise<JiraApiClient> {
    if (this.clientPool.has(integrationId)) {
      return this.clientPool.get(integrationId)!;
    }

    // Get integration config from database
    const integration = await this.getIntegrationConfig(integrationId);
    if (!integration) {
      throw new Error(`Integration ${integrationId} not found`);
    }

    // Create new client
    const client = new JiraApiClient({
      organizationId: integration.organizationId,
      userId: '', // TODO: Get from integration record
      instanceId: integration.instanceId,
      baseUrl: integration.baseUrl,
    });

    // Test connection
    const isConnected = await client.testConnection();
    if (!isConnected) {
      throw new Error(`Failed to connect to JIRA instance ${integration.instanceId}`);
    }

    this.clientPool.set(integrationId, client);
    return client;
  }

  /**
   * Sync data from JIRA
   */
  async syncIntegration(integrationId: string): Promise<SyncResult> {
    const startTime = Date.now();
    const stats = {
      projectsCreated: 0,
      projectsUpdated: 0,
      sprintsCreated: 0,
      sprintsUpdated: 0,
      issuesCreated: 0,
      issuesUpdated: 0,
      usersCreated: 0,
      usersUpdated: 0,
    };
    const errors: string[] = [];

    try {
      this.logger.info('Starting JIRA sync', { integrationId });

      const client = await this.getApiClient(integrationId);
      const integration = await this.getIntegrationConfig(integrationId);

      if (!integration) {
        throw new Error(`Integration ${integrationId} not found`);
      }

      // Sync projects
      if (integration.settings.enabledFeatures.includes('projects')) {
        const projectResult = await this.syncProjects(client, integration);
        stats.projectsCreated += projectResult.created;
        stats.projectsUpdated += projectResult.updated;
        errors.push(...projectResult.errors);
      }

      // Sync sprints
      if (integration.settings.enabledFeatures.includes('sprints')) {
        const sprintResult = await this.syncSprints(client, integration);
        stats.sprintsCreated += sprintResult.created;
        stats.sprintsUpdated += sprintResult.updated;
        errors.push(...sprintResult.errors);
      }

      // Sync issues
      if (integration.settings.enabledFeatures.includes('issues')) {
        const issueResult = await this.syncIssues(client, integration);
        stats.issuesCreated += issueResult.created;
        stats.issuesUpdated += issueResult.updated;
        errors.push(...issueResult.errors);
      }

      // Update last sync time
      await this.updateLastSyncTime(integrationId);

      const duration = Date.now() - startTime;
      
      this.logger.info('JIRA sync completed', {
        integrationId,
        duration,
        stats,
        errorCount: errors.length,
      });

      return {
        success: errors.length === 0,
        stats,
        errors,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('JIRA sync failed:', error);
      
      return {
        success: false,
        stats,
        errors: [...errors, error.message],
        duration,
      };
    }
  }

  /**
   * Sync projects from JIRA
   */
  private async syncProjects(
    client: JiraApiClient,
    integration: JiraIntegrationConfig
  ): Promise<{ created: number; updated: number; errors: string[] }> {
    return perf.measureAsync('jira.syncProjects', async () => {
      let created = 0;
      let updated = 0;
      const errors: string[] = [];

      try {
        const projects = await client.getProjects(['description', 'lead', 'issueTypes']);
        
        for (const project of projects) {
          try {
            // Check if project matches filters
            if (integration.settings.projectFilters.length > 0) {
              if (!integration.settings.projectFilters.includes(project.key)) {
                continue;
              }
            }

            const existingProject = await this.findProjectByExternalId(
              integration.id,
              project.id
            );

            if (existingProject) {
              await this.updateProject(existingProject.id, project);
              updated++;
            } else {
              await this.createProject(integration.id, project);
              created++;
            }
          } catch (error) {
            errors.push(`Failed to sync project ${project.key}: ${error.message}`);
          }
        }

        this.logger.info('Projects sync completed', {
          integrationId: integration.id,
          created,
          updated,
          errorCount: errors.length,
        });

        return { created, updated, errors };
      } catch (error) {
        errors.push(`Failed to fetch projects: ${error.message}`);
        return { created, updated, errors };
      }
    });
  }

  /**
   * Sync sprints from JIRA
   */
  private async syncSprints(
    client: JiraApiClient,
    integration: JiraIntegrationConfig
  ): Promise<{ created: number; updated: number; errors: string[] }> {
    return perf.measureAsync('jira.syncSprints', async () => {
      let created = 0;
      let updated = 0;
      const errors: string[] = [];

      try {
        // Get sprints from configured boards
        for (const boardId of integration.settings.sprintBoards) {
          try {
            const sprints = await client.getBoardSprints(boardId);
            
            for (const sprint of sprints) {
              try {
                const existingSprint = await this.findSprintByExternalId(
                  integration.id,
                  sprint.id.toString()
                );

                if (existingSprint) {
                  await this.updateSprint(existingSprint.id, sprint);
                  updated++;
                } else {
                  await this.createSprint(integration.id, sprint, boardId);
                  created++;
                }
              } catch (error) {
                errors.push(`Failed to sync sprint ${sprint.name}: ${error.message}`);
              }
            }
          } catch (error) {
            errors.push(`Failed to sync sprints for board ${boardId}: ${error.message}`);
          }
        }

        return { created, updated, errors };
      } catch (error) {
        errors.push(`Failed to sync sprints: ${error.message}`);
        return { created, updated, errors };
      }
    });
  }

  /**
   * Sync issues from JIRA
   */
  private async syncIssues(
    client: JiraApiClient,
    integration: JiraIntegrationConfig
  ): Promise<{ created: number; updated: number; errors: string[] }> {
    return perf.measureAsync('jira.syncIssues', async () => {
      let created = 0;
      let updated = 0;
      const errors: string[] = [];

      try {
        // Get recently updated issues
        const updatedSince = await this.getLastSyncTime(integration.id);
        const jql = this.buildIssueJQL(integration, updatedSince);

        let startAt = 0;
        const maxResults = 100;
        let hasMoreResults = true;

        while (hasMoreResults) {
          try {
            const searchResult = await client.searchIssues({
              jql,
              startAt,
              maxResults,
              fields: [
                'key', 'summary', 'description', 'issuetype', 'status', 'priority',
                'assignee', 'reporter', 'created', 'updated', 'resolution',
                'timeoriginalestimate', 'timeestimate', 'timespent', 'worklog',
                'comment', 'labels', 'components', 'fixVersions', 'affectedVersions',
                'sprint', 'customfield_10001', // Story points
              ],
            });

            for (const issue of searchResult.issues) {
              try {
                const existingIssue = await this.findIssueByExternalId(
                  integration.id,
                  issue.id
                );

                if (existingIssue) {
                  await this.updateIssue(existingIssue.id, issue);
                  updated++;
                } else {
                  await this.createIssue(integration.id, issue);
                  created++;
                }
              } catch (error) {
                errors.push(`Failed to sync issue ${issue.key}: ${error.message}`);
              }
            }

            hasMoreResults = startAt + maxResults < searchResult.total;
            startAt += maxResults;
          } catch (error) {
            errors.push(`Failed to search issues: ${error.message}`);
            break;
          }
        }

        return { created, updated, errors };
      } catch (error) {
        errors.push(`Failed to sync issues: ${error.message}`);
        return { created, updated, errors };
      }
    });
  }

  /**
   * Discover custom fields and their mappings
   */
  async discoverCustomFields(integrationId: string): Promise<{
    fields: any[];
    suggestions: Record<string, string>;
  }> {
    try {
      const client = await this.getApiClient(integrationId);
      const fields = await client.getCustomFields();

      // Filter custom fields only
      const customFields = fields.filter(field => field.custom);

      // Suggest common field mappings
      const suggestions: Record<string, string> = {};
      
      for (const field of customFields) {
        const name = field.name.toLowerCase();
        
        if (name.includes('story point') || name.includes('points')) {
          suggestions.storyPoints = field.id;
        } else if (name.includes('epic link')) {
          suggestions.epicLink = field.id;
        } else if (name.includes('sprint')) {
          suggestions.sprint = field.id;
        } else if (name.includes('team')) {
          suggestions.team = field.id;
        }
      }

      this.logger.info('Custom fields discovered', {
        integrationId,
        totalFields: fields.length,
        customFields: customFields.length,
        suggestions,
      });

      return { fields: customFields, suggestions };
    } catch (error) {
      this.logger.error('Failed to discover custom fields:', error);
      throw error;
    }
  }

  /**
   * Update field mappings for integration
   */
  async updateFieldMappings(
    integrationId: string,
    mappings: Record<string, string>
  ): Promise<void> {
    try {
      await query(
        `UPDATE integrations 
         SET config = jsonb_set(config, '{fieldMappings}', $1::jsonb)
         WHERE id = $2`,
        [JSON.stringify(mappings), integrationId]
      );

      // Clear cache
      await cache.del(`jira_integration:${integrationId}`);

      this.logger.info('Field mappings updated', {
        integrationId,
        mappings,
      });
    } catch (error) {
      this.logger.error('Failed to update field mappings:', error);
      throw error;
    }
  }

  // === PRIVATE HELPER METHODS ===

  private async createIntegrationRecord(
    organizationId: string,
    instance: JiraInstance,
    settings: any
  ): Promise<string> {
    const result = await query(
      `INSERT INTO integrations (organization_id, provider, name, config, credentials)
       VALUES ($1, 'jira', $2, $3, $4)
       RETURNING id`,
      [
        organizationId,
        instance.name,
        JSON.stringify({
          instanceId: instance.id,
          baseUrl: instance.baseUrl,
          deploymentType: instance.deploymentType,
          settings,
        }),
        JSON.stringify({}), // Credentials stored separately in OAuth service
      ]
    );

    return result[0].id;
  }

  private async getIntegrationConfig(integrationId: string): Promise<JiraIntegrationConfig | null> {
    const cacheKey = `jira_integration:${integrationId}`;
    const cached = await cache.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    const result = await query(
      `SELECT * FROM integrations WHERE id = $1 AND provider = 'jira'`,
      [integrationId]
    );

    if (result.length === 0) {
      return null;
    }

    const row = result[0];
    const config: JiraIntegrationConfig = {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      instanceId: row.config.instanceId,
      baseUrl: row.config.baseUrl,
      isActive: row.is_active,
      settings: row.config.settings || {},
    };

    await cache.set(cacheKey, JSON.stringify(config), 300); // 5 minutes cache
    return config;
  }

  private buildIssueJQL(integration: JiraIntegrationConfig, updatedSince?: Date): string {
    const conditions: string[] = [];

    // Project filter
    if (integration.settings.projectFilters.length > 0) {
      conditions.push(`project in (${integration.settings.projectFilters.join(',')})`);
    }

    // Updated since filter
    if (updatedSince) {
      const dateStr = updatedSince.toISOString().split('T')[0]; // YYYY-MM-DD format
      conditions.push(`updated >= "${dateStr}"`);
    }

    // Default to updated in last 7 days if no specific filter
    if (conditions.length === 0) {
      conditions.push('updated >= -7d');
    }

    return conditions.join(' AND ') + ' ORDER BY updated DESC';
  }

  private async getLastSyncTime(integrationId: string): Promise<Date | undefined> {
    const result = await query(
      `SELECT last_sync_at FROM integrations WHERE id = $1`,
      [integrationId]
    );

    return result[0]?.last_sync_at;
  }

  private async updateLastSyncTime(integrationId: string): Promise<void> {
    await query(
      `UPDATE integrations SET last_sync_at = NOW() WHERE id = $1`,
      [integrationId]
    );
  }

  // Database helper methods (simplified - would need full implementation)
  private async findProjectByExternalId(integrationId: string, externalId: string): Promise<any> {
    const result = await query(
      `SELECT * FROM projects WHERE integration_id = $1 AND external_id = $2`,
      [integrationId, externalId]
    );
    return result[0] || null;
  }

  private async createProject(integrationId: string, project: JiraProject): Promise<void> {
    await query(
      `INSERT INTO projects (integration_id, external_id, name, description, project_type, settings)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        integrationId,
        project.id,
        project.name,
        project.description,
        project.projectTypeKey,
        JSON.stringify({
          key: project.key,
          lead: project.lead,
          avatarUrls: project.avatarUrls,
        }),
      ]
    );
  }

  private async updateProject(projectId: string, project: JiraProject): Promise<void> {
    await query(
      `UPDATE projects SET 
       name = $2, description = $3, project_type = $4, 
       settings = $5, updated_at = NOW()
       WHERE id = $1`,
      [
        projectId,
        project.name,
        project.description,
        project.projectTypeKey,
        JSON.stringify({
          key: project.key,
          lead: project.lead,
          avatarUrls: project.avatarUrls,
        }),
      ]
    );
  }

  private async findSprintByExternalId(integrationId: string, externalId: string): Promise<any> {
    // Implementation would query sprints table
    return null;
  }

  private async createSprint(integrationId: string, sprint: JiraSprint, boardId: number): Promise<void> {
    // Implementation would create sprint record
  }

  private async updateSprint(sprintId: string, sprint: JiraSprint): Promise<void> {
    // Implementation would update sprint record
  }

  private async findIssueByExternalId(integrationId: string, externalId: string): Promise<any> {
    // Implementation would query tickets table
    return null;
  }

  private async createIssue(integrationId: string, issue: JiraIssue): Promise<void> {
    // Implementation would create ticket record
  }

  private async updateIssue(issueId: string, issue: JiraIssue): Promise<void> {
    // Implementation would update ticket record
  }
}