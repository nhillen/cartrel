import { Request, Response, NextFunction } from 'express';
import { prisma } from '../index';
import { logger } from '../utils/logger';
import { shopify } from '../services/shopify';

/**
 * Authentication middleware
 *
 * Verifies that the request includes a valid shop parameter and that
 * the shop exists in the database with a valid access token.
 */

export interface AuthenticatedRequest extends Request {
  shopId?: string;
  shopDomain?: string;
  shop?: {
    id: string;
    myshopifyDomain: string;
    accessToken: string;
    role: string;
    plan: string;
  };
}

/**
 * Require authentication - validates shop parameter and access token
 * Use this on routes that require the shop to be authenticated
 */
export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Get shop from query or body
    const shop = (req.query.shop as string) || req.body.shop;

    if (!shop) {
      logger.warn('Authentication failed: Missing shop parameter', {
        path: req.path,
        ip: req.ip,
      });
      res.status(400).json({
        error: 'Missing shop parameter',
        message: 'The shop parameter is required.',
      });
      return;
    }

    // Validate shop domain format
    if (!shop.endsWith('.myshopify.com')) {
      logger.warn('Authentication failed: Invalid shop domain', {
        shop,
        path: req.path,
        ip: req.ip,
      });
      res.status(400).json({
        error: 'Invalid shop domain',
        message: 'Shop must be a valid myshopify.com domain.',
      });
      return;
    }

    // Check if shop exists in database
    const shopRecord = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (!shopRecord) {
      logger.warn('Authentication failed: Shop not found', {
        shop,
        path: req.path,
        ip: req.ip,
      });
      res.status(404).json({
        error: 'Shop not found',
        message: 'This shop has not installed the app. Please install the app first.',
        requiresInstall: true,
      });
      return;
    }

    // Check if shop has access token
    if (!shopRecord.accessToken || shopRecord.accessToken === '') {
      logger.warn('Authentication failed: No access token', {
        shop,
        path: req.path,
        ip: req.ip,
      });
      res.status(401).json({
        error: 'Invalid access token',
        message: 'Please reinstall the app to continue.',
        requiresReauth: true,
      });
      return;
    }

    // Authentication successful - attach shop info to request
    req.shopId = shopRecord.id;
    req.shopDomain = shopRecord.myshopifyDomain;
    req.shop = {
      id: shopRecord.id,
      myshopifyDomain: shopRecord.myshopifyDomain,
      accessToken: shopRecord.accessToken,
      role: shopRecord.role,
      plan: shopRecord.plan,
    };

    logger.debug('Authentication successful', {
      shop: shopRecord.myshopifyDomain,
      path: req.path,
    });

    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(500).json({
      error: 'Authentication error',
      message: 'An error occurred during authentication.',
    });
  }
}

/**
 * Require specific role - use after requireAuth
 * Example: requireRole('SUPPLIER')
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.shop) {
      logger.error('requireRole called without authentication', {
        path: req.path,
      });
      res.status(500).json({
        error: 'Server error',
        message: 'Authentication middleware not applied.',
      });
      return;
    }

    if (!allowedRoles.includes(req.shop.role)) {
      logger.warn('Authorization failed: Insufficient role', {
        shop: req.shop.myshopifyDomain,
        requiredRoles: allowedRoles,
        actualRole: req.shop.role,
        path: req.path,
      });
      res.status(403).json({
        error: 'Forbidden',
        message: `This action requires one of the following roles: ${allowedRoles.join(', ')}`,
      });
      return;
    }

    next();
  };
}

/**
 * Optional authentication - attaches shop if present but doesn't require it
 */
export async function optionalAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const shop = (req.query.shop as string) || req.body.shop;

    if (!shop) {
      // No shop provided, continue without authentication
      next();
      return;
    }

    const shopRecord = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (shopRecord && shopRecord.accessToken) {
      // Attach shop info to request
      req.shopId = shopRecord.id;
      req.shopDomain = shopRecord.myshopifyDomain;
      req.shop = {
        id: shopRecord.id,
        myshopifyDomain: shopRecord.myshopifyDomain,
        accessToken: shopRecord.accessToken,
        role: shopRecord.role,
        plan: shopRecord.plan,
      };
    }

    next();
  } catch (error) {
    logger.error('Optional auth error:', error);
    // Continue without authentication on error
    next();
  }
}

/**
 * Authenticate via App Bridge session token (JWT)
 * Use this for routes called by the embedded React app
 */
export async function requireSessionToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'Missing authorization header',
        message: 'Authorization header with Bearer token is required.',
      });
      return;
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    try {
      // Decode and verify the session token
      const payload = await shopify.session.decodeSessionToken(token);
      const shopDomain = payload.dest.replace('https://', '');

      // Load shop from database
      const shopRecord = await prisma.shop.findUnique({
        where: { myshopifyDomain: shopDomain },
      });

      if (!shopRecord) {
        logger.warn('Session token auth failed: Shop not found', { shop: shopDomain });
        res.status(404).json({
          error: 'Shop not found',
          message: 'This shop has not installed the app.',
          requiresInstall: true,
        });
        return;
      }

      if (!shopRecord.accessToken) {
        logger.warn('Session token auth failed: No access token', { shop: shopDomain });
        res.status(401).json({
          error: 'Invalid access token',
          message: 'Please reinstall the app.',
          requiresReauth: true,
        });
        return;
      }

      // Attach shop info to request
      req.shopId = shopRecord.id;
      req.shopDomain = shopRecord.myshopifyDomain;
      req.shop = {
        id: shopRecord.id,
        myshopifyDomain: shopRecord.myshopifyDomain,
        accessToken: shopRecord.accessToken,
        role: shopRecord.role,
        plan: shopRecord.plan,
      };

      logger.debug('Session token auth successful', { shop: shopDomain });
      next();
    } catch (tokenError) {
      logger.warn('Invalid session token', { error: tokenError });
      res.status(401).json({
        error: 'Invalid session token',
        message: 'The session token is invalid or expired.',
      });
    }
  } catch (error) {
    logger.error('Session token auth error:', error);
    res.status(500).json({
      error: 'Authentication error',
      message: 'An error occurred during authentication.',
    });
  }
}
