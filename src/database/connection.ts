/**
 * @fileoverview PostgreSQL database connection management
 * @lastmodified 2025-07-27T23:15:00Z
 * 
 * Features: Connection pooling, health checks, transaction management, error handling
 * Main APIs: Database connection, query execution, transaction handling
 * Constraints: Requires PostgreSQL 14+, connection pooling with pgBouncer recommended
 * Patterns: Singleton connection, graceful error handling, connection retry logic
 */

import { Pool, PoolClient, PoolConfig } from 'pg';
import { config } from '@/config/environment';
import { logger } from '@/utils/logger';

class DatabaseConnection {
  private pool: Pool | null = null;
  private isConnected = false;

  async connect(): Promise<void> {
    try {
      const poolConfig: PoolConfig = {
        connectionString: config.database.url,
        host: config.database.host,
        port: config.database.port,
        database: config.database.name,
        user: config.database.user,
        password: config.database.password,
        max: 20, // Maximum number of connections
        min: 5,  // Minimum number of connections
        idleTimeoutMillis: 30000, // 30 seconds
        connectionTimeoutMillis: 10000, // 10 seconds
        statement_timeout: 60000, // 60 seconds
        query_timeout: 60000, // 60 seconds
        application_name: 'SIAS',
      };

      this.pool = new Pool(poolConfig);

      // Test connection
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();

      this.isConnected = true;
      logger.info('Database connection established successfully');

      // Set up error handlers
      this.pool.on('error', (err) => {
        logger.error('Unexpected error on idle client:', err);
        this.isConnected = false;
      });

      this.pool.on('connect', () => {
        logger.debug('New client connected to database');
      });

      this.pool.on('remove', () => {
        logger.debug('Client removed from database pool');
      });

    } catch (error) {
      logger.error('Failed to connect to database:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.isConnected = false;
      logger.info('Database connection closed');
    }
  }

  async query<T = any>(text: string, params?: any[]): Promise<T[]> {
    if (!this.pool) {
      throw new Error('Database not connected');
    }

    try {
      const start = Date.now();
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      
      logger.debug('Executed query', {
        query: text,
        params,
        duration: `${duration}ms`,
        rows: result.rowCount,
      });

      return result.rows;
    } catch (error) {
      logger.error('Database query error:', {
        query: text,
        params,
        error: error.message,
      });
      throw error;
    }
  }

  async getClient(): Promise<PoolClient> {
    if (!this.pool) {
      throw new Error('Database not connected');
    }
    return this.pool.connect();
  }

  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getClient();
    
    try {
      await client.query('BEGIN');
      logger.debug('Transaction started');
      
      const result = await callback(client);
      
      await client.query('COMMIT');
      logger.debug('Transaction committed');
      
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.debug('Transaction rolled back');
      throw error;
    } finally {
      client.release();
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (!this.pool) return false;
      
      const result = await this.query('SELECT 1 as health_check');
      return result.length > 0 && result[0].health_check === 1;
    } catch (error) {
      logger.error('Database health check failed:', error);
      return false;
    }
  }

  get connectionStatus(): boolean {
    return this.isConnected;
  }

  get poolInfo() {
    if (!this.pool) return null;
    
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
    };
  }
}

// Singleton instance
const dbConnection = new DatabaseConnection();

export const connectDatabase = () => dbConnection.connect();
export const disconnectDatabase = () => dbConnection.disconnect();
export const query = (text: string, params?: any[]) => dbConnection.query(text, params);
export const getClient = () => dbConnection.getClient();
export const transaction = (callback: (client: PoolClient) => Promise<any>) => 
  dbConnection.transaction(callback);
export const healthCheck = () => dbConnection.healthCheck();
export const getPoolInfo = () => dbConnection.poolInfo;

export default dbConnection;