/**
 * Tests for EventService - Idempotency and deduplication
 *
 * These tests verify:
 * 1. Idempotency key generation is deterministic
 * 2. Duplicate events are detected and skipped
 * 3. Different events get different keys
 * 4. Payload hashing ignores irrelevant fields (timestamps)
 * 5. Priority assignment is correct
 */

// Mock config before importing anything that uses it
jest.mock('../../config', () => ({
  config: {
    redisUrl: 'redis://localhost:6379',
    appUrl: 'http://localhost:3000',
    nodeEnv: 'test',
  },
}));

// Mock Redis for unit tests
jest.mock('ioredis', () => {
  const storage = new Map<string, string>();

  return jest.fn().mockImplementation(() => ({
    exists: jest.fn((key: string) => Promise.resolve(storage.has(key) ? 1 : 0)),
    setex: jest.fn((key: string, _ttl: number, value: string) => {
      storage.set(key, value);
      return Promise.resolve('OK');
    }),
    get: jest.fn((key: string) => Promise.resolve(storage.get(key) || null)),
    keys: jest.fn((pattern: string) => {
      const prefix = pattern.replace('*', '');
      return Promise.resolve(
        Array.from(storage.keys()).filter((k) => k.startsWith(prefix))
      );
    }),
    del: jest.fn((key: string) => {
      storage.delete(key);
      return Promise.resolve(1);
    }),
    quit: jest.fn(() => Promise.resolve('OK')),
    // For clearing between tests
    _clear: () => storage.clear(),
    _storage: storage,
  }));
});

import { EventService, EventPriority } from '../EventService';

