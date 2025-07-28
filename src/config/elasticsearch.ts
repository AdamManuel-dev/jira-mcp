/**
 * @fileoverview Elasticsearch configuration and client setup for full-text search
 * @lastmodified 2025-07-28T02:30:00Z
 * 
 * Features: Elasticsearch client, index management, search operations, aggregations
 * Main APIs: Client initialization, index operations, search queries, data sync
 * Constraints: Requires Elasticsearch 8+, custom analyzers, multi-tenant indexes
 * Patterns: Index templates, custom analyzers, search optimization, data mapping
 */

import { Client } from '@elastic/elasticsearch';
import { config } from '@/config/environment';
import { logger, perf } from '@/utils/logger';
import { ExternalServiceError } from '@/middleware/error-handler';

interface ElasticsearchConfig {
  node: string;
  auth?: {
    username: string;
    password: string;
  };
  apiKey?: string;
  tls?: {
    ca?: string;
    cert?: string;
    key?: string;
    rejectUnauthorized?: boolean;
  };
}

interface SearchableTicket {
  ticket_key: string;
  organization_id: string;
  project_key: string;
  summary: string;
  description?: string;
  issue_type: string;
  status: string;
  priority?: string;
  assignee?: string;
  reporter?: string;
  labels: string[];
  components: string[];
  sprint_name?: string;
  created_at: string;
  updated_at: string;
  comments: Array<{
    author: string;
    body: string;
    created_at: string;
  }>;
  custom_fields: Record<string, any>;
}

interface SearchableCommit {
  repository_id: string;
  organization_id: string;
  sha: string;
  message: string;
  author_name: string;
  author_email: string;
  committed_at: string;
  ticket_references: string[];
  repository_name: string;
  branch?: string;
}

interface SearchQuery {
  query: string;
  filters?: {
    organization_id?: string;
    project_keys?: string[];
    issue_types?: string[];
    statuses?: string[];
    assignees?: string[];
    date_range?: {
      field: string;
      from?: string;
      to?: string;
    };
  };
  pagination?: {
    from: number;
    size: number;
  };
  sort?: Array<{
    field: string;
    order: 'asc' | 'desc';
  }>;
}

interface SearchResult<T> {
  hits: T[];
  total: {
    value: number;
    relation: 'eq' | 'gte';
  };
  max_score: number;
  aggregations?: Record<string, any>;
}

class ElasticsearchManager {
  private client: Client;
  private isConnected = false;

  constructor() {
    const esConfig: ElasticsearchConfig = {
      node: config.elasticsearch.node || 'http://localhost:9200',
    };

    // Setup authentication
    if (config.elasticsearch.username && config.elasticsearch.password) {
      esConfig.auth = {
        username: config.elasticsearch.username,
        password: config.elasticsearch.password,
      };
    } else if (config.elasticsearch.apiKey) {
      esConfig.apiKey = config.elasticsearch.apiKey;
    }

    // Setup TLS if configured
    if (config.elasticsearch.tls) {
      esConfig.tls = {
        ca: config.elasticsearch.tls.ca,
        cert: config.elasticsearch.tls.cert,
        key: config.elasticsearch.tls.key,
        rejectUnauthorized: config.elasticsearch.tls.rejectUnauthorized !== false,
      };
    }

    this.client = new Client(esConfig);
  }

  /**
   * Initialize Elasticsearch connection and setup indexes
   */
  async initialize(): Promise<void> {
    try {
      // Test connection
      const health = await this.client.cluster.health();
      logger.info('Elasticsearch connection established', {
        status: health.status,
        cluster_name: health.cluster_name,
        elasticsearch_version: (health as any).version?.number,
      });

      // Setup index templates and mappings
      await this.setupIndexTemplates();
      
      // Create initial indexes if they don't exist
      await this.createIndexes();

      this.isConnected = true;
      logger.info('Elasticsearch initialization completed');

    } catch (error) {
      logger.error('Failed to initialize Elasticsearch:', error);
      throw new ExternalServiceError('Elasticsearch initialization failed');
    }
  }

