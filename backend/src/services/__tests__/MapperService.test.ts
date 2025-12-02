/**
 * Tests for MapperService - Product/variant mapping with conflict detection
 *
 * These tests verify:
 * 1. Product validation
 * 2. Mapping creation
 * 3. SKU drift detection
 * 4. Mapping statistics
 */

// Mock Prisma before importing
jest.mock('../../index', () => ({
  prisma: {
    supplierProduct: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    productMapping: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      createMany: jest.fn(),
      count: jest.fn(),
    },
    connection: {
      findUnique: jest.fn(),
    },
  },
}));

// Mock config
jest.mock('../../config', () => ({
  config: {
    appUrl: 'http://localhost:3000',
    nodeEnv: 'test',
  },
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock shopify client
jest.mock('../shopify', () => ({
  createShopifyGraphQLClient: jest.fn(() => ({
    request: jest.fn().mockResolvedValue({ data: {} }),
  })),
}));

// Mock InventorySyncService
jest.mock('../InventorySyncService', () => ({
  InventorySyncService: {
    updateRetailerInventory: jest.fn().mockResolvedValue(undefined),
  },
}));

// Mock ConnectionHealthService
jest.mock('../ConnectionHealthService', () => ({
  ConnectionHealthService: {
    recordSuccess: jest.fn(),
    recordFailure: jest.fn(),
    recordMappingError: jest.fn().mockResolvedValue(undefined),
  },
}));

import { MapperService, ConflictType, MappingConflict } from '../MapperService';
import { prisma } from '../../index';

describe('MapperService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateProduct', () => {
    it('should return invalid when product not found', async () => {
      (prisma.supplierProduct.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await MapperService.validateProduct('sp-nonexistent', 'conn-1');

      expect(result.valid).toBe(false);
      expect(result.conflicts.length).toBeGreaterThan(0);
    });

    it('should detect unsupported product types', async () => {
      const mockSupplierProduct = {
        id: 'sp-1',
        shopifyProductId: 'prod-1',
        shopifyVariantId: 'var-1',
        supplierShopId: 'shop-1',
        sku: 'SKU-001',
        title: 'Gift Card',
        productType: 'gift_card', // Unsupported type
      };

      (prisma.supplierProduct.findUnique as jest.Mock).mockResolvedValue(mockSupplierProduct);
      (prisma.supplierProduct.findMany as jest.Mock).mockResolvedValue([mockSupplierProduct]);

      const result = await MapperService.validateProduct('sp-1', 'conn-1');

      const unsupportedConflicts = result.conflicts.filter(
        (c: MappingConflict) => c.type === ConflictType.UNSUPPORTED_PRODUCT_TYPE
      );
      expect(unsupportedConflicts.length).toBe(1);
    });

    it('should detect missing SKUs', async () => {
      const mockSupplierProduct = {
        id: 'sp-1',
        shopifyProductId: 'prod-1',
        shopifyVariantId: 'var-1',
        supplierShopId: 'shop-1',
        sku: '', // Missing SKU
        title: 'Test Product',
        productType: 'Apparel',
      };

      (prisma.supplierProduct.findUnique as jest.Mock).mockResolvedValue(mockSupplierProduct);
      (prisma.supplierProduct.findMany as jest.Mock).mockResolvedValue([mockSupplierProduct]);

      const result = await MapperService.validateProduct('sp-1', 'conn-1');

      const missingSkuConflicts = result.conflicts.filter(
        (c: MappingConflict) => c.type === ConflictType.MISSING_SKU
      );
      expect(missingSkuConflicts.length).toBe(1);
    });

    it('should return valid for proper products', async () => {
      const mockSupplierProduct = {
        id: 'sp-1',
        shopifyProductId: 'prod-1',
        shopifyVariantId: 'var-1',
        supplierShopId: 'shop-1',
        sku: 'SKU-001',
        title: 'Test Product',
        productType: 'Apparel',
        inventoryTracking: true,
      };

      (prisma.supplierProduct.findUnique as jest.Mock).mockResolvedValue(mockSupplierProduct);
      (prisma.supplierProduct.findMany as jest.Mock).mockResolvedValue([mockSupplierProduct]);

      const result = await MapperService.validateProduct('sp-1', 'conn-1');

      expect(result.valid).toBe(true);
    });
  });

  describe('createMapping', () => {
    it('should create a new mapping', async () => {
      const mockSupplierProduct = {
        id: 'sp-1',
        shopifyProductId: 'prod-1',
        shopifyVariantId: 'var-1',
        supplierShopId: 'shop-1',
        sku: 'SKU-001',
        title: 'Test Product',
      };

      const mockConnection = {
        id: 'conn-1',
        supplierShopId: 'shop-1',
        retailerShopId: 'shop-2',
        status: 'ACTIVE',
      };

      const mockCreatedMapping = {
        id: 'map-1',
        connectionId: 'conn-1',
        supplierProductId: 'sp-1',
        status: 'ACTIVE',
      };

      (prisma.supplierProduct.findUnique as jest.Mock).mockResolvedValue(mockSupplierProduct);
      (prisma.supplierProduct.findMany as jest.Mock).mockResolvedValue([mockSupplierProduct]);
      (prisma.connection.findUnique as jest.Mock).mockResolvedValue(mockConnection);
      (prisma.productMapping.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.productMapping.create as jest.Mock).mockResolvedValue(mockCreatedMapping);

      const result = await MapperService.createMapping('conn-1', 'sp-1');

      expect(result.mapping).toEqual(mockCreatedMapping);
      expect(prisma.productMapping.create).toHaveBeenCalled();
    });
  });

  describe('detectSkuDrift', () => {
    it('should detect when SKU has changed', async () => {
      const mockMappings = [
        {
          id: 'map-1',
          originalSupplierSku: 'SKU-001',
          supplierProduct: {
            id: 'sp-1',
            sku: 'SKU-002', // Changed
          },
          skuDriftDetected: false,
        },
      ];

      (prisma.productMapping.findMany as jest.Mock).mockResolvedValue(mockMappings);
      (prisma.productMapping.update as jest.Mock).mockResolvedValue({});

      const results = await MapperService.detectSkuDrift('conn-1');

      expect(results.length).toBe(1);
      expect(results[0].originalSku).toBe('SKU-001');
      expect(results[0].currentSku).toBe('SKU-002');
    });

    it('should return empty when no drift detected', async () => {
      const mockMappings = [
        {
          id: 'map-1',
          originalSupplierSku: 'SKU-001',
          supplierProduct: {
            id: 'sp-1',
            sku: 'SKU-001', // Same
          },
          skuDriftDetected: false,
        },
      ];

      (prisma.productMapping.findMany as jest.Mock).mockResolvedValue(mockMappings);

      const results = await MapperService.detectSkuDrift('conn-1');

      expect(results.length).toBe(0);
    });
  });

  describe('getMappingSummary', () => {
    it('should return mapping statistics object', async () => {
      // Mock count to return consistent values
      (prisma.productMapping.count as jest.Mock).mockResolvedValue(0);

      const stats = await MapperService.getMappingSummary('conn-1');

      // Just verify the shape of the response
      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('active');
      expect(stats).toHaveProperty('paused');
      expect(stats).toHaveProperty('discontinued');
      expect(typeof stats.total).toBe('number');
    });
  });
});
