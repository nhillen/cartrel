/**
 * Import Queue Processor - Handles async product imports for large catalogs
 *
 * For large imports (100+ products), we queue them for async processing
 * to avoid request timeouts and provide progress tracking.
 */

import { Job } from 'bull';
import { logger } from '../../utils/logger';
import { prisma } from '../../index';
import { ProductImportService } from '../../services/ProductImportService';

export interface ImportJob {
  connectionId: string;
  retailerShopId: string;
  supplierProductIds: string[];
  preferences: any;
  createInShopify: boolean;
  batchId: string; // For tracking progress
}

export interface ImportBatchStatus {
  batchId: string;
  totalProducts: number;
  completed: number;
  successful: number;
  failed: number;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  startedAt?: Date;
  completedAt?: Date;
  errors: string[];
}

/**
 * Process an async product import job
 */
export async function processImport(job: Job<ImportJob>) {
  const { connectionId, retailerShopId, supplierProductIds, preferences, createInShopify, batchId } =
    job.data;

  logger.info(
    `Processing import batch ${batchId}: ${supplierProductIds.length} products for connection ${connectionId}`
  );

  try {
    // Create or get import batch status record
    let batchStatus = await prisma.importBatchStatus.findUnique({
      where: { batchId },
    });

    if (!batchStatus) {
      batchStatus = await prisma.importBatchStatus.create({
        data: {
          batchId,
          connectionId,
          retailerShopId,
          totalProducts: supplierProductIds.length,
          completed: 0,
          successful: 0,
          failed: 0,
          status: 'IN_PROGRESS',
          startedAt: new Date(),
          errors: [],
        },
      });
    } else {
      await prisma.importBatchStatus.update({
        where: { batchId },
        data: {
          status: 'IN_PROGRESS',
          startedAt: new Date(),
        },
      });
    }

    // Process products in batches of 10 to avoid overwhelming Shopify API
    const BATCH_SIZE = 10;
    let completed = 0;
    let successful = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < supplierProductIds.length; i += BATCH_SIZE) {
      const batch = supplierProductIds.slice(i, i + BATCH_SIZE);

      logger.info(`Processing batch ${i / BATCH_SIZE + 1} of ${Math.ceil(supplierProductIds.length / BATCH_SIZE)}`);

      try {
        const result = await ProductImportService.importProducts(
          connectionId,
          batch,
          preferences,
          createInShopify
        );

        successful += result.summary.success;
        failed += result.summary.errors;
        completed += batch.length;

        // Collect errors
        result.results.forEach((r, idx) => {
          if (!r.success && r.error) {
            errors.push(`Product ${batch[idx]}: ${r.error}`);
          }
        });

        // Update progress
        await prisma.importBatchStatus.update({
          where: { batchId },
          data: {
            completed,
            successful,
            failed,
            errors: errors.slice(0, 100), // Limit to 100 errors
          },
        });

        // Update job progress (0-100%)
        const progress = Math.round((completed / supplierProductIds.length) * 100);
        await job.progress(progress);

        logger.info(
          `Batch ${batchId} progress: ${completed}/${supplierProductIds.length} (${progress}%)`
        );

        // Respect Shopify rate limits - wait 500ms between batches
        if (i + BATCH_SIZE < supplierProductIds.length) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (error) {
        logger.error(`Error processing batch ${i / BATCH_SIZE + 1}:`, error);
        failed += batch.length;
        completed += batch.length;
        errors.push(`Batch ${i / BATCH_SIZE + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);

        // Update progress even on error
        await prisma.importBatchStatus.update({
          where: { batchId },
          data: {
            completed,
            failed,
            errors: errors.slice(0, 100),
          },
        });
      }
    }

    // Mark batch as completed
    await prisma.importBatchStatus.update({
      where: { batchId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        completed: supplierProductIds.length,
        successful,
        failed,
        errors: errors.slice(0, 100),
      },
    });

    logger.info(
      `Import batch ${batchId} completed: ${successful} success, ${failed} failed`
    );

    // Log audit event
    await prisma.auditLog.create({
      data: {
        shopId: retailerShopId,
        action: 'ASYNC_IMPORT_COMPLETED',
        resourceType: 'ImportBatch',
        resourceId: batchId,
        metadata: {
          totalProducts: supplierProductIds.length,
          successful,
          failed,
        },
      },
    });

    return {
      success: true,
      batchId,
      summary: {
        total: supplierProductIds.length,
        successful,
        failed,
      },
    };
  } catch (error) {
    logger.error(`Error processing import batch ${batchId}:`, error);

    // Mark batch as failed
    await prisma.importBatchStatus.updateMany({
      where: { batchId },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      },
    });

    throw error; // Re-throw to trigger retry
  }
}

/**
 * Get import batch status
 */
export async function getImportBatchStatus(batchId: string): Promise<ImportBatchStatus | null> {
  try {
    const status = await prisma.importBatchStatus.findUnique({
      where: { batchId },
    });

    if (!status) {
      return null;
    }

    return {
      batchId: status.batchId,
      totalProducts: status.totalProducts,
      completed: status.completed,
      successful: status.successful,
      failed: status.failed,
      status: status.status as any,
      startedAt: status.startedAt || undefined,
      completedAt: status.completedAt || undefined,
      errors: status.errors as string[],
    };
  } catch (error) {
    logger.error(`Error getting import batch status for ${batchId}:`, error);
    return null;
  }
}