  /**
   * Setup index templates with custom analyzers and mappings
   */
  private async setupIndexTemplates(): Promise<void> {
    // Ticket index template
    await this.client.indices.putIndexTemplate({
      name: 'sias-tickets-template',
      index_patterns: ['sias-tickets-*'],
      template: {
        settings: {
          analysis: {
            analyzer: {
              ticket_analyzer: {
                type: 'custom',
                tokenizer: 'standard',
                filter: [
                  'lowercase',
                  'asciifolding',
                  'ticket_stopwords',
                  'ticket_synonyms',
                ],
              },
              ticket_key_analyzer: {
                type: 'custom',
                tokenizer: 'keyword',
                filter: ['uppercase'],
              },
            },
            filter: {
              ticket_stopwords: {
                type: 'stop',
                stopwords: ['the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but'],
              },
              ticket_synonyms: {
                type: 'synonym',
                synonyms: [
                  'bug,defect,issue',
                  'feature,enhancement,improvement',
                  'task,todo,work',
                  'story,requirement,spec',
                ],
              },
            },
            normalizer: {
              uppercase_normalizer: {
                type: 'custom',
                filter: ['uppercase'],
              },
            },
          },
          'index.max_result_window': 50000,
        },
        mappings: {
          properties: {
            ticket_key: {
              type: 'keyword',
              fields: {
                text: {
                  type: 'text',
                  analyzer: 'ticket_key_analyzer',
                },
              },
            },
            organization_id: { type: 'keyword' },
            project_key: { type: 'keyword' },
            summary: {
              type: 'text',
              analyzer: 'ticket_analyzer',
              fields: {
                exact: { type: 'keyword' },
                suggest: { type: 'completion' },
              },
            },
            description: {
              type: 'text',
              analyzer: 'ticket_analyzer',
            },
            issue_type: { type: 'keyword' },
            status: { type: 'keyword' },
            priority: { type: 'keyword' },
            assignee: { type: 'keyword' },
            reporter: { type: 'keyword' },
            labels: { type: 'keyword' },
            components: { type: 'keyword' },
            sprint_name: { type: 'keyword' },
            created_at: { type: 'date' },
            updated_at: { type: 'date' },
            comments: {
              type: 'nested',
              properties: {
                author: { type: 'keyword' },
                body: {
                  type: 'text',
                  analyzer: 'ticket_analyzer',
                },
                created_at: { type: 'date' },
              },
            },
            custom_fields: {
              type: 'object',
              dynamic: true,
            },
          },
        },
      },
    });

    // Commit index template
    await this.client.indices.putIndexTemplate({
      name: 'sias-commits-template',
      index_patterns: ['sias-commits-*'],
      template: {
        settings: {
          analysis: {
            analyzer: {
              commit_analyzer: {
                type: 'custom',
                tokenizer: 'standard',
                filter: ['lowercase', 'asciifolding'],
              },
            },
          },
        },
        mappings: {
          properties: {
            repository_id: { type: 'keyword' },
            organization_id: { type: 'keyword' },
            sha: { type: 'keyword' },
            message: {
              type: 'text',
              analyzer: 'commit_analyzer',
              fields: {
                exact: { type: 'keyword' },
              },
            },
            author_name: { type: 'keyword' },
            author_email: { type: 'keyword' },
            committed_at: { type: 'date' },
            ticket_references: { type: 'keyword' },
            repository_name: { type: 'keyword' },
            branch: { type: 'keyword' },
          },
        },
      },
    });

    logger.debug('Elasticsearch index templates created');
  }

  /**
   * Create indexes if they don't exist
   */
  private async createIndexes(): Promise<void> {
    const indexes = [
      'sias-tickets-main',
      'sias-commits-main',
    ];

    for (const index of indexes) {
      try {
        const exists = await this.client.indices.exists({ index });
        if (!exists) {
          await this.client.indices.create({ index });
          logger.debug(`Created Elasticsearch index: ${index}`);
        }
      } catch (error) {
        logger.error(`Failed to create index ${index}:`, error);
      }
    }
  }

  // === TICKET OPERATIONS ===

  /**
   * Index a ticket for search
   */
  async indexTicket(ticket: SearchableTicket): Promise<void> {
    return perf.measureAsync('elasticsearch.indexTicket', async () => {
      try {
        await this.client.index({
          index: `sias-tickets-${ticket.organization_id}`,
          id: ticket.ticket_key,
          document: {
            ...ticket,
            indexed_at: new Date().toISOString(),
          },
        });

        logger.debug('Ticket indexed for search', {
          ticketKey: ticket.ticket_key,
          organizationId: ticket.organization_id,
        });

      } catch (error) {
        logger.error('Failed to index ticket:', error);
        throw error;
      }
    });
  }

