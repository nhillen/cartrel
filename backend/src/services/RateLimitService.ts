/**
 * RateLimitService - Track and manage Shopify API rate limits
 *
 * Per PRD_RATE_LIMIT_OBSERVABILITY:
 * - Inspect API headers for remaining calls/leaky bucket
 * - Detect 429s and slow down
 * - Dynamic throttling per store
 * - Exponential backoff with jitter
 * - DLQ for repeated failures
 * - Health surfacing per connection
 *
 * Shopify Rate Limits:
 * - REST: 40 requests/app/store, 2/second
 * - GraphQL: 50 points/second, 1000 bucket max
 * - Shopify Plus: 4x multiplier (request from Shopify)
 */

import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';
import { prisma } from '../index';
import { SystemComponent } from '@prisma/client';

// Rate limit state per shop
export interface RateLimitState {
  shopId: string;
  // REST API state
  restRemaining: number;
  restResetTime: Date | null;
  // GraphQL state
  graphqlPointsRemaining: number;
  graphqlThrottleStatus: 'OK' | 'APPROACHING' | 'THROTTLED';
  // Tracking
  consecutiveErrors: number;
  last429At: Date | null;
  lastRequestAt: Date | null;
  // Shopify Plus detection
  isShopifyPlus: boolean;
  rateMultiplier: number; // 1 for standard, 4 for Plus
  // Computed throttle delay (ms)
  currentDelayMs: number;
}

// Thresholds
const REST_APPROACHING_THRESHOLD = 10; // Warn when < 10 remaining
const GRAPHQL_APPROACHING_THRESHOLD = 100; // Warn when < 100 points
const MAX_CONSECUTIVE_ERRORS = 5;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60000;

// Redis key prefixes
const REDIS_PREFIX = 'cartrel:ratelimit:';
const STATE_TTL_SECONDS = 300; // 5 minutes

class RateLimitServiceClass {
  private redis: Redis | null = null;
  private localCache: Map<string, RateLimitState> = new Map();

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
   * Parse Shopify REST API rate limit headers
   * X-Shopify-Shop-Api-Call-Limit: "32/40"
   */
  parseRestHeaders(headers: Record<string, string | undefined>): {
    used: number;
    limit: number;
    remaining: number;
  } | null {
    const limitHeader = headers['x-shopify-shop-api-call-limit'];
    if (!limitHeader) return null;

    const match = limitHeader.match(/(\d+)\/(\d+)/);
    if (!match) return null;

    const used = parseInt(match[1], 10);
    const limit = parseInt(match[2], 10);

    return {
      used,
      limit,
      remaining: limit - used,
    };
  }

  /**
   * Parse Shopify GraphQL rate limit extension
   * extensions.cost.throttleStatus: { currentlyAvailable, restoreRate, maximumAvailable }
   */
  parseGraphQLExtensions(extensions: any): {
    available: number;
    restoreRate: number;
    maxAvailable: number;
    status: 'OK' | 'APPROACHING' | 'THROTTLED';
  } | null {
    const cost = extensions?.cost;
    if (!cost?.throttleStatus) return null;

    const { currentlyAvailable, restoreRate, maximumAvailable } = cost.throttleStatus;

    let status: 'OK' | 'APPROACHING' | 'THROTTLED' = 'OK';
    if (currentlyAvailable <= 0) {
      status = 'THROTTLED';
    } else if (currentlyAvailable < GRAPHQL_APPROACHING_THRESHOLD) {
      status = 'APPROACHING';
    }

    return {
      available: currentlyAvailable,
      restoreRate,
      maxAvailable: maximumAvailable,
      status,
    };
  }

  /**
   * Update rate limit state after a request
   */
  async updateState(
    shopId: string,
    updates: Partial<RateLimitState>,
    is429: boolean = false
  ): Promise<RateLimitState> {
    const current = await this.getState(shopId);

    const newState: RateLimitState = {
      ...current,
      ...updates,
      lastRequestAt: new Date(),
    };

    // Handle 429 errors
    if (is429) {
      newState.consecutiveErrors = current.consecutiveErrors + 1;
      newState.last429At = new Date();
      newState.currentDelayMs = this.calculateBackoff(newState.consecutiveErrors);

      // Log and record health
      logger.warn(`Rate limited (429) for shop ${shopId}`, {
        consecutiveErrors: newState.consecutiveErrors,
        delayMs: newState.currentDelayMs,
      });

      await this.recordHealthEvent(shopId, 'THROTTLED', newState.consecutiveErrors);
    } else {
      // Reset consecutive errors on success
      if (current.consecutiveErrors > 0) {
        newState.consecutiveErrors = 0;
        newState.currentDelayMs = 0;
      }
    }

    // Determine throttle status
    if (
      newState.restRemaining < REST_APPROACHING_THRESHOLD ||
      newState.graphqlThrottleStatus === 'APPROACHING'
    ) {
      newState.currentDelayMs = Math.max(newState.currentDelayMs, 500); // Min 500ms delay
    }

    // Persist state
    await this.setState(shopId, newState);

    return newState;
  }

