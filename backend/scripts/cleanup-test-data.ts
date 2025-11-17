#!/usr/bin/env -S npx tsx

/**
 * Cleanup script to remove test shop data for demo
 *
 * This removes:
 * - test-supplier-124.myshopify.com
 * - test-retailer-817.myshopify.com
 * And all associated data (connections, products, orders, etc.)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEST_SHOPS = [
  'test-supplier-124.myshopify.com',
  'test-retailer-817.myshopify.com',
];

async function cleanup() {
  console.log('🧹 Starting test data cleanup...\n');

  for (const shopDomain of TEST_SHOPS) {
    console.log(`📍 Processing: ${shopDomain}`);

    // Find shop
    const shop = await prisma.shop.findUnique({
      where: { myshopifyDomain: shopDomain },
    });

    if (!shop) {
      console.log(`   ℹ️  Shop not found, skipping\n`);
      continue;
    }

    console.log(`   Found shop ID: ${shop.id}`);

    // Delete in order to respect foreign key constraints

    // 1. Delete purchase order items
    const poItems = await prisma.purchaseOrderItem.deleteMany({
      where: {
        purchaseOrder: {
          OR: [
            { retailerShopId: shop.id },
            { supplierShopId: shop.id },
          ],
        },
      },
    });
    console.log(`   ✓ Deleted ${poItems.count} purchase order items`);

    // 2. Delete purchase orders
    const pos = await prisma.purchaseOrder.deleteMany({
      where: {
        OR: [
          { retailerShopId: shop.id },
          { supplierShopId: shop.id },
        ],
      },
    });
    console.log(`   ✓ Deleted ${pos.count} purchase orders`);

    // 3. Delete supplier products
    const products = await prisma.supplierProduct.deleteMany({
      where: { shopId: shop.id },
    });
    console.log(`   ✓ Deleted ${products.count} supplier products`);

    // 4. Delete connection invites (as supplier)
    const invitesAsSupplier = await prisma.connectionInvite.deleteMany({
      where: { supplierShopId: shop.id },
    });
    console.log(`   ✓ Deleted ${invitesAsSupplier.count} connection invites (as supplier)`);

    // 5. Delete connection invites (as retailer) - if that model exists
    const invitesAsRetailer = await prisma.connectionInvite.deleteMany({
      where: {
        supplierShop: {
          connections: {
            some: { retailerShopId: shop.id }
          }
        }
      },
    });
    console.log(`   ✓ Deleted ${invitesAsRetailer.count} connection invites (as retailer)`);

    // 6. Delete connections (as supplier)
    const connectionsAsSupplier = await prisma.connection.deleteMany({
      where: { supplierShopId: shop.id },
    });
    console.log(`   ✓ Deleted ${connectionsAsSupplier.count} connections (as supplier)`);

    // 7. Delete connections (as retailer)
    const connectionsAsRetailer = await prisma.connection.deleteMany({
      where: { retailerShopId: shop.id },
    });
    console.log(`   ✓ Deleted ${connectionsAsRetailer.count} connections (as retailer)`);

    // 8. Delete audit logs
    const auditLogs = await prisma.auditLog.deleteMany({
      where: { shopId: shop.id },
    });
    console.log(`   ✓ Deleted ${auditLogs.count} audit logs`);

    // 9. Finally, delete the shop
    await prisma.shop.delete({
      where: { id: shop.id },
    });
    console.log(`   ✓ Deleted shop\n`);
  }

  console.log('✅ Test data cleanup complete!\n');

  // Show remaining shops
  const remainingShops = await prisma.shop.findMany({
    select: {
      myshopifyDomain: true,
      role: true,
      plan: true,
    },
  });

  if (remainingShops.length > 0) {
    console.log('📊 Remaining shops in database:');
    remainingShops.forEach(shop => {
      console.log(`   - ${shop.myshopifyDomain} (${shop.role}, ${shop.plan})`);
    });
  } else {
    console.log('📊 Database is now empty (ready for fresh demo)');
  }
}

cleanup()
  .catch(error => {
    console.error('❌ Error during cleanup:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