describe('EventService', () => {
  beforeEach(() => {
    // Clear Redis mock storage between tests
    jest.clearAllMocks();
  });

  describe('generateIdempotencyKey', () => {
    it('should generate deterministic keys for same input', () => {
      const payload = { id: 123, title: 'Test Product', variants: [] };

      const key1 = EventService.generateIdempotencyKey(
        'shop1',
        'PRODUCTS_UPDATE',
        '123',
        payload
      );

      const key2 = EventService.generateIdempotencyKey(
        'shop1',
        'PRODUCTS_UPDATE',
        '123',
        payload
      );

      expect(key1).toBe(key2);
    });

    it('should generate different keys for different shops', () => {
      const payload = { id: 123, title: 'Test Product', variants: [] };

      const key1 = EventService.generateIdempotencyKey(
        'shop1',
        'PRODUCTS_UPDATE',
        '123',
        payload
      );

      const key2 = EventService.generateIdempotencyKey(
        'shop2',
        'PRODUCTS_UPDATE',
        '123',
        payload
      );

      expect(key1).not.toBe(key2);
    });

    it('should generate different keys for different topics', () => {
      const payload = { id: 123, title: 'Test Product', variants: [] };

      const key1 = EventService.generateIdempotencyKey(
        'shop1',
        'PRODUCTS_CREATE',
        '123',
        payload
      );

      const key2 = EventService.generateIdempotencyKey(
        'shop1',
        'PRODUCTS_UPDATE',
        '123',
        payload
      );

      expect(key1).not.toBe(key2);
    });

    it('should generate different keys for different resource IDs', () => {
      const payload = { id: 123, title: 'Test Product', variants: [] };

      const key1 = EventService.generateIdempotencyKey(
        'shop1',
        'PRODUCTS_UPDATE',
        '123',
        payload
      );

      const key2 = EventService.generateIdempotencyKey(
        'shop1',
        'PRODUCTS_UPDATE',
        '456',
        payload
      );

      expect(key1).not.toBe(key2);
    });

    it('should generate different keys for different payloads', () => {
      const payload1 = { id: 123, title: 'Test Product', variants: [] };
      const payload2 = { id: 123, title: 'Updated Product', variants: [] };

      const key1 = EventService.generateIdempotencyKey(
        'shop1',
        'PRODUCTS_UPDATE',
        '123',
        payload1
      );

      const key2 = EventService.generateIdempotencyKey(
        'shop1',
        'PRODUCTS_UPDATE',
        '123',
        payload2
      );

      expect(key1).not.toBe(key2);
    });
  });

  describe('hashPayload', () => {
    it('should ignore updated_at timestamps for products', () => {
      const payload1 = {
        id: 123,
        title: 'Test Product',
        status: 'active',
        variants: [{ id: 1, sku: 'SKU1', price: '10.00', inventory_quantity: 5 }],
        updated_at: '2024-01-01T00:00:00Z',
      };

      const payload2 = {
        id: 123,
        title: 'Test Product',
        status: 'active',
        variants: [{ id: 1, sku: 'SKU1', price: '10.00', inventory_quantity: 5 }],
        updated_at: '2024-01-02T00:00:00Z', // Different timestamp
      };

      const hash1 = EventService.hashPayload(payload1);
      const hash2 = EventService.hashPayload(payload2);

      expect(hash1).toBe(hash2);
    });

    it('should detect actual content changes', () => {
      const payload1 = {
        id: 123,
        title: 'Test Product',
        status: 'active',
        variants: [{ id: 1, sku: 'SKU1', price: '10.00', inventory_quantity: 5 }],
      };

      const payload2 = {
        id: 123,
        title: 'Test Product',
        status: 'active',
        variants: [{ id: 1, sku: 'SKU1', price: '15.00', inventory_quantity: 5 }], // Price changed
      };

      const hash1 = EventService.hashPayload(payload1);
      const hash2 = EventService.hashPayload(payload2);

      expect(hash1).not.toBe(hash2);
    });

    it('should handle inventory payloads correctly', () => {
      const payload1 = {
        inventory_item_id: 123,
        location_id: 456,
        available: 10,
      };

      const payload2 = {
        inventory_item_id: 123,
        location_id: 456,
        available: 10,
      };

      const payload3 = {
        inventory_item_id: 123,
        location_id: 456,
        available: 15, // Different quantity
      };

      const hash1 = EventService.hashPayload(payload1);
      const hash2 = EventService.hashPayload(payload2);
      const hash3 = EventService.hashPayload(payload3);

      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hash3);
    });

    it('should handle order payloads correctly', () => {
      const payload1 = {
        id: 123,
        order_number: 1001,
        financial_status: 'pending',
        fulfillment_status: null,
        line_items: [{ id: 1, quantity: 2, fulfillable_quantity: 2 }],
        fulfillments: [],
      };

      const payload2 = {
        id: 123,
        order_number: 1001,
        financial_status: 'paid', // Changed
        fulfillment_status: null,
        line_items: [{ id: 1, quantity: 2, fulfillable_quantity: 2 }],
        fulfillments: [],
      };

      const hash1 = EventService.hashPayload(payload1);
      const hash2 = EventService.hashPayload(payload2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('normalizeEvent', () => {
    it('should create a normalized event with correct fields', () => {
      const payload = { id: 123, title: 'Test Product', variants: [] };

      const event = EventService.normalizeEvent(
        'shop1',
        'PRODUCTS_UPDATE',
        '123',
        payload
      );

      expect(event.shopId).toBe('shop1');
      expect(event.topic).toBe('PRODUCTS_UPDATE');
      expect(event.resourceId).toBe('123');
      expect(event.resourceType).toBe('PRODUCT');
      expect(event.priority).toBe(EventPriority.NORMAL);
      expect(event.payload).toEqual(payload);
      expect(event.idempotencyKey).toBeDefined();
      expect(event.payloadHash).toBeDefined();
      expect(event.receivedAt).toBeInstanceOf(Date);
    });

    it('should assign correct resource types', () => {
      const payload = {};

      const productEvent = EventService.normalizeEvent('shop1', 'PRODUCTS_UPDATE', '1', payload);
      expect(productEvent.resourceType).toBe('PRODUCT');

      const inventoryEvent = EventService.normalizeEvent('shop1', 'INVENTORY_LEVELS_UPDATE', '1', payload);
      expect(inventoryEvent.resourceType).toBe('INVENTORY');

      const orderEvent = EventService.normalizeEvent('shop1', 'ORDERS_CREATE', '1', payload);
      expect(orderEvent.resourceType).toBe('ORDER');

      const appEvent = EventService.normalizeEvent('shop1', 'APP_UNINSTALLED', '1', payload);
      expect(appEvent.resourceType).toBe('APP');
    });
  });

  describe('getPriority', () => {
    it('should assign CRITICAL priority to app uninstall', () => {
      expect(EventService.getPriority('APP_UNINSTALLED')).toBe(EventPriority.CRITICAL);
    });

    it('should assign CRITICAL priority to order create', () => {
      expect(EventService.getPriority('ORDERS_CREATE')).toBe(EventPriority.CRITICAL);
    });

    it('should assign HIGH priority to inventory and order updates', () => {
      expect(EventService.getPriority('INVENTORY_LEVELS_UPDATE')).toBe(EventPriority.HIGH);
      expect(EventService.getPriority('ORDERS_UPDATED')).toBe(EventPriority.HIGH);
    });

    it('should assign NORMAL priority to product updates', () => {
      expect(EventService.getPriority('PRODUCTS_UPDATE')).toBe(EventPriority.NORMAL);
    });

    it('should assign LOW priority to product creates and deletes', () => {
      expect(EventService.getPriority('PRODUCTS_CREATE')).toBe(EventPriority.LOW);
      expect(EventService.getPriority('PRODUCTS_DELETE')).toBe(EventPriority.LOW);
    });
  });

  describe('isProcessed / markProcessed', () => {
    it('should return false for new events', async () => {
      const result = await EventService.isProcessed('new-key-123');
      expect(result).toBe(false);
    });

    it('should return true for processed events', async () => {
      const key = 'processed-key-456';

      await EventService.markProcessed(key, { success: true });
      const result = await EventService.isProcessed(key);

      expect(result).toBe(true);
    });
  });

  describe('processWithIdempotency', () => {
    it('should process new events', async () => {
      const event = EventService.normalizeEvent(
        'shop-test-1',
        'PRODUCTS_UPDATE',
        'product-1',
        { id: 1, title: 'Test', variants: [] }
      );

      let processorCalled = false;
      const result = await EventService.processWithIdempotency(event, async () => {
        processorCalled = true;
        return { success: true };
      });

      expect(processorCalled).toBe(true);
      expect(result.processed).toBe(true);
      expect(result.skipped).toBe(false);
      expect(result.result).toEqual({ success: true });
    });

    it('should skip duplicate events', async () => {
      const event = EventService.normalizeEvent(
        'shop-test-2',
        'PRODUCTS_UPDATE',
        'product-2',
        { id: 2, title: 'Test', variants: [] }
      );

      // Process first time
      await EventService.processWithIdempotency(event, async () => ({ first: true }));

      // Try to process again
      let processorCalled = false;
      const result = await EventService.processWithIdempotency(event, async () => {
        processorCalled = true;
        return { second: true };
      });

      expect(processorCalled).toBe(false);
      expect(result.processed).toBe(false);
      expect(result.skipped).toBe(true);
    });

    it('should not mark as processed on error', async () => {
      const event = EventService.normalizeEvent(
        'shop-test-3',
        'PRODUCTS_UPDATE',
        'product-3',
        { id: 3, title: 'Test', variants: [] }
      );

      // First attempt fails
      const result1 = await EventService.processWithIdempotency(event, async () => {
        throw new Error('Processing failed');
      });

      expect(result1.processed).toBe(false);
      expect(result1.skipped).toBe(false);
      expect(result1.error).toBeDefined();

      // Second attempt should NOT be skipped (because first failed)
      let processorCalled = false;
      const result2 = await EventService.processWithIdempotency(event, async () => {
        processorCalled = true;
        return { success: true };
      });

      expect(processorCalled).toBe(true);
      expect(result2.processed).toBe(true);
    });
  });
});
