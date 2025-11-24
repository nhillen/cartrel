#!/usr/bin/env tsx
/**
 * UAT Plan Manager Script
 *
 * For UAT testing only - allows changing shop plans without billing
 * This will be replaced by the CS Admin Tool in the future
 *
 * Usage:
 *   npm run uat:plan <shop-domain> <plan>
 *
 * Example:
 *   npm run uat:plan test-supplier.myshopify.com STARTER
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const VALID_PLANS = ['FREE', 'STARTER', 'CORE', 'PRO', 'GROWTH', 'SCALE'];

async function changePlan(shopDomain: string, newPlan: string) {
  try {
    // Validate plan
    if (!VALID_PLANS.includes(newPlan)) {
      console.error(`❌ Invalid plan: ${newPlan}`);
      console.error(`   Valid plans: ${VALID_PLANS.join(', ')}`);
      process.exit(1);
    }

    // Find shop
    const shop = await prisma.shop.findUnique({
      where: { myshopifyDomain: shopDomain },
    });

    if (!shop) {
      console.error(`❌ Shop not found: ${shopDomain}`);
      process.exit(1);
    }

    const oldPlan = shop.plan;

    // Update plan
    await prisma.shop.update({
      where: { id: shop.id },
      data: {
        plan: newPlan,
        pendingPlan: null,
        pendingChargeId: null,
      },
    });

    // Log audit event
    await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: 'TIER_UPGRADED',
        resourceType: 'Shop',
        resourceId: shop.id,
        metadata: {
          oldPlan,
          newPlan,
          source: 'UAT_SCRIPT',
        },
      },
    });

    console.log('✅ Plan updated successfully!');
    console.log(`   Shop: ${shopDomain}`);
    console.log(`   Old Plan: ${oldPlan}`);
    console.log(`   New Plan: ${newPlan}`);
    console.log('');
    console.log('💡 Note: This is for UAT testing only.');
    console.log('   In production, use the CS Admin Tool to manage plans.');

  } catch (error) {
    console.error('❌ Error updating plan:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length !== 2) {
  console.error('Usage: npm run uat:plan <shop-domain> <plan>');
  console.error('');
  console.error('Example:');
  console.error('  npm run uat:plan test-supplier.myshopify.com STARTER');
  console.error('');
  console.error(`Valid plans: ${VALID_PLANS.join(', ')}`);
  process.exit(1);
}

const [shopDomain, plan] = args;

changePlan(shopDomain, plan.toUpperCase());