  /**
   * Bulk index tickets
   */
  async bulkIndexTickets(tickets: SearchableTicket[]): Promise<void> {
    return perf.measureAsync('elasticsearch.bulkIndexTickets', async () => {
      try {
        const body = [];
        const indexedAt = new Date().toISOString();

        for (const ticket of tickets) {
          body.push({
            index: {
              _index: `sias-tickets-${ticket.organization_id}`,
              _id: ticket.ticket_key,
            },
          });
          body.push({
            ...ticket,
            indexed_at: indexedAt,
          });
        }

        const response = await this.client.bulk({ body });

        if (response.errors) {
          const errorCount = response.items.filter(item => 
            item.index?.error || item.create?.error
          ).length;
          logger.warn(`Bulk index completed with ${errorCount} errors`);
        }

        logger.debug(`Bulk indexed ${tickets.length} tickets`);

      } catch (error) {
        logger.error('Failed to bulk index tickets:', error);
        throw error;
      }
    });
  }

  /**
   * Search tickets
   */
  async searchTickets(searchQuery: SearchQuery): Promise<SearchResult<SearchableTicket>> {
    return perf.measureAsync('elasticsearch.searchTickets', async () => {
      try {
        const query = this.buildSearchQuery(searchQuery);
        
        const response = await this.client.search({
          index: searchQuery.filters?.organization_id 
            ? `sias-tickets-${searchQuery.filters.organization_id}`
            : 'sias-tickets-*',
          query,
          from: searchQuery.pagination?.from || 0,
          size: searchQuery.pagination?.size || 20,
          sort: this.buildSortOptions(searchQuery.sort),
          highlight: {
            fields: {
              summary: {},
              description: {},
              'comments.body': {},
            },
            pre_tags: ['<mark>'],
            post_tags: ['</mark>'],
          },
        });

        return {
          hits: response.hits.hits.map(hit => ({
            ...hit._source as SearchableTicket,
            _score: hit._score,
            _highlights: hit.highlight,
          })),
          total: response.hits.total as { value: number; relation: 'eq' | 'gte' },
          max_score: response.hits.max_score || 0,
          aggregations: response.aggregations,
        };

      } catch (error) {
        logger.error('Failed to search tickets:', error);
        throw error;
      }
    });
  }

  // === COMMIT OPERATIONS ===

  /**
   * Index a commit for search
   */
  async indexCommit(commit: SearchableCommit): Promise<void> {
    return perf.measureAsync('elasticsearch.indexCommit', async () => {
      try {
        await this.client.index({
          index: `sias-commits-${commit.organization_id}`,
          id: `${commit.repository_id}-${commit.sha}`,
          document: {
            ...commit,
            indexed_at: new Date().toISOString(),
          },
        });

        logger.debug('Commit indexed for search', {
          sha: commit.sha,
          repository: commit.repository_name,
        });

      } catch (error) {
        logger.error('Failed to index commit:', error);
        throw error;
      }
    });
  }

  /**
   * Search commits
   */
  async searchCommits(searchQuery: SearchQuery): Promise<SearchResult<SearchableCommit>> {
    return perf.measureAsync('elasticsearch.searchCommits', async () => {
      try {
        const query = this.buildSearchQuery(searchQuery);
        
        const response = await this.client.search({
          index: searchQuery.filters?.organization_id 
            ? `sias-commits-${searchQuery.filters.organization_id}`
            : 'sias-commits-*',
          query,
          from: searchQuery.pagination?.from || 0,
          size: searchQuery.pagination?.size || 20,
          sort: this.buildSortOptions(searchQuery.sort || [{ field: 'committed_at', order: 'desc' }]),
          highlight: {
            fields: {
              message: {},
            },
          },
        });

        return {
          hits: response.hits.hits.map(hit => ({
            ...hit._source as SearchableCommit,
            _score: hit._score,
            _highlights: hit.highlight,
          })),
          total: response.hits.total as { value: number; relation: 'eq' | 'gte' },
          max_score: response.hits.max_score || 0,
        };

      } catch (error) {
        logger.error('Failed to search commits:', error);
        throw error;
      }
    });
  }

  // === HELPER METHODS ===

