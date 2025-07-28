/**
 * @fileoverview Service initialization and dependency injection
 * @lastmodified 2025-07-27T23:15:00Z
 * 
 * Features: Service container, dependency injection, service lifecycle management
 * Main APIs: Service initialization, dependency resolution, health checks
 * Constraints: Services must be initialized in dependency order
 * Patterns: Singleton services, factory pattern, dependency injection
 */

import { logger } from '@/utils/logger';

// Service registry type
type ServiceConstructor<T = any> = new (...args: any[]) => T;
type ServiceFactory<T = any> = (...args: any[]) => T;
type ServiceDefinition<T = any> = ServiceConstructor<T> | ServiceFactory<T>;

interface ServiceConfig {
  singleton?: boolean;
  dependencies?: string[];
  factory?: boolean;
}

class ServiceContainer {
  private services = new Map<string, any>();
  private definitions = new Map<string, ServiceDefinition>();
  private configs = new Map<string, ServiceConfig>();
  private initialized = new Set<string>();

  register<T>(
    name: string,
    definition: ServiceDefinition<T>,
    config: ServiceConfig = {}
  ): void {
    this.definitions.set(name, definition);
    this.configs.set(name, {
      singleton: true,
      dependencies: [],
      factory: false,
      ...config,
    });
  }

  async get<T>(name: string): Promise<T> {
    const config = this.configs.get(name);
    
    if (!config) {
      throw new Error(`Service '${name}' not found`);
    }

    // Return existing instance if singleton
    if (config.singleton && this.services.has(name)) {
      return this.services.get(name);
    }

    // Resolve dependencies first
    const dependencies = await this.resolveDependencies(config.dependencies || []);

    // Get service definition
    const definition = this.definitions.get(name);
    if (!definition) {
      throw new Error(`Service definition for '${name}' not found`);
    }

    // Create instance
    let instance: T;
    if (config.factory) {
      instance = (definition as ServiceFactory<T>)(...dependencies);
    } else {
      instance = new (definition as ServiceConstructor<T>)(...dependencies);
    }

    // Store if singleton
    if (config.singleton) {
      this.services.set(name, instance);
    }

    return instance;
  }

  async initialize(serviceName: string): Promise<void> {
    if (this.initialized.has(serviceName)) {
      return;
    }

    const service = await this.get(serviceName);
    
    // Call initialize method if it exists
    if (service && typeof (service as any).initialize === 'function') {
      await (service as any).initialize();
    }

    this.initialized.add(serviceName);
    logger.info(`Service '${serviceName}' initialized`);
  }

  async initializeAll(): Promise<void> {
    const serviceNames = Array.from(this.definitions.keys());
    
    // Initialize services in dependency order
    for (const serviceName of serviceNames) {
      await this.initialize(serviceName);
    }
  }

  private async resolveDependencies(dependencies: string[]): Promise<any[]> {
    const resolved = [];
    
    for (const dep of dependencies) {
      resolved.push(await this.get(dep));
    }
    
    return resolved;
  }

  async healthCheck(): Promise<Record<string, boolean>> {
    const health: Record<string, boolean> = {};
    
    for (const [name, service] of this.services) {
      try {
        if (service && typeof service.healthCheck === 'function') {
          health[name] = await service.healthCheck();
        } else {
          health[name] = true; // Assume healthy if no health check method
        }
      } catch (error) {
        logger.error(`Health check failed for service '${name}':`, error);
        health[name] = false;
      }
    }
    
    return health;
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down services...');
    
    for (const [name, service] of this.services) {
      try {
        if (service && typeof service.shutdown === 'function') {
          await service.shutdown();
          logger.info(`Service '${name}' shut down`);
        }
      } catch (error) {
        logger.error(`Error shutting down service '${name}':`, error);
      }
    }
    
    this.services.clear();
    this.initialized.clear();
  }
}

// Global service container
const container = new ServiceContainer();

// Service base class with common functionality
export abstract class BaseService {
  protected logger = logger;
  
  abstract initialize(): Promise<void>;
  
  async healthCheck(): Promise<boolean> {
    return true;
  }
  
  async shutdown(): Promise<void> {
    // Override in child classes if needed
  }
}

// Placeholder service implementations
class DatabaseService extends BaseService {
  async initialize(): Promise<void> {
    this.logger.info('DatabaseService initialized');
  }
  
  async healthCheck(): Promise<boolean> {
    // TODO: Implement actual database health check
    return true;
  }
}

class CacheService extends BaseService {
  async initialize(): Promise<void> {
    this.logger.info('CacheService initialized');
  }
  
  async healthCheck(): Promise<boolean> {
    // TODO: Implement actual cache health check
    return true;
  }
}

class AlertService extends BaseService {
  constructor(
    private databaseService: DatabaseService,
    private cacheService: CacheService
  ) {
    super();
  }
  
  async initialize(): Promise<void> {
    this.logger.info('AlertService initialized');
  }
}

class NotificationService extends BaseService {
  constructor(private cacheService: CacheService) {
    super();
  }
  
  async initialize(): Promise<void> {
    this.logger.info('NotificationService initialized');
  }
}

class IntegrationService extends BaseService {
  async initialize(): Promise<void> {
    this.logger.info('IntegrationService initialized');
  }
}

class VisualizationService extends BaseService {
  async initialize(): Promise<void> {
    this.logger.info('VisualizationService initialized');
  }
}

// Register services with dependencies
container.register('databaseService', DatabaseService);
container.register('cacheService', CacheService);
container.register('alertService', AlertService, {
  dependencies: ['databaseService', 'cacheService'],
});
container.register('notificationService', NotificationService, {
  dependencies: ['cacheService'],
});
container.register('integrationService', IntegrationService);
container.register('visualizationService', VisualizationService);

// Initialize all services
export const initializeServices = async (): Promise<void> => {
  try {
    await container.initializeAll();
    logger.info('All services initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize services:', error);
    throw error;
  }
};

// Get service instance
export const getService = <T>(name: string): Promise<T> => {
  return container.get<T>(name);
};

// Health check for all services
export const servicesHealthCheck = async (): Promise<Record<string, boolean>> => {
  return container.healthCheck();
};

// Shutdown all services
export const shutdownServices = async (): Promise<void> => {
  return container.shutdown();
};

// Export service types for dependency injection
export {
  DatabaseService,
  CacheService,
  AlertService,
  NotificationService,
  IntegrationService,
  VisualizationService,
};