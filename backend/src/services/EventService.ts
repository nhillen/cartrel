/**
 * EventService - Idempotent event processing with deduplication
 *
 * Per PRD_RATE_LIMIT_OBSERVABILITY:
 * - Dedupe all incoming events
 * - Retries with exponential backoff + DLQ
 * - Priority: orders/inventory > product field updates
 *
 * Idempotency Strategy:
 * - Generate idempotency key from: shopId + topic + resourceId + updateHash
 * - Store processed keys in Redis with TTL (24h)
 * - Check before processing, skip if already processed
 */

import crypto from 'crypto';
import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';
import { WebhookTopic } from '@prisma/client';

// Event priority levels (lower = higher priority)
export enum EventPriority {
  CRITICAL = 1, // App uninstall, order create
  HIGH = 2, // Inventory updates, order updates
  NORMAL = 3, // Product updates
  LOW = 4, // Product creates, bulk operations
}

export interface NormalizedEvent {
  idempotencyKey: string;
  shopId: string;
  topic: WebhookTopic;
  resourceId: string;
  resourceType: 'PRODUCT' | 'VARIANT' | 'INVENTORY' | 'ORDER' | 'APP';
  priority: EventPriority;
  payload: any;
  payloadHash: string;
  receivedAt: Date;
  connectionIds?: string[]; // Affected connections (for fan-out)
}

// TTL for idempotency keys (24 hours)
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

// Prefix for Redis keys
const REDIS_PREFIX = 'cartrel:event:';

class EventServiceClass {
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
   * Generate idempotency key for an event
   * Key format: shopId:topic:resourceId:payloadHash
   */
  generateIdempotencyKey(
    shopId: string,
    topic: WebhookTopic,
    resourceId: string,
    payload: any
  ): string {
    const payloadHash = this.hashPayload(payload);
    return `${shopId}:${topic}:${resourceId}:${payloadHash}`;
  }

  /**
   * Hash payload to detect duplicate events with same content
   * We only hash relevant fields to avoid false negatives from timestamp changes
   */
  hashPayload(payload: any): string {
    // Extract only the fields that matter for deduplication
    const relevantData = this.extractRelevantFields(payload);
    const jsonStr = JSON.stringify(relevantData);
    return crypto.createHash('sha256').update(jsonStr).digest('hex').substring(0, 16);
  }

  /**
   * Extract fields relevant for deduplication
   * Excludes timestamps and other fields that change on every event
   */
  private extractRelevantFields(payload: any): any {
    if (!payload || typeof payload !== 'object') {
      return payload;
    }

    // For products: include key fields, exclude updated_at
    if (payload.title !== undefined && payload.variants !== undefined) {
      return {
        id: payload.id,
        title: payload.title,
        status: payload.status,
        variants: payload.variants?.map((v: any) => ({
          id: v.id,
          sku: v.sku,
          price: v.price,
          inventory_quantity: v.inventory_quantity,
        })),
      };
    }

    // For inventory: include all fields (they're all relevant)
    if (payload.inventory_item_id !== undefined) {
      return {
        inventory_item_id: payload.inventory_item_id,
        location_id: payload.location_id,
        available: payload.available,
      };
    }

    // For orders: key fields
    if (payload.order_number !== undefined || payload.financial_status !== undefined) {
      return {
        id: payload.id,
        order_number: payload.order_number,
        financial_status: payload.financial_status,
        fulfillment_status: payload.fulfillment_status,
        line_items: payload.line_items?.map((li: any) => ({
          id: li.id,
          quantity: li.quantity,
          fulfillable_quantity: li.fulfillable_quantity,
        })),
        fulfillments: payload.fulfillments?.map((f: any) => ({
          id: f.id,
          status: f.status,
          tracking_number: f.tracking_number,
        })),
      };
    }

    // Default: use whole payload (for app/uninstalled, etc.)
    return payload;
  }

  /**
   * Normalize a webhook into a standardized event
   */
  normalizeEvent(
    shopId: string,
    topic: WebhookTopic,
    resourceId: string,
    payload: any
  ): NormalizedEvent {
    const idempotencyKey = this.generateIdempotencyKey(shopId, topic, resourceId, payload);
    const payloadHash = this.hashPayload(payload);

    return {
      idempotencyKey,
      shopId,
      topic,
      resourceId,
      resourceType: this.getResourceType(topic),
      priority: this.getPriority(topic),
      payload,
      payloadHash,
      receivedAt: new Date(),
    };
  }

