import rateLimit from 'express-rate-limit';
import { logger } from '../utils/logger';

/**
 * Rate limiting middleware configurations
 *
 * Protects against DoS attacks and brute force attempts by limiting
 * the number of requests from a single IP address within a time window.
 */

/**
 * General API rate limit - applied to most routes
 * 100 requests per 15 minutes per IP
 */
export const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  message: 'Too many requests from this IP, please try again later.',
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      method: req.method,
    });
    res.status(429).json({
      error: 'Too many requests',
      message: 'You have exceeded the rate limit. Please try again later.',
      retryAfter: Math.ceil(15 * 60 / 60), // minutes
    });
  },
});

/**
 * Authentication rate limit - applied to login/OAuth routes
 * 10 requests per 15 minutes per IP (stricter for auth endpoints)
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 auth attempts per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false, // Count all requests
  message: 'Too many authentication attempts from this IP, please try again later.',
  handler: (req, res) => {
    logger.warn('Auth rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      shop: req.query.shop,
    });
    res.status(429).json({
      error: 'Too many authentication attempts',
      message: 'You have exceeded the authentication rate limit. Please try again in 15 minutes.',
      retryAfter: 15,
    });
  },
});

/**
 * Webhook rate limit - applied to webhook endpoints
 * 1000 requests per minute per IP (generous for legitimate webhooks)
 */
export const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 1000, // Allow 1000 webhook deliveries per minute
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true, // Don't count failed requests (invalid HMAC)
  message: 'Too many webhook requests from this IP.',
  handler: (req, res) => {
    logger.warn('Webhook rate limit exceeded', {
      ip: req.ip,
      topic: req.params.topic,
      shop: req.get('X-Shopify-Shop-Domain'),
    });
    res.status(429).json({
      error: 'Rate limit exceeded',
      message: 'Too many webhook requests.',
    });
  },
});

/**
 * Order placement rate limit - applied to order creation endpoints
 * 20 orders per hour per IP (prevents order spam)
 */
export const orderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // Limit to 20 order placements per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many orders placed from this IP, please try again later.',
  handler: (req, res) => {
    logger.warn('Order rate limit exceeded', {
      ip: req.ip,
      shop: req.body.shop,
    });
    res.status(429).json({
      error: 'Order rate limit exceeded',
      message: 'You have placed too many orders. Please try again in an hour.',
      retryAfter: 60, // minutes
    });
  },
});

/**
 * Connection invite rate limit - applied to invite creation endpoints
 * 50 invites per hour per IP (prevents invite spam)
 */
export const inviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // Limit to 50 invites per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many invites created from this IP, please try again later.',
  handler: (req, res) => {
    logger.warn('Invite rate limit exceeded', {
      ip: req.ip,
      shop: req.body.shop,
    });
    res.status(429).json({
      error: 'Invite rate limit exceeded',
      message: 'You have created too many invites. Please try again in an hour.',
      retryAfter: 60, // minutes
    });
  },
});

/**
 * Product sync rate limit - applied to product sync endpoints
 * 10 syncs per hour per IP (product syncing is resource-intensive)
 */
export const syncLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit to 10 syncs per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many sync operations from this IP, please try again later.',
  handler: (req, res) => {
    logger.warn('Sync rate limit exceeded', {
      ip: req.ip,
      shop: req.body.shop,
    });
    res.status(429).json({
      error: 'Sync rate limit exceeded',
      message: 'You have triggered too many sync operations. Please try again in an hour.',
      retryAfter: 60, // minutes
    });
  },
});
