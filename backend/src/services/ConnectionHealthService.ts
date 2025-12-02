/**
 * ConnectionHealthService - Per-connection health tracking and surfacing
 *
 * Per PRD_RATE_LIMIT_OBSERVABILITY:
 * - Per-connection API health widget (current rate usage, last 429)
 * - Per-job status
 * - Last-sync timestamps per product
 * - Surface errors in Activity Center
 */

import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';
import { prisma } from '../index';

// Health status for a connection
export interface ConnectionHealth {
  connectionId: string;
  status: 'HEALTHY' | 'DEGRADED' | 'ERROR' | 'OFFLINE';

  // Sync stats
  lastSyncAt: Date | null;
  lastInventorySyncAt: Date | null;
  lastCatalogSyncAt: Date | null;
  lastOrderForwardAt: Date | null;

  // Error tracking
  lastErrorAt: Date | null;
  lastError: string | null;
  errorCount24h: number;

  // Rate limit state
  isThrottled: boolean;
  throttledUntil: Date | null;

  // Queue stats
  pendingJobs: number;
  failedJobs: number;

  // Product mapping stats
  activeMappings: number;
  errorMappings: number;
  pendingMappings: number;
}

// Activity log entry
export interface ActivityEntry {
  id: string;
  connectionId: string;
  type:
    | 'SYNC_SUCCESS'
    | 'SYNC_ERROR'
    | 'INVENTORY_UPDATE'
    | 'CATALOG_UPDATE'
    | 'ORDER_FORWARD'
    | 'ORDER_PENDING'
    | 'ORDER_SHADOWED'
    | 'ORDER_PUSHED'
    | 'ORDER_PUSH_FAILED'
    | 'FULFILLMENT_SYNCED'
    | 'RATE_LIMIT'
    | 'MAPPING_ERROR'
    | 'SKU_DRIFT';
  resourceType: 'PRODUCT' | 'INVENTORY' | 'ORDER' | 'CONNECTION';
  resourceId?: string;
  message: string;
  details?: any;
  createdAt: Date;
}

const REDIS_PREFIX = 'cartrel:health:';
const ACTIVITY_PREFIX = 'cartrel:activity:';
const HEALTH_TTL_SECONDS = 300; // 5 minutes
const ACTIVITY_TTL_SECONDS = 86400; // 24 hours
const MAX_ACTIVITY_ENTRIES = 100;

class ConnectionHealthServiceClass {
  private redis: Redis | null = null;