  /**
   * Check if an event has already been processed
   */
  async isProcessed(idempotencyKey: string): Promise<boolean> {
    try {
      const redis = this.getRedis();
      const key = `${REDIS_PREFIX}${idempotencyKey}`;
      const exists = await redis.exists(key);
      return exists === 1;
    } catch (error) {
      logger.error('Error checking idempotency key:', error);
      // On Redis error, allow processing (better to duplicate than lose)
      return false;
    }
  }

  /**
   * Mark an event as processed
   */
  async markProcessed(idempotencyKey: string, result?: any): Promise<void> {
    try {
      const redis = this.getRedis();
      const key = `${REDIS_PREFIX}${idempotencyKey}`;
      const value = JSON.stringify({
        processedAt: new Date().toISOString(),
        result: result || 'success',
      });
      await redis.setex(key, IDEMPOTENCY_TTL_SECONDS, value);
    } catch (error) {
      logger.error('Error marking event as processed:', error);
      // Don't throw - processing succeeded, just couldn't mark it
    }
  }

  /**
   * Process an event with idempotency check
   * Returns: { processed: boolean, skipped: boolean, result?: any, error?: Error }
   */
  async processWithIdempotency<T>(
    event: NormalizedEvent,
    processor: () => Promise<T>
  ): Promise<{ processed: boolean; skipped: boolean; result?: T; error?: Error }> {
    // Check if already processed
    const alreadyProcessed = await this.isProcessed(event.idempotencyKey);

    if (alreadyProcessed) {
      logger.info(`Event already processed, skipping: ${event.idempotencyKey}`);
      return { processed: false, skipped: true };
    }

    try {
      const result = await processor();
      await this.markProcessed(event.idempotencyKey, result);
      return { processed: true, skipped: false, result };
    } catch (error) {
      // Don't mark as processed on error - allow retry
      return {
        processed: false,
        skipped: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Get resource type from topic
   */
  private getResourceType(
    topic: WebhookTopic
  ): 'PRODUCT' | 'VARIANT' | 'INVENTORY' | 'ORDER' | 'APP' {
    switch (topic) {
      case 'PRODUCTS_CREATE':
      case 'PRODUCTS_UPDATE':
      case 'PRODUCTS_DELETE':
        return 'PRODUCT';
      case 'INVENTORY_LEVELS_UPDATE':
        return 'INVENTORY';
      case 'ORDERS_CREATE':
      case 'ORDERS_UPDATED':
        return 'ORDER';
      case 'APP_UNINSTALLED':
        return 'APP';
      default:
        return 'PRODUCT';
    }
  }

  /**
   * Get priority for a topic (used for queue prioritization)
   */
  getPriority(topic: WebhookTopic): EventPriority {
    switch (topic) {
      case 'APP_UNINSTALLED':
        return EventPriority.CRITICAL;
      case 'ORDERS_CREATE':
        return EventPriority.CRITICAL;
      case 'ORDERS_UPDATED':
      case 'INVENTORY_LEVELS_UPDATE':
        return EventPriority.HIGH;
      case 'PRODUCTS_UPDATE':
        return EventPriority.NORMAL;
      case 'PRODUCTS_CREATE':
      case 'PRODUCTS_DELETE':
        return EventPriority.LOW;
      default:
        return EventPriority.NORMAL;
    }
  }

  /**
   * Clean up old idempotency keys (called periodically)
   * Redis TTL handles this automatically, but this can be used for manual cleanup
   */
  async cleanup(): Promise<number> {
    // Redis TTL handles cleanup automatically
    // This method exists for future use if we need manual intervention
    return 0;
  }

  /**
   * Get stats about processed events (for observability)
   */
  async getStats(): Promise<{ totalKeys: number }> {
    try {
      const redis = this.getRedis();
      const keys = await redis.keys(`${REDIS_PREFIX}*`);
      return { totalKeys: keys.length };
    } catch (error) {
      logger.error('Error getting event stats:', error);
      return { totalKeys: 0 };
    }
  }

  /**
   * Close Redis connection (for graceful shutdown)
   */
  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
  }
}

export const EventService = new EventServiceClass();
