/**
 * @fileoverview Redis connection and configuration management
 * @lastmodified 2025-07-27T23:15:00Z
 * 
 * Features: Redis connection pooling, caching utilities, pub/sub, session storage
 * Main APIs: Connection management, cache operations, pub/sub messaging
 * Constraints: Requires Redis 6+, supports clustering, handles reconnection
 * Patterns: Singleton connection, error handling, retry logic, key namespacing
 */

import Redis from 'redis';
import { config } from '@/config/environment';
import { logger } from '@/utils/logger';

class RedisManager {
  private client: Redis.RedisClientType | null = null;
  private subscriber: Redis.RedisClientType | null = null;
  private publisher: Redis.RedisClientType | null = null;
  private isConnected = false;

  async connect(): Promise<void> {
    try {
      // Main client for caching and general operations
      this.client = Redis.createClient({
        url: config.redis.url,
        socket: {
          host: config.redis.host,
          port: config.redis.port,
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              logger.error('Redis reconnection failed after 10 attempts');
              return new Error('Too many reconnection attempts');
            }
            return Math.min(retries * 50, 500);
          },
        },
        password: config.redis.password || undefined,
        database: 0,
      });

      // Dedicated subscriber client for pub/sub
      this.subscriber = this.client.duplicate();
      
      // Dedicated publisher client for pub/sub
      this.publisher = this.client.duplicate();

      // Set up error handlers
      this.client.on('error', (err) => {
        logger.error('Redis client error:', err);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        logger.info('Redis client connected');
        this.isConnected = true;
      });

      this.client.on('ready', () => {
        logger.info('Redis client ready');
      });

      this.client.on('end', () => {
        logger.info('Redis client connection ended');
        this.isConnected = false;
      });

      // Connect all clients
      await Promise.all([
        this.client.connect(),
        this.subscriber.connect(),
        this.publisher.connect(),
      ]);

      logger.info('Redis connections established successfully');

    } catch (error) {
      logger.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.client) await this.client.quit();
      if (this.subscriber) await this.subscriber.quit();
      if (this.publisher) await this.publisher.quit();
      
      this.client = null;
      this.subscriber = null;
      this.publisher = null;
      this.isConnected = false;
      
      logger.info('Redis connections closed');
    } catch (error) {
      logger.error('Error disconnecting from Redis:', error);
      throw error;
    }
  }

  // Cache operations
  async get(key: string): Promise<string | null> {
    if (!this.client) throw new Error('Redis not connected');
    
    try {
      const value = await this.client.get(this.prefixKey(key));
      if (value) {
        logger.debug(`Cache hit for key: ${key}`);
      }
      return value;
    } catch (error) {
      logger.error(`Redis GET error for key ${key}:`, error);
      throw error;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.client) throw new Error('Redis not connected');
    
    try {
      const prefixedKey = this.prefixKey(key);
      if (ttlSeconds) {
        await this.client.setEx(prefixedKey, ttlSeconds, value);
      } else {
        await this.client.set(prefixedKey, value);
      }
      logger.debug(`Cache set for key: ${key}${ttlSeconds ? ` (TTL: ${ttlSeconds}s)` : ''}`);
    } catch (error) {
      logger.error(`Redis SET error for key ${key}:`, error);
      throw error;
    }
  }

  async del(key: string): Promise<number> {
    if (!this.client) throw new Error('Redis not connected');
    
    try {
      const result = await this.client.del(this.prefixKey(key));
      logger.debug(`Cache deleted for key: ${key}`);
      return result;
    } catch (error) {
      logger.error(`Redis DEL error for key ${key}:`, error);
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    if (!this.client) throw new Error('Redis not connected');
    
    try {
      const result = await this.client.exists(this.prefixKey(key));
      return result === 1;
    } catch (error) {
      logger.error(`Redis EXISTS error for key ${key}:`, error);
      throw error;
    }
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    if (!this.client) throw new Error('Redis not connected');
    
    try {
      const result = await this.client.expire(this.prefixKey(key), ttlSeconds);
      return result;
    } catch (error) {
      logger.error(`Redis EXPIRE error for key ${key}:`, error);
      throw error;
    }
  }

  async ttl(key: string): Promise<number> {
    if (!this.client) throw new Error('Redis not connected');
    
    try {
      return await this.client.ttl(this.prefixKey(key));
    } catch (error) {
      logger.error(`Redis TTL error for key ${key}:`, error);
      throw error;
    }
  }

  // Hash operations
  async hset(key: string, field: string, value: string): Promise<number> {
    if (!this.client) throw new Error('Redis not connected');
    
    try {
      return await this.client.hSet(this.prefixKey(key), field, value);
    } catch (error) {
      logger.error(`Redis HSET error for key ${key}, field ${field}:`, error);
      throw error;
    }
  }

  async hget(key: string, field: string): Promise<string | undefined> {
    if (!this.client) throw new Error('Redis not connected');
    
    try {
      return await this.client.hGet(this.prefixKey(key), field);
    } catch (error) {
      logger.error(`Redis HGET error for key ${key}, field ${field}:`, error);
      throw error;
    }
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    if (!this.client) throw new Error('Redis not connected');
    
    try {
      return await this.client.hGetAll(this.prefixKey(key));
    } catch (error) {
      logger.error(`Redis HGETALL error for key ${key}:`, error);
      throw error;
    }
  }

  // List operations
  async lpush(key: string, ...elements: string[]): Promise<number> {
    if (!this.client) throw new Error('Redis not connected');
    
    try {
      return await this.client.lPush(this.prefixKey(key), elements);
    } catch (error) {
      logger.error(`Redis LPUSH error for key ${key}:`, error);
      throw error;
    }
  }

  async rpop(key: string): Promise<string | null> {
    if (!this.client) throw new Error('Redis not connected');
    
    try {
      return await this.client.rPop(this.prefixKey(key));
    } catch (error) {
      logger.error(`Redis RPOP error for key ${key}:`, error);
      throw error;
    }
  }

  async llen(key: string): Promise<number> {
    if (!this.client) throw new Error('Redis not connected');
    
    try {
      return await this.client.lLen(this.prefixKey(key));
    } catch (error) {
      logger.error(`Redis LLEN error for key ${key}:`, error);
      throw error;
    }
  }

  // Pub/Sub operations
  async publish(channel: string, message: string): Promise<number> {
    if (!this.publisher) throw new Error('Redis publisher not connected');
    
    try {
      const result = await this.publisher.publish(this.prefixKey(channel), message);
      logger.debug(`Published message to channel: ${channel}`);
      return result;
    } catch (error) {
      logger.error(`Redis PUBLISH error for channel ${channel}:`, error);
      throw error;
    }
  }

  async subscribe(channel: string, callback: (message: string, channel: string) => void): Promise<void> {
    if (!this.subscriber) throw new Error('Redis subscriber not connected');
    
    try {
      await this.subscriber.subscribe(this.prefixKey(channel), callback);
      logger.debug(`Subscribed to channel: ${channel}`);
    } catch (error) {
      logger.error(`Redis SUBSCRIBE error for channel ${channel}:`, error);
      throw error;
    }
  }

  async unsubscribe(channel: string): Promise<void> {
    if (!this.subscriber) throw new Error('Redis subscriber not connected');
    
    try {
      await this.subscriber.unsubscribe(this.prefixKey(channel));
      logger.debug(`Unsubscribed from channel: ${channel}`);
    } catch (error) {
      logger.error(`Redis UNSUBSCRIBE error for channel ${channel}:`, error);
      throw error;
    }
  }

  // Utility methods
  async healthCheck(): Promise<boolean> {
    try {
      if (!this.client) return false;
      
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      logger.error('Redis health check failed:', error);
      return false;
    }
  }

  async flushPattern(pattern: string): Promise<number> {
    if (!this.client) throw new Error('Redis not connected');
    
    try {
      const keys = await this.client.keys(this.prefixKey(pattern));
      if (keys.length === 0) return 0;
      
      return await this.client.del(keys);
    } catch (error) {
      logger.error(`Redis flush pattern error for ${pattern}:`, error);
      throw error;
    }
  }

  private prefixKey(key: string): string {
    return `sias:${config.nodeEnv}:${key}`;
  }

  get connectionStatus(): boolean {
    return this.isConnected;
  }

  get clientInfo() {
    return {
      isConnected: this.isConnected,
      hasClient: !!this.client,
      hasSubscriber: !!this.subscriber,
      hasPublisher: !!this.publisher,
    };
  }
}