  private getRedis(): Redis {
    if (!this.redis) {
      this.redis = new Redis(config.redisUrl, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      });
    }
    return this.redis;
  }

  /**
   * Get health status for a connection
   */
  async getHealth(connectionId: string): Promise<ConnectionHealth> {
    try {
      const redis = this.getRedis();
      const key = `${REDIS_PREFIX}${connectionId}`;
      const data = await redis.get(key);

      if (data) {
        const health = JSON.parse(data) as ConnectionHealth;
        // Parse dates
        health.lastSyncAt = health.lastSyncAt ? new Date(health.lastSyncAt) : null;
        health.lastInventorySyncAt = health.lastInventorySyncAt
          ? new Date(health.lastInventorySyncAt)
          : null;
        health.lastCatalogSyncAt = health.lastCatalogSyncAt
          ? new Date(health.lastCatalogSyncAt)
          : null;
        health.lastOrderForwardAt = health.lastOrderForwardAt
          ? new Date(health.lastOrderForwardAt)
          : null;
        health.lastErrorAt = health.lastErrorAt ? new Date(health.lastErrorAt) : null;
        health.throttledUntil = health.throttledUntil ? new Date(health.throttledUntil) : null;
        return health;
      }
    } catch (error) {
      logger.error('Error getting connection health:', error);
    }

    // Return default health
    return this.computeHealth(connectionId);
  }

  /**
   * Compute health from database (slow, cached)
   */
  async computeHealth(connectionId: string): Promise<ConnectionHealth> {
    try {
      // Get connection and mapping stats
      const [connection, mappingStats] = await Promise.all([
        prisma.connection.findUnique({
          where: { id: connectionId },
        }),
        prisma.productMapping.groupBy({
          by: ['status'],
          where: { connectionId },
          _count: true,
        }),
      ]);

      // Count mappings by status
      let activeMappings = 0;
      let errorMappings = 0;
      let pendingMappings = 0;

      for (const stat of mappingStats) {
        if (stat.status === 'ACTIVE') {
          activeMappings = stat._count;
        } else if (stat.status === 'REPLACED' || stat.status === 'UNSUPPORTED') {
          errorMappings += stat._count;
        } else if (stat.status === 'PAUSED' || stat.status === 'UNSYNCED') {
          pendingMappings += stat._count;
        }
      }

      // Get recent errors from mappings
      const recentErrors = await prisma.productMapping.count({
        where: {
          connectionId,
          lastErrorAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
      });

      // Determine status
      let status: 'HEALTHY' | 'DEGRADED' | 'ERROR' | 'OFFLINE' = 'HEALTHY';
      if (!connection || connection.status !== 'ACTIVE') {
        status = 'OFFLINE';
      } else if (recentErrors > 10 || errorMappings > activeMappings * 0.1) {
        status = 'ERROR';
      } else if (recentErrors > 0 || errorMappings > 0) {
        status = 'DEGRADED';
      }

      const health: ConnectionHealth = {
        connectionId,
        status,
        lastSyncAt: null,
        lastInventorySyncAt: null,
        lastCatalogSyncAt: null,
        lastOrderForwardAt: null,
        lastErrorAt: null,
        lastError: null,
        errorCount24h: recentErrors,
        isThrottled: false,
        throttledUntil: null,
        pendingJobs: 0,
        failedJobs: 0,
        activeMappings,
        errorMappings,
        pendingMappings,
      };

      // Cache the result
      await this.setHealth(connectionId, health);

      return health;
    } catch (error) {
      logger.error('Error computing connection health:', error);
      return this.defaultHealth(connectionId);
    }
  }

  /**
   * Update health after a sync operation
   */
  async recordSync(
    connectionId: string,
    type: 'INVENTORY' | 'CATALOG' | 'ORDER' | 'FULFILLMENT',
    success: boolean,
    error?: string
  ): Promise<void> {
    const health = await this.getHealth(connectionId);
    const now = new Date();

    health.lastSyncAt = now;

    switch (type) {
      case 'INVENTORY':
        health.lastInventorySyncAt = now;
        break;
      case 'CATALOG':
        health.lastCatalogSyncAt = now;
        break;
      case 'ORDER':
        health.lastOrderForwardAt = now;
        break;
    }

    if (!success && error) {
      health.lastErrorAt = now;
      health.lastError = error;
      health.errorCount24h++;
      health.status = health.errorCount24h > 10 ? 'ERROR' : 'DEGRADED';
    } else if (success && health.status === 'DEGRADED') {
      // Recover from degraded if no recent errors
      if (health.errorCount24h <= 1) {
        health.status = 'HEALTHY';
      }
    }

    await this.setHealth(connectionId, health);

    // Log activity
    await this.logActivity(connectionId, {
      type: success ? 'SYNC_SUCCESS' : 'SYNC_ERROR',
      resourceType: type === 'ORDER' ? 'ORDER' : type === 'INVENTORY' ? 'INVENTORY' : 'PRODUCT',
      message: success ? `${type} sync completed` : `${type} sync failed: ${error}`,
      details: error ? { error } : undefined,
    });
  }

  /**
   * Record a rate limit event
   */
  async recordRateLimit(connectionId: string, delayMs: number): Promise<void> {
    const health = await this.getHealth(connectionId);

    health.isThrottled = true;
    health.throttledUntil = new Date(Date.now() + delayMs);
    health.status = 'DEGRADED';

    await this.setHealth(connectionId, health);

    await this.logActivity(connectionId, {
      type: 'RATE_LIMIT',
      resourceType: 'CONNECTION',
      message: `Rate limited, backing off for ${delayMs}ms`,
      details: { delayMs },
    });
  }

  /**
   * Record a mapping error (SKU drift, conflicts, variant mismatches, etc.)
   */
  async recordMappingError(
    connectionId: string,
    mappingId: string,
    errorType: 'SKU_DRIFT' | 'CONFLICT' | 'UNSUPPORTED' | 'VARIANT_MISMATCH' | 'VALIDATION_FAILED',
    message: string
  ): Promise<void> {
    await this.logActivity(connectionId, {
      type: errorType === 'SKU_DRIFT' ? 'SKU_DRIFT' : 'MAPPING_ERROR',
      resourceType: 'PRODUCT',
      resourceId: mappingId,
      message,
      details: { errorType },
    });
  }

  /**
   * Log an activity entry
   */
  async logActivity(
    connectionId: string,
    entry: Omit<ActivityEntry, 'id' | 'connectionId' | 'createdAt'>
  ): Promise<void> {
    try {
      const redis = this.getRedis();
      const key = `${ACTIVITY_PREFIX}${connectionId}`;

      const fullEntry: ActivityEntry = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        connectionId,
        ...entry,
        createdAt: new Date(),
      };

      // Push to list, trim to max entries
      await redis.lpush(key, JSON.stringify(fullEntry));
      await redis.ltrim(key, 0, MAX_ACTIVITY_ENTRIES - 1);
      await redis.expire(key, ACTIVITY_TTL_SECONDS);
    } catch (error) {
      logger.error('Error logging activity:', error);
    }
  }

  /**
   * Get activity log for a connection
   */
  async getActivity(connectionId: string, limit: number = 50): Promise<ActivityEntry[]> {
    try {
      const redis = this.getRedis();
      const key = `${ACTIVITY_PREFIX}${connectionId}`;
      const entries = await redis.lrange(key, 0, limit - 1);

      return entries.map((e) => {
        const entry = JSON.parse(e) as ActivityEntry;
        entry.createdAt = new Date(entry.createdAt);
        return entry;
      });
    } catch (error) {
      logger.error('Error getting activity log:', error);
      return [];
    }
  }

  /**
   * Get health for multiple connections (for dashboard)
   */
  async getBulkHealth(connectionIds: string[]): Promise<Map<string, ConnectionHealth>> {
    const result = new Map<string, ConnectionHealth>();

    for (const id of connectionIds) {
      result.set(id, await this.getHealth(id));
    }

    return result;
  }

  /**
   * Get all connections with errors (for admin view)
   */
  async getConnectionsWithErrors(): Promise<ConnectionHealth[]> {
    try {
      const redis = this.getRedis();
      const keys = await redis.keys(`${REDIS_PREFIX}*`);
      const results: ConnectionHealth[] = [];

      for (const key of keys) {
        const data = await redis.get(key);
        if (data) {
          const health = JSON.parse(data) as ConnectionHealth;
          if (health.status === 'ERROR' || health.status === 'DEGRADED') {
            results.push(health);
          }
        }
      }

      return results;
    } catch (error) {
      logger.error('Error getting connections with errors:', error);
      return [];
    }
  }

  /**
   * Set health in cache
   */
  private async setHealth(connectionId: string, health: ConnectionHealth): Promise<void> {
    try {
      const redis = this.getRedis();
      const key = `${REDIS_PREFIX}${connectionId}`;
      await redis.setex(key, HEALTH_TTL_SECONDS, JSON.stringify(health));
    } catch (error) {
      logger.error('Error setting connection health:', error);
    }
  }

  /**
   * Default health for a connection
   */
  private defaultHealth(connectionId: string): ConnectionHealth {
    return {
      connectionId,
      status: 'HEALTHY',
      lastSyncAt: null,
      lastInventorySyncAt: null,
      lastCatalogSyncAt: null,
      lastOrderForwardAt: null,
      lastErrorAt: null,
      lastError: null,
      errorCount24h: 0,
      isThrottled: false,
      throttledUntil: null,
      pendingJobs: 0,
      failedJobs: 0,
      activeMappings: 0,
      errorMappings: 0,
      pendingMappings: 0,
    };
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
  }
}

export const ConnectionHealthService = new ConnectionHealthServiceClass();
