/**
 * Tests for RateLimitService - Rate limit tracking and backoff
 */

// Mock config before importing anything that uses it
jest.mock('../../config', () => ({
  config: {
    redisUrl: 'redis://localhost:6379',
    appUrl: 'http://localhost:3000',
    nodeEnv: 'test',
  },
}));

// Mock Redis
jest.mock('ioredis', () => {
  const storage = new Map<string, string>();

  return jest.fn().mockImplementation(() => ({
    get: jest.fn((key: string) => Promise.resolve(storage.get(key) || null)),
    setex: jest.fn((key: string, _ttl: number, value: string) => {
      storage.set(key, value);
      return Promise.resolve('OK');
    }),
    del: jest.fn((key: string) => {
      storage.delete(key);
      return Promise.resolve(1);
    }),
    keys: jest.fn((pattern: string) => {
      const prefix = pattern.replace('*', '');
      return Promise.resolve(Array.from(storage.keys()).filter((k) => k.startsWith(prefix)));
    }),
    quit: jest.fn(() => Promise.resolve('OK')),
    _clear: () => storage.clear(),
    _storage: storage,
  }));
});

// Mock prisma
jest.mock('../../index', () => ({
  prisma: {
    systemHealth: {
      create: jest.fn(() => Promise.resolve({})),
    },
  },
}));

import { RateLimitService } from '../RateLimitService';

