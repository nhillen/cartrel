/**
 * Tests for BillingEnforcementService - Tier caps and usage checks
 */

import { TIER_CAPS, TierLevel } from '../BillingEnforcementService';

describe('BillingEnforcementService', () => {
  describe('TIER_CAPS', () => {
    it('should have correct caps for FREE tier', () => {
      expect(TIER_CAPS.FREE).toMatchObject({
        connections: 3,
        products: 150,
        orderPushesPerMonth: 10,
        metafieldDefinitions: 10,
      });
    });

    it('should have increasing product caps for higher tiers', () => {
      expect(TIER_CAPS.STARTER.products).toBeGreaterThan(TIER_CAPS.FREE.products);
      expect(TIER_CAPS.CORE.products).toBeGreaterThan(TIER_CAPS.STARTER.products);
      expect(TIER_CAPS.PRO.products).toBeGreaterThan(TIER_CAPS.CORE.products);
      expect(TIER_CAPS.GROWTH.products).toBeGreaterThan(TIER_CAPS.PRO.products);
      expect(TIER_CAPS.SCALE.products).toBeGreaterThan(TIER_CAPS.GROWTH.products);
    });

    it('should have increasing connection caps for higher tiers', () => {
      expect(TIER_CAPS.STARTER.connections).toBeGreaterThan(TIER_CAPS.FREE.connections);
      expect(TIER_CAPS.CORE.connections).toBeGreaterThan(TIER_CAPS.STARTER.connections);
      expect(TIER_CAPS.PRO.connections).toBeGreaterThan(TIER_CAPS.CORE.connections);
    });

    it('should have high caps for MARKETPLACE tier', () => {
      expect(TIER_CAPS.MARKETPLACE.connections).toBe(999999);
      expect(TIER_CAPS.MARKETPLACE.products).toBe(999999);
      expect(TIER_CAPS.MARKETPLACE.orderPushesPerMonth).toBe(999999);
    });

    it('should have unlimited metafield definitions for SCALE', () => {
      expect(TIER_CAPS.SCALE.metafieldDefinitions).toBe(999999);
    });
  });

  describe('TIER_CAPS features', () => {
    it('should have basic features disabled for FREE tier', () => {
      expect(TIER_CAPS.FREE.features.autoOrderPush).toBe(false);
      expect(TIER_CAPS.FREE.features.priceSync).toBe(false);
      expect(TIER_CAPS.FREE.features.multiLocation).toBe(false);
      expect(TIER_CAPS.FREE.features.payouts).toBe(false);
      expect(TIER_CAPS.FREE.features.marketplace).toBe(false);
    });

    it('should enable autoOrderPush for STARTER and above', () => {
      expect(TIER_CAPS.FREE.features.autoOrderPush).toBe(false);
      expect(TIER_CAPS.STARTER.features.autoOrderPush).toBe(true);
      expect(TIER_CAPS.CORE.features.autoOrderPush).toBe(true);
      expect(TIER_CAPS.PRO.features.autoOrderPush).toBe(true);
    });

    it('should enable multiLocation for CORE and above', () => {
      expect(TIER_CAPS.FREE.features.multiLocation).toBe(false);
      expect(TIER_CAPS.STARTER.features.multiLocation).toBe(false);
      expect(TIER_CAPS.CORE.features.multiLocation).toBe(true);
      expect(TIER_CAPS.PRO.features.multiLocation).toBe(true);
    });

    it('should enable payouts for CORE and above', () => {
      expect(TIER_CAPS.FREE.features.payouts).toBe(false);
      expect(TIER_CAPS.STARTER.features.payouts).toBe(false);
      expect(TIER_CAPS.CORE.features.payouts).toBe(true);
      expect(TIER_CAPS.PRO.features.payouts).toBe(true);
    });

    it('should enable marketplace for GROWTH and above', () => {
      expect(TIER_CAPS.FREE.features.marketplace).toBe(false);
      expect(TIER_CAPS.CORE.features.marketplace).toBe(false);
      expect(TIER_CAPS.GROWTH.features.marketplace).toBe(true);
      expect(TIER_CAPS.SCALE.features.marketplace).toBe(true);
    });

    it('should enable all features for SCALE', () => {
      expect(TIER_CAPS.SCALE.features).toEqual({
        autoOrderPush: true,
        priceSync: true,
        multiLocation: true,
        advancedFields: true,
        payouts: true,
        marketplace: true,
      });
    });
  });

  describe('tier ordering', () => {
    const tierOrder: TierLevel[] = ['FREE', 'STARTER', 'CORE', 'PRO', 'GROWTH', 'SCALE'];

    it('should have tiers in correct order for products', () => {
      for (let i = 0; i < tierOrder.length - 1; i++) {
        const currentTier = tierOrder[i];
        const nextTier = tierOrder[i + 1];
        expect(TIER_CAPS[nextTier].products).toBeGreaterThanOrEqual(
          TIER_CAPS[currentTier].products
        );
      }
    });

    it('should have tiers in correct order for connections', () => {
      for (let i = 0; i < tierOrder.length - 1; i++) {
        const currentTier = tierOrder[i];
        const nextTier = tierOrder[i + 1];
        expect(TIER_CAPS[nextTier].connections).toBeGreaterThanOrEqual(
          TIER_CAPS[currentTier].connections
        );
      }
    });

    it('should have tiers in correct order for metafield definitions', () => {
      for (let i = 0; i < tierOrder.length - 1; i++) {
        const currentTier = tierOrder[i];
        const nextTier = tierOrder[i + 1];
        expect(TIER_CAPS[nextTier].metafieldDefinitions).toBeGreaterThanOrEqual(
          TIER_CAPS[currentTier].metafieldDefinitions
        );
      }
    });
  });

  describe('PRD compliance', () => {
    it('should have FREE tier with 150 products per PRD', () => {
      expect(TIER_CAPS.FREE.products).toBe(150);
    });

    it('should have FREE tier with 10 order pushes per PRD', () => {
      expect(TIER_CAPS.FREE.orderPushesPerMonth).toBe(10);
    });

    it('should have FREE tier with 10 metafield definitions per PRD', () => {
      expect(TIER_CAPS.FREE.metafieldDefinitions).toBe(10);
    });

    it('should have PRO tier with 200 metafield definitions per PRD', () => {
      expect(TIER_CAPS.PRO.metafieldDefinitions).toBe(200);
    });

    it('should have GROWTH tier with 500 metafield definitions per PRD', () => {
      expect(TIER_CAPS.GROWTH.metafieldDefinitions).toBe(500);
    });
  });
});