  /**
   * Get current rate limit state for a shop
   */
  async getState(shopId: string): Promise<RateLimitState> {
    // Check local cache first
    const cached = this.localCache.get(shopId);
    if (cached && this.isStateValid(cached)) {
      return cached;
    }

    // Check Redis
    try {
      const redis = this.getRedis();
      const key = `${REDIS_PREFIX}${shopId}`;
      const data = await redis.get(key);

      if (data) {
        const state = JSON.parse(data) as RateLimitState;
        state.last429At = state.last429At ? new Date(state.last429At) : null;
        state.lastRequestAt = state.lastRequestAt ? new Date(state.lastRequestAt) : null;
        state.restResetTime = state.restResetTime ? new Date(state.restResetTime) : null;
        this.localCache.set(shopId, state);
        return state;
      }
    } catch (error) {
      logger.error('Error getting rate limit state from Redis:', error);
    }

    // Return default state
    return this.defaultState(shopId);
  }

  /**
   * Persist rate limit state
   */
  private async setState(shopId: string, state: RateLimitState): Promise<void> {
    this.localCache.set(shopId, state);

    try {
      const redis = this.getRedis();
      const key = `${REDIS_PREFIX}${shopId}`;
      await redis.setex(key, STATE_TTL_SECONDS, JSON.stringify(state));
    } catch (error) {
      logger.error('Error setting rate limit state in Redis:', error);
    }
  }

  /**
   * Default state for a shop
   */
  private defaultState(shopId: string): RateLimitState {
    return {
      shopId,
      restRemaining: 40,
      restResetTime: null,
      graphqlPointsRemaining: 1000,
      graphqlThrottleStatus: 'OK',
      consecutiveErrors: 0,
      last429At: null,
      lastRequestAt: null,
      isShopifyPlus: false,
      rateMultiplier: 1,
      currentDelayMs: 0,
    };
  }

  /**
   * Check if cached state is still valid
   */
  private isStateValid(state: RateLimitState): boolean {
    if (!state.lastRequestAt) return false;
    const age = Date.now() - new Date(state.lastRequestAt).getTime();
    return age < 60000; // Valid for 1 minute
  }

  /**
   * Calculate exponential backoff with jitter
   */
  calculateBackoff(errorCount: number): number {
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, capped at 60s
    const exponentialDelay = Math.min(
      BASE_BACKOFF_MS * Math.pow(2, errorCount - 1),
      MAX_BACKOFF_MS
    );

    // Add jitter (±25%)
    const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1);

    return Math.round(exponentialDelay + jitter);
  }

  /**
   * Check if we should delay before making a request
   * Returns delay in ms (0 = no delay needed)
   */
  async getRequiredDelay(shopId: string): Promise<number> {
    const state = await this.getState(shopId);

    // If we're over the error threshold, use DLQ instead
    if (state.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      return -1; // Signal to use DLQ
    }

    return state.currentDelayMs;
  }

  /**
   * Check if a shop should use DLQ (too many errors)
   */
  async shouldUseDLQ(shopId: string): Promise<boolean> {
    const state = await this.getState(shopId);
    return state.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS;
  }

  /**
   * Record a health event for observability
   */
  async recordHealthEvent(
    _shopId: string,
    status: 'OK' | 'THROTTLED' | 'ERROR',
    errorCount?: number
  ): Promise<void> {
    try {
      await prisma.systemHealth.create({
        data: {
          component: SystemComponent.WEBHOOKS,
          healthy: status === 'OK',
          webhookErrorRate: errorCount ? errorCount / 10 : 0, // Rough error rate
        },
      });
    } catch (error) {
      logger.error('Error recording health event:', error);
    }
  }

  /**
   * Get health status for all shops (for admin dashboard)
   */
  async getHealthSummary(): Promise<{
    healthy: number;
    throttled: number;
    erroring: number;
    shops: Array<{ shopId: string; status: string; errors: number }>;
  }> {
    const shops: Array<{ shopId: string; status: string; errors: number }> = [];
    let healthy = 0;
    let throttled = 0;
    let erroring = 0;

    try {
      const redis = this.getRedis();
      const keys = await redis.keys(`${REDIS_PREFIX}*`);

      for (const key of keys) {
        const data = await redis.get(key);
        if (data) {
          const state = JSON.parse(data) as RateLimitState;
          let status = 'healthy';

          if (state.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            status = 'erroring';
            erroring++;
          } else if (state.consecutiveErrors > 0 || state.graphqlThrottleStatus === 'THROTTLED') {
            status = 'throttled';
            throttled++;
          } else {
            healthy++;
          }

          shops.push({
            shopId: state.shopId,
            status,
            errors: state.consecutiveErrors,
          });
        }
      }
    } catch (error) {
      logger.error('Error getting health summary:', error);
    }

    return { healthy, throttled, erroring, shops };
  }

  /**
   * Reset rate limit state for a shop (after manual intervention)
   */
  async resetState(shopId: string): Promise<void> {
    this.localCache.delete(shopId);

    try {
      const redis = this.getRedis();
      const key = `${REDIS_PREFIX}${shopId}`;
      await redis.del(key);
    } catch (error) {
      logger.error('Error resetting rate limit state:', error);
    }
  }

  /**
   * Detect Shopify Plus from API response (higher limits)
   * Plus stores have 4x the rate limit
   */
  async detectShopifyPlus(targetShopId: string, limit: number): Promise<boolean> {
    // Standard limit is 40, Plus is 80 or higher (4x = 160)
    const isPlus = limit >= 80;

    if (isPlus) {
      const state = await this.getState(targetShopId);
      if (!state.isShopifyPlus) {
        await this.updateState(targetShopId, {
          isShopifyPlus: true,
          rateMultiplier: limit / 40,
        });
        logger.info(`Detected Shopify Plus for shop ${targetShopId}, multiplier: ${limit / 40}`);
      }
    }

    return isPlus;
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

export const RateLimitService = new RateLimitServiceClass();