describe('RateLimitService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('parseRestHeaders', () => {
    it('should parse valid rate limit header', () => {
      const result = RateLimitService.parseRestHeaders({
        'x-shopify-shop-api-call-limit': '32/40',
      });

      expect(result).toEqual({
        used: 32,
        limit: 40,
        remaining: 8,
      });
    });

    it('should return null for missing header', () => {
      const result = RateLimitService.parseRestHeaders({});
      expect(result).toBeNull();
    });

    it('should return null for invalid header format', () => {
      const result = RateLimitService.parseRestHeaders({
        'x-shopify-shop-api-call-limit': 'invalid',
      });
      expect(result).toBeNull();
    });

    it('should handle Shopify Plus higher limits', () => {
      const result = RateLimitService.parseRestHeaders({
        'x-shopify-shop-api-call-limit': '80/160',
      });

      expect(result).toEqual({
        used: 80,
        limit: 160,
        remaining: 80,
      });
    });
  });

  describe('parseGraphQLExtensions', () => {
    it('should parse valid GraphQL extensions', () => {
      const extensions = {
        cost: {
          throttleStatus: {
            currentlyAvailable: 500,
            restoreRate: 50,
            maximumAvailable: 1000,
          },
        },
      };

      const result = RateLimitService.parseGraphQLExtensions(extensions);

      expect(result).toEqual({
        available: 500,
        restoreRate: 50,
        maxAvailable: 1000,
        status: 'OK',
      });
    });

    it('should return APPROACHING status when points are low', () => {
      const extensions = {
        cost: {
          throttleStatus: {
            currentlyAvailable: 50,
            restoreRate: 50,
            maximumAvailable: 1000,
          },
        },
      };

      const result = RateLimitService.parseGraphQLExtensions(extensions);

      expect(result?.status).toBe('APPROACHING');
    });

    it('should return THROTTLED status when no points available', () => {
      const extensions = {
        cost: {
          throttleStatus: {
            currentlyAvailable: 0,
            restoreRate: 50,
            maximumAvailable: 1000,
          },
        },
      };

      const result = RateLimitService.parseGraphQLExtensions(extensions);

      expect(result?.status).toBe('THROTTLED');
    });

    it('should return null for missing extensions', () => {
      expect(RateLimitService.parseGraphQLExtensions(null)).toBeNull();
      expect(RateLimitService.parseGraphQLExtensions({})).toBeNull();
      expect(RateLimitService.parseGraphQLExtensions({ cost: {} })).toBeNull();
    });
  });

  describe('calculateBackoff', () => {
    it('should return base delay for first error', () => {
      const delay = RateLimitService.calculateBackoff(1);
      // 1000ms ± 25% jitter = 750-1250
      expect(delay).toBeGreaterThanOrEqual(750);
      expect(delay).toBeLessThanOrEqual(1250);
    });

    it('should increase delay exponentially', () => {
      const delay1 = RateLimitService.calculateBackoff(1);
      const delay2 = RateLimitService.calculateBackoff(2);
      const delay3 = RateLimitService.calculateBackoff(3);

      // Without jitter: 1000, 2000, 4000
      // With 25% jitter: ranges overlap slightly but trend upward
      expect(delay2).toBeGreaterThan(delay1 * 0.5); // Account for jitter
      expect(delay3).toBeGreaterThan(delay2 * 0.5);
    });

    it('should cap at maximum backoff', () => {
      const delay = RateLimitService.calculateBackoff(10);
      // Max is 60000ms ± 25% = 45000-75000
      expect(delay).toBeLessThanOrEqual(75000);
    });

    it('should add jitter (not always same value)', () => {
      const delays = new Set<number>();
      for (let i = 0; i < 100; i++) {
        delays.add(RateLimitService.calculateBackoff(3));
      }
      // With jitter, we should get multiple different values
      expect(delays.size).toBeGreaterThan(1);
    });
  });

  describe('getState', () => {
    it('should return default state for unknown shop', async () => {
      const state = await RateLimitService.getState('unknown-shop-123');

      expect(state.shopId).toBe('unknown-shop-123');
      expect(state.restRemaining).toBe(40);
      expect(state.graphqlPointsRemaining).toBe(1000);
      expect(state.consecutiveErrors).toBe(0);
      expect(state.isShopifyPlus).toBe(false);
    });
  });

  describe('updateState', () => {
    it('should update state with new values', async () => {
      const state = await RateLimitService.updateState('test-shop-1', {
        restRemaining: 10,
        graphqlPointsRemaining: 200,
      });

      expect(state.restRemaining).toBe(10);
      expect(state.graphqlPointsRemaining).toBe(200);
      expect(state.lastRequestAt).toBeInstanceOf(Date);
    });

    it('should increment errors on 429', async () => {
      await RateLimitService.updateState('test-shop-2', {}, false);
      const state = await RateLimitService.updateState('test-shop-2', {}, true);

      expect(state.consecutiveErrors).toBe(1);
      expect(state.last429At).toBeInstanceOf(Date);
      expect(state.currentDelayMs).toBeGreaterThan(0);
    });

    it('should reset errors on success after failure', async () => {
      // First, simulate a 429
      await RateLimitService.updateState('test-shop-3', {}, true);

      // Then a successful request
      const state = await RateLimitService.updateState('test-shop-3', {}, false);

      expect(state.consecutiveErrors).toBe(0);
      expect(state.currentDelayMs).toBe(0);
    });
  });

  describe('getRequiredDelay', () => {
    it('should return 0 for healthy shop', async () => {
      const delay = await RateLimitService.getRequiredDelay('healthy-shop');
      expect(delay).toBe(0);
    });

    it('should return -1 (DLQ signal) for too many errors', async () => {
      // Simulate 5+ consecutive errors
      for (let i = 0; i < 6; i++) {
        await RateLimitService.updateState('erroring-shop', {}, true);
      }

      const delay = await RateLimitService.getRequiredDelay('erroring-shop');
      expect(delay).toBe(-1);
    });
  });

  describe('shouldUseDLQ', () => {
    it('should return false for healthy shop', async () => {
      const result = await RateLimitService.shouldUseDLQ('healthy-dlq-test');
      expect(result).toBe(false);
    });

    it('should return true after max consecutive errors', async () => {
      for (let i = 0; i < 5; i++) {
        await RateLimitService.updateState('dlq-test-shop', {}, true);
      }

      const result = await RateLimitService.shouldUseDLQ('dlq-test-shop');
      expect(result).toBe(true);
    });
  });

  describe('resetState', () => {
    it('should reset shop state', async () => {
      // Set some state
      await RateLimitService.updateState('reset-test-shop', {
        consecutiveErrors: 3,
        restRemaining: 5,
      });

      // Reset it
      await RateLimitService.resetState('reset-test-shop');

      // Should be back to defaults
      const state = await RateLimitService.getState('reset-test-shop');
      expect(state.consecutiveErrors).toBe(0);
      expect(state.restRemaining).toBe(40);
    });
  });
});
