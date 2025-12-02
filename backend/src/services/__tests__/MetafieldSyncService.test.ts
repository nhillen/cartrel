/**
 * Tests for MetafieldSyncService - Type validation and tier caps
 */

// Mock dependencies - must be before imports
jest.mock('../shopify', () => ({
  createShopifyGraphQLClient: jest.fn(),
  shopify: {},
}));

jest.mock('../../config', () => ({
  config: {
    redisUrl: 'redis://localhost:6379',
    appUrl: 'http://localhost:3000',
    nodeEnv: 'test',
  },
}));

jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({})));

jest.mock('../../index', () => ({
  prisma: {
    connection: {
      findUnique: jest.fn(),
    },
    metafieldConfig: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

import {
  SUPPORTED_METAFIELD_TYPES,
  UNSUPPORTED_METAFIELD_TYPES,
  METAFIELD_TIER_CAPS,
  MetafieldSyncService,
} from '../MetafieldSyncService';

describe('MetafieldSyncService', () => {
  describe('SUPPORTED_METAFIELD_TYPES', () => {
    it('should include all basic text types', () => {
      expect(SUPPORTED_METAFIELD_TYPES).toContain('single_line_text_field');
      expect(SUPPORTED_METAFIELD_TYPES).toContain('multi_line_text_field');
      expect(SUPPORTED_METAFIELD_TYPES).toContain('rich_text_field');
    });

    it('should include numeric types', () => {
      expect(SUPPORTED_METAFIELD_TYPES).toContain('number_integer');
      expect(SUPPORTED_METAFIELD_TYPES).toContain('number_decimal');
    });

    it('should include date types', () => {
      expect(SUPPORTED_METAFIELD_TYPES).toContain('date');
      expect(SUPPORTED_METAFIELD_TYPES).toContain('date_time');
    });

    it('should include measurement types', () => {
      expect(SUPPORTED_METAFIELD_TYPES).toContain('dimension');
      expect(SUPPORTED_METAFIELD_TYPES).toContain('weight');
      expect(SUPPORTED_METAFIELD_TYPES).toContain('volume');
    });

    it('should include other supported types', () => {
      expect(SUPPORTED_METAFIELD_TYPES).toContain('color');
      expect(SUPPORTED_METAFIELD_TYPES).toContain('url');
      expect(SUPPORTED_METAFIELD_TYPES).toContain('money');
      expect(SUPPORTED_METAFIELD_TYPES).toContain('boolean');
      expect(SUPPORTED_METAFIELD_TYPES).toContain('rating');
    });

    it('should NOT include reference types', () => {
      expect(SUPPORTED_METAFIELD_TYPES).not.toContain('product_reference');
      expect(SUPPORTED_METAFIELD_TYPES).not.toContain('file_reference');
    });
  });

  describe('UNSUPPORTED_METAFIELD_TYPES', () => {
    it('should include all reference types', () => {
      expect(UNSUPPORTED_METAFIELD_TYPES).toContain('product_reference');
      expect(UNSUPPORTED_METAFIELD_TYPES).toContain('variant_reference');
      expect(UNSUPPORTED_METAFIELD_TYPES).toContain('collection_reference');
      expect(UNSUPPORTED_METAFIELD_TYPES).toContain('page_reference');
      expect(UNSUPPORTED_METAFIELD_TYPES).toContain('metaobject_reference');
      expect(UNSUPPORTED_METAFIELD_TYPES).toContain('file_reference');
    });

    it('should include json and mixed types', () => {
      expect(UNSUPPORTED_METAFIELD_TYPES).toContain('json');
      expect(UNSUPPORTED_METAFIELD_TYPES).toContain('mixed_reference');
    });

    it('should include list types', () => {
      expect(UNSUPPORTED_METAFIELD_TYPES).toContain('list.single_line_text_field');
      expect(UNSUPPORTED_METAFIELD_TYPES).toContain('list.number_integer');
      expect(UNSUPPORTED_METAFIELD_TYPES).toContain('list.product_reference');
    });
  });

  describe('METAFIELD_TIER_CAPS', () => {
    it('should have correct cap for FREE tier', () => {
      expect(METAFIELD_TIER_CAPS.FREE).toBe(10);
    });

    it('should have increasing caps for higher tiers', () => {
      expect(METAFIELD_TIER_CAPS.STARTER).toBeGreaterThan(METAFIELD_TIER_CAPS.FREE);
      expect(METAFIELD_TIER_CAPS.CORE).toBeGreaterThan(METAFIELD_TIER_CAPS.STARTER);
      expect(METAFIELD_TIER_CAPS.PRO).toBeGreaterThan(METAFIELD_TIER_CAPS.CORE);
      expect(METAFIELD_TIER_CAPS.GROWTH).toBeGreaterThan(METAFIELD_TIER_CAPS.PRO);
    });

    it('should have effectively unlimited cap for SCALE', () => {
      expect(METAFIELD_TIER_CAPS.SCALE).toBeGreaterThan(100000);
    });

    it('should match expected values from PRD', () => {
      expect(METAFIELD_TIER_CAPS.FREE).toBe(10);
      expect(METAFIELD_TIER_CAPS.STARTER).toBe(25);
      expect(METAFIELD_TIER_CAPS.CORE).toBe(50);
      expect(METAFIELD_TIER_CAPS.PRO).toBe(200);
      expect(METAFIELD_TIER_CAPS.GROWTH).toBe(500);
    });
  });

  describe('isTypeSupported', () => {
    it('should return true for supported types', () => {
      expect(MetafieldSyncService.isTypeSupported('single_line_text_field')).toBe(true);
      expect(MetafieldSyncService.isTypeSupported('number_integer')).toBe(true);
      expect(MetafieldSyncService.isTypeSupported('date')).toBe(true);
      expect(MetafieldSyncService.isTypeSupported('boolean')).toBe(true);
      expect(MetafieldSyncService.isTypeSupported('money')).toBe(true);
    });

    it('should return false for reference types', () => {
      expect(MetafieldSyncService.isTypeSupported('product_reference')).toBe(false);
      expect(MetafieldSyncService.isTypeSupported('file_reference')).toBe(false);
      expect(MetafieldSyncService.isTypeSupported('collection_reference')).toBe(false);
    });

    it('should return false for list types', () => {
      expect(MetafieldSyncService.isTypeSupported('list.single_line_text_field')).toBe(false);
      expect(MetafieldSyncService.isTypeSupported('list.number_integer')).toBe(false);
      expect(MetafieldSyncService.isTypeSupported('list.product_reference')).toBe(false);
    });

    it('should return false for json type', () => {
      expect(MetafieldSyncService.isTypeSupported('json')).toBe(false);
    });

    it('should return false for unknown types', () => {
      expect(MetafieldSyncService.isTypeSupported('unknown_type')).toBe(false);
      expect(MetafieldSyncService.isTypeSupported('')).toBe(false);
    });
  });

  describe('getDefinitionCap', () => {
    it('should return correct cap for each tier', () => {
      expect(MetafieldSyncService.getDefinitionCap('FREE')).toBe(10);
      expect(MetafieldSyncService.getDefinitionCap('STARTER')).toBe(25);
      expect(MetafieldSyncService.getDefinitionCap('CORE')).toBe(50);
      expect(MetafieldSyncService.getDefinitionCap('PRO')).toBe(200);
      expect(MetafieldSyncService.getDefinitionCap('GROWTH')).toBe(500);
      expect(MetafieldSyncService.getDefinitionCap('SCALE')).toBe(999999);
    });

    it('should be case-insensitive', () => {
      expect(MetafieldSyncService.getDefinitionCap('free')).toBe(10);
      expect(MetafieldSyncService.getDefinitionCap('Pro')).toBe(200);
    });

    it('should default to FREE for unknown tier', () => {
      expect(MetafieldSyncService.getDefinitionCap('UNKNOWN')).toBe(10);
      expect(MetafieldSyncService.getDefinitionCap('')).toBe(10);
    });
  });
});