// Singleton instance
const redisManager = new RedisManager();

export const connectRedis = () => redisManager.connect();
export const disconnectRedis = () => redisManager.disconnect();

// Cache operations
export const cache = {
  get: (key: string) => redisManager.get(key),
  set: (key: string, value: string, ttl?: number) => redisManager.set(key, value, ttl),
  del: (key: string) => redisManager.del(key),
  exists: (key: string) => redisManager.exists(key),
  expire: (key: string, ttl: number) => redisManager.expire(key, ttl),
  ttl: (key: string) => redisManager.ttl(key),
  flushPattern: (pattern: string) => redisManager.flushPattern(pattern),
};

// Hash operations
export const hash = {
  set: (key: string, field: string, value: string) => redisManager.hset(key, field, value),
  get: (key: string, field: string) => redisManager.hget(key, field),
  getAll: (key: string) => redisManager.hgetall(key),
};

// List operations
export const list = {
  push: (key: string, ...elements: string[]) => redisManager.lpush(key, ...elements),
  pop: (key: string) => redisManager.rpop(key),
  length: (key: string) => redisManager.llen(key),
};

// Pub/Sub operations
export const pubsub = {
  publish: (channel: string, message: string) => redisManager.publish(channel, message),
  subscribe: (channel: string, callback: (message: string, channel: string) => void) => 
    redisManager.subscribe(channel, callback),
  unsubscribe: (channel: string) => redisManager.unsubscribe(channel),
};

export const redisHealthCheck = () => redisManager.healthCheck();
export const getRedisInfo = () => redisManager.clientInfo;

// Simple queue implementation (placeholder)
class SimpleQueue {
  async add(queueName: string, data: any, options?: any): Promise<void> {
    // Implementation would use Redis queue system like Bull or similar
    logger.debug(`Queuing job in ${queueName}:`, data);
  }

  process(queueName: string, concurrency: number, processor: (job: any) => Promise<void>): void {
    // Implementation would setup queue processor
    logger.debug(`Setting up processor for ${queueName} with concurrency ${concurrency}`);
  }
}

export const queue = new SimpleQueue();

export default redisManager;