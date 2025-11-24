/**
 * Admin authentication middleware
 * Validates NextAuth JWT tokens from the admin dashboard
 */

import { Request, Response, NextFunction } from 'express';
import { jwtVerify } from 'jose';
import { logger } from '../utils/logger';

// Whitelist of allowed admin emails (must match admin dashboard config)
const ALLOWED_EMAILS = [
  'gabe@manafoldgames.com',
  'nathan@manafoldgames.com',
];

/**
 * Middleware to validate NextAuth JWT tokens
 *
 * Expects JWT token in Authorization header: Bearer <token>
 * Verifies token signature and checks email whitelist
 */
export async function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  try {
    // Get AUTH_SECRET from environment
    const secret = process.env.AUTH_SECRET;

    if (!secret) {
      logger.error('AUTH_SECRET not configured for admin authentication');
      res.status(500).json({ error: 'Admin authentication not configured' });
      return;
    }

    // Parse authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn(`Admin auth failed: Missing or invalid authorization header from ${req.ip}`);
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Extract JWT token
    const token = authHeader.split(' ')[1];

    if (!token) {
      logger.warn(`Admin auth failed: Empty token from ${req.ip}`);
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Verify JWT token
    const secretKey = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, secretKey);

    // Check if email is in the payload
    const email = payload.email as string | undefined;

    if (!email) {
      logger.warn(`Admin auth failed: No email in token from ${req.ip}`);
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Verify email is in whitelist
    if (!ALLOWED_EMAILS.includes(email)) {
      logger.warn(`Admin auth rejected: ${email} not in whitelist from ${req.ip}`);
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // Add user info to request for downstream use
    (req as any).adminUser = {
      email,
      id: payload.id || payload.sub,
    };

    logger.info(`Admin authenticated: ${email} from ${req.ip}`);
    next();
  } catch (error) {
    logger.warn(`Admin auth failed: ${error instanceof Error ? error.message : 'Unknown error'} from ${req.ip}`);
    res.status(401).json({ error: 'Unauthorized' });
  }
}
