import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema, ZodError } from 'zod';
import { logger } from '../utils/logger';

/**
 * Input validation middleware
 *
 * Validates request body, query parameters, and params against Zod schemas
 * to prevent injection attacks and ensure data integrity.
 */

export interface ValidationSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

/**
 * Validate request against Zod schemas
 */
export function validate(schemas: ValidationSchemas) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Validate body
      if (schemas.body) {
        req.body = await schemas.body.parseAsync(req.body);
      }

      // Validate query
      if (schemas.query) {
        req.query = await schemas.query.parseAsync(req.query);
      }

      // Validate params
      if (schemas.params) {
        req.params = await schemas.params.parseAsync(req.params);
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        logger.warn('Validation error', {
          path: req.path,
          errors: error.errors,
          body: req.body,
          query: req.query,
        });

        res.status(400).json({
          error: 'Validation error',
          message: 'Invalid request data',
          details: error.errors.map((err) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
        return;
      }

      logger.error('Validation middleware error:', error);
      res.status(500).json({
        error: 'Server error',
        message: 'An error occurred during validation',
      });
    }
  };
}

/**
 * Common validation schemas
 */

// Shop domain validation
export const shopDomainSchema = z
  .string()
  .min(1, 'Shop domain is required')
  .regex(/^[a-z0-9-]+\.myshopify\.com$/, 'Invalid shop domain format');

// Shopify ID validation (numeric string)
export const shopifyIdSchema = z
  .string()
  .regex(/^\d+$/, 'Invalid Shopify ID format');

// Email validation
export const emailSchema = z.string().email('Invalid email format');

// UUID validation
export const uuidSchema = z.string().uuid('Invalid UUID format');

// Pagination validation
export const paginationSchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).optional(),
});

// Connection tier validation
export const tierSchema = z.enum(['STANDARD', 'PREMIUM', 'ENTERPRISE']);

// Order status validation
export const orderStatusSchema = z.enum([
  'DRAFT',
  'SUBMITTED',
  'AWAITING_PAYMENT',
  'PAID',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
]);

/**
 * Sanitize string input to prevent XSS
 * Removes dangerous HTML/script tags
 */
export function sanitizeString(input: string): string {
  if (!input) return input;

  // Remove script tags and their content
  let sanitized = input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Remove event handlers (onclick, onerror, etc)
  sanitized = sanitized.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');

  // Remove javascript: protocol
  sanitized = sanitized.replace(/javascript:/gi, '');

  return sanitized;
}

/**
 * Sanitize object recursively
 */
export function sanitizeObject(obj: any): any {
  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }

  if (obj && typeof obj === 'object') {
    const sanitized: any = {};
    for (const key in obj) {
      sanitized[key] = sanitizeObject(obj[key]);
    }
    return sanitized;
  }

  return obj;
}

/**
 * Sanitization middleware - applies to body, query, and params
 */
export function sanitizeInputs(req: Request, res: Response, next: NextFunction): void {
  try {
    if (req.body) {
      req.body = sanitizeObject(req.body);
    }

    if (req.query) {
      req.query = sanitizeObject(req.query);
    }

    if (req.params) {
      req.params = sanitizeObject(req.params);
    }

    next();
  } catch (error) {
    logger.error('Sanitization error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred during input sanitization',
    });
  }
}
