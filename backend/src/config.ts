import { z } from 'zod';

// Environment variable schema with validation
const envSchema = z.object({
  // Node environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).pipe(z.number().int().positive()).default('3002'),

  // URLs
  APP_URL: z.string().url(),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // Shopify
  SHOPIFY_API_KEY: z.string().min(1),
  SHOPIFY_API_SECRET: z.string().min(1),
  SHOPIFY_SCOPES: z.string(),
  SHOPIFY_APP_URL: z.string().url(),

  // Session
  SESSION_SECRET: z.string().min(32),

  // Optional: Email
  EMAIL_FROM: z.string().email().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().transform(Number).pipe(z.number().int().positive()).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),

  // Optional: S3/MinIO
  S3_ENDPOINT: z.string().optional(),
  S3_PORT: z.string().transform(Number).pipe(z.number().int().positive()).optional(),
  S3_USE_SSL: z.string().transform((val) => val === 'true').optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_BUCKET: z.string().optional(),
});

// Parse and validate environment variables
const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsedEnv.error.format());
  process.exit(1);
}

const env = parsedEnv.data;

// Export typed config
export const config = {
  // Environment
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  isDevelopment: env.NODE_ENV === 'development',
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',

  // URLs
  appUrl: env.APP_URL,

  // Database
  databaseUrl: env.DATABASE_URL,

  // Redis
  redisUrl: env.REDIS_URL,

  // Shopify
  shopify: {
    apiKey: env.SHOPIFY_API_KEY,
    apiSecret: env.SHOPIFY_API_SECRET,
    scopes: env.SHOPIFY_SCOPES.split(',').map(s => s.trim()),
    appUrl: env.SHOPIFY_APP_URL,
    hostName: new URL(env.SHOPIFY_APP_URL).hostname,
  },

  // Session
  sessionSecret: env.SESSION_SECRET,

  // Email (optional)
  email: env.EMAIL_FROM ? {
    from: env.EMAIL_FROM,
    smtp: {
      host: env.SMTP_HOST!,
      port: env.SMTP_PORT!,
      user: env.SMTP_USER!,
      password: env.SMTP_PASSWORD!,
    },
  } : undefined,

  // S3/MinIO (optional)
  s3: env.S3_ENDPOINT ? {
    endpoint: env.S3_ENDPOINT,
    port: env.S3_PORT!,
    useSSL: env.S3_USE_SSL || false,
    accessKey: env.S3_ACCESS_KEY!,
    secretKey: env.S3_SECRET_KEY!,
    bucket: env.S3_BUCKET!,
  } : undefined,
} as const;
