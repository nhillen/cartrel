#!/usr/bin/env node
/**
 * Migration script to encrypt existing plain text access tokens
 *
 * This script:
 * 1. Finds all shops with unencrypted access tokens
 * 2. Encrypts each token using AES-256-GCM
 * 3. Updates the database with encrypted tokens
 *
 * Run with: npm run migrate:encrypt-tokens
 * Or: npx tsx src/scripts/migrate-encrypt-tokens.ts
 */

import { PrismaClient } from '@prisma/client';
import { encryptAccessToken, isEncrypted } from '../utils/crypto';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

async function migrateTokens() {
  try {
    logger.info('🔐 Starting access token encryption migration...');

    // Get all shops
    const shops = await prisma.shop.findMany({
      select: {
        id: true,
        myshopifyDomain: true,
        accessToken: true,
      },
    });

    logger.info(`Found ${shops.length} shops to process`);

    let encryptedCount = 0;
    let alreadyEncryptedCount = 0;
    let emptyTokenCount = 0;
    let errorCount = 0;

    for (const shop of shops) {
      try {
        // Skip empty tokens (uninstalled apps)
        if (!shop.accessToken || shop.accessToken === '') {
          logger.debug(`Skipping ${shop.myshopifyDomain} - empty token (app uninstalled)`);
          emptyTokenCount++;
          continue;
        }

        // Check if already encrypted
        if (isEncrypted(shop.accessToken)) {
          logger.debug(`Skipping ${shop.myshopifyDomain} - already encrypted`);
          alreadyEncryptedCount++;
          continue;
        }

        // Encrypt the token
        const encryptedToken = encryptAccessToken(shop.accessToken);

        // Update in database
        await prisma.shop.update({
          where: { id: shop.id },
          data: { accessToken: encryptedToken },
        });

        logger.info(`✓ Encrypted token for ${shop.myshopifyDomain}`);
        encryptedCount++;
      } catch (error) {
        logger.error(`✗ Failed to encrypt token for ${shop.myshopifyDomain}:`, error);
        errorCount++;
      }
    }

    logger.info('');
    logger.info('📊 Migration complete:');
    logger.info(`  ✓ Encrypted: ${encryptedCount}`);
    logger.info(`  ⊙ Already encrypted: ${alreadyEncryptedCount}`);
    logger.info(`  ⊘ Empty tokens (skipped): ${emptyTokenCount}`);
    logger.info(`  ✗ Errors: ${errorCount}`);
    logger.info('');

    if (errorCount > 0) {
      logger.warn('⚠️  Some tokens failed to encrypt. Please check the errors above.');
      process.exit(1);
    } else {
      logger.info('✅ All tokens successfully encrypted!');
      process.exit(0);
    }
  } catch (error) {
    logger.error('Fatal error during migration:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration
migrateTokens();
