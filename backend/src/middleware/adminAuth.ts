/**
 * Admin authentication middleware
 * Uses HTTP Basic Auth for simple CS tool access
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

/**
 * Simple HTTP Basic Auth middleware for admin routes
 *
 * Credentials are set via environment variables:
 * - ADMIN_USERNAME (default: 'admin')
 * - ADMIN_PASSWORD (required in production)
 */
export function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  // Get credentials from env
  const validUsername = process.env.ADMIN_USERNAME || 'admin';
  const validPassword = process.env.ADMIN_PASSWORD;

  // Require password in production
  if (process.env.NODE_ENV === 'production' && !validPassword) {
    logger.error('ADMIN_PASSWORD not set in production environment');
    res.status(500).send('Admin authentication not configured');
    return;
  }

  // Use default password in development
  const password = validPassword || 'cartrel-dev-admin';

  // Parse authorization header
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Cartrel Admin"');
    res.status(401).send('Authentication required');
    return;
  }

  // Decode credentials
  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [username, providedPassword] = credentials.split(':');

  // Verify credentials
  if (username === validUsername && providedPassword === password) {
    logger.info(`Admin authenticated: ${username} from ${req.ip}`);
    next();
  } else {
    logger.warn(`Failed admin login attempt: ${username} from ${req.ip}`);
    res.setHeader('WWW-Authenticate', 'Basic realm="Cartrel Admin"');
    res.status(401).send('Invalid credentials');
  }
}