  /**
   * Build Elasticsearch query from search parameters
   */
  private buildSearchQuery(searchQuery: SearchQuery): any {
    const mustClauses = [];
    const filterClauses = [];

    // Main text search
    if (searchQuery.query && searchQuery.query.trim()) {
      mustClauses.push({
        multi_match: {
          query: searchQuery.query,
          fields: [
            'summary^3',
            'description^2',
            'comments.body',
            'message^2', // For commits
            'ticket_key^4',
          ],
          type: 'best_fields',
          fuzziness: 'AUTO',
        },
      });
    }

    // Apply filters
    if (searchQuery.filters) {
      const { filters } = searchQuery;

      if (filters.organization_id) {
        filterClauses.push({ term: { organization_id: filters.organization_id } });
      }

      if (filters.project_keys?.length) {
        filterClauses.push({ terms: { project_key: filters.project_keys } });
      }

      if (filters.issue_types?.length) {
        filterClauses.push({ terms: { issue_type: filters.issue_types } });
      }

      if (filters.statuses?.length) {
        filterClauses.push({ terms: { status: filters.statuses } });
      }

      if (filters.assignees?.length) {
        filterClauses.push({ terms: { assignee: filters.assignees } });
      }

      if (filters.date_range) {
        const range: any = {};
        if (filters.date_range.from) range.gte = filters.date_range.from;
        if (filters.date_range.to) range.lte = filters.date_range.to;
        
        filterClauses.push({
          range: {
            [filters.date_range.field]: range,
          },
        });
      }
    }

    // Build final query
    if (mustClauses.length === 0 && filterClauses.length === 0) {
      return { match_all: {} };
    }

    return {
      bool: {
        must: mustClauses.length > 0 ? mustClauses : [{ match_all: {} }],
        filter: filterClauses,
      },
    };
  }

  /**
   * Build sort options for Elasticsearch
   */
  private buildSortOptions(sortOptions?: Array<{ field: string; order: 'asc' | 'desc' }>): any[] {
    if (!sortOptions?.length) {
      return [{ _score: { order: 'desc' } }, { updated_at: { order: 'desc' } }];
    }

    return sortOptions.map(sort => ({
      [sort.field]: { order: sort.order },
    }));
  }

  /**
   * Delete ticket from search index
   */
  async deleteTicket(organizationId: string, ticketKey: string): Promise<void> {
    try {
      await this.client.delete({
        index: `sias-tickets-${organizationId}`,
        id: ticketKey,
      });

      logger.debug('Ticket deleted from search index', { ticketKey });
    } catch (error) {
      if ((error as any).meta?.statusCode !== 404) {
        logger.error('Failed to delete ticket from search index:', error);
        throw error;
      }
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const health = await this.client.cluster.health();
      return health.status === 'green' || health.status === 'yellow';
    } catch (error) {
      logger.error('Elasticsearch health check failed:', error);
      return false;
    }
  }

  /**
   * Get cluster information
   */
  async getClusterInfo(): Promise<any> {
    try {
      const [health, stats] = await Promise.all([
        this.client.cluster.health(),
        this.client.cluster.stats(),
      ]);

      return {
        health: health.status,
        nodes: health.number_of_nodes,
        indices: stats.indices.count,
        documents: stats.indices.docs.count,
        store_size: stats.indices.store.size_in_bytes,
      };
    } catch (error) {
      logger.error('Failed to get Elasticsearch cluster info:', error);
      throw error;
    }
  }

  get connectionStatus(): boolean {
    return this.isConnected;
  }
}

// Singleton instance
const elasticsearchManager = new ElasticsearchManager();

export const connectElasticsearch = () => elasticsearchManager.initialize();
export const searchTickets = (query: SearchQuery) => elasticsearchManager.searchTickets(query);
export const searchCommits = (query: SearchQuery) => elasticsearchManager.searchCommits(query);
export const indexTicket = (ticket: SearchableTicket) => elasticsearchManager.indexTicket(ticket);
export const bulkIndexTickets = (tickets: SearchableTicket[]) => elasticsearchManager.bulkIndexTickets(tickets);
export const indexCommit = (commit: SearchableCommit) => elasticsearchManager.indexCommit(commit);
export const deleteTicket = (organizationId: string, ticketKey: string) => 
  elasticsearchManager.deleteTicket(organizationId, ticketKey);
export const elasticsearchHealthCheck = () => elasticsearchManager.healthCheck();
export const getElasticsearchInfo = () => elasticsearchManager.getClusterInfo();

export default elasticsearchManager;

// Export types
export type {
  SearchableTicket,
  SearchableCommit,
  SearchQuery,
  SearchResult,
};