# Cartrel Backend

Node.js/TypeScript/Express backend for Cartrel - Shopify wholesale infrastructure.

## Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Redis 7+

## Quick Start (Local Development)

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Environment Variables

```bash
cp .env.example .env
# Edit .env with your values
```

Required environment variables:
- `SHOPIFY_API_KEY` - Get from Shopify Partner Dashboard
- `SHOPIFY_API_SECRET` - Get from Shopify Partner Dashboard
- `SESSION_SECRET` - Generate with: `openssl rand -base64 32`

### 3. Start Database and Redis (Docker)

From the project root:

```bash
docker compose up db redis -d
```

This starts PostgreSQL on port 5432 and Redis on port 6379.

### 4. Run Database Migrations

```bash
npm run db:migrate
```

This will:
- Create the database schema
- Generate Prisma client

### 5. Start Development Server

```bash
npm run dev
```

The server will start on `http://localhost:3002`

Visit:
- Health check: http://localhost:3002/health
- Queue monitor: http://localhost:3002/admin/queues

## Available Scripts

```bash
npm run dev          # Start development server with hot reload
npm run build        # Build for production
npm start            # Start production server
npm run db:generate  # Generate Prisma client
npm run db:migrate   # Run database migrations (dev)
npm run db:deploy    # Deploy migrations (production)
npm run db:studio    # Open Prisma Studio (database GUI)
npm run lint         # Run ESLint
npm run type-check   # TypeScript type checking
```

## Project Structure

```
backend/
├── src/
│   ├── index.ts              # Application entry point
│   ├── config.ts             # Configuration and env validation
│   ├── routes/               # Express routes
│   │   ├── auth.ts           # Shopify OAuth
│   │   ├── shop.ts           # Shop management
│   │   └── webhooks.ts       # Webhook handlers
│   ├── queues/               # Bull queue configuration
│   │   ├── index.ts          # Queue initialization
│   │   └── processors/       # Queue job processors
│   │       └── webhook.ts    # Webhook processing
│   ├── middleware/           # Express middleware
│   │   └── errorHandler.ts  # Global error handling
│   └── utils/                # Utility functions
│       └── logger.ts         # Logging utility
├── prisma/
│   └── schema.prisma         # Database schema
├── Dockerfile                # Docker image definition
├── tsconfig.json             # TypeScript configuration
├── package.json              # Dependencies and scripts
└── .env.example              # Environment variable template
```

## Development Workflow

### Adding a New Route

1. Create route file in `src/routes/`
2. Import and mount in `src/index.ts`
3. Add any necessary middleware

### Database Changes

1. Edit `prisma/schema.prisma`
2. Run `npm run db:migrate` to create migration
3. Commit the migration files

### Adding a Webhook Handler

1. Add webhook processing logic to `src/queues/processors/webhook.ts`
2. Update the `processWebhook` switch statement

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Debugging

### VS Code Launch Configuration

Add to `.vscode/launch.json`:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Backend",
  "runtimeExecutable": "npm",
  "runtimeArgs": ["run", "dev"],
  "skipFiles": ["<node_internals>/**"],
  "console": "integratedTerminal"
}
```

### Inspecting Database

```bash
# Open Prisma Studio
npm run db:studio

# Or connect with psql
psql postgresql://cartrel:cartrel@localhost:5432/cartrel
```

### Monitoring Queues

Visit http://localhost:3002/admin/queues (development only)

## Production Deployment

See [DEPLOYMENT.md](../docs/DEPLOYMENT.md) for full deployment instructions.

Quick deploy:

```bash
# From project root
./deploy.sh
```

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `NODE_ENV` | Environment (development/production) | No | development |
| `PORT` | Server port | No | 3002 |
| `APP_URL` | Public URL for OAuth callbacks | Yes | - |
| `DATABASE_URL` | PostgreSQL connection string | Yes | - |
| `REDIS_URL` | Redis connection string | Yes | - |
| `SHOPIFY_API_KEY` | Shopify app API key | Yes | - |
| `SHOPIFY_API_SECRET` | Shopify app API secret | Yes | - |
| `SHOPIFY_SCOPES` | Comma-separated OAuth scopes | Yes | - |
| `SESSION_SECRET` | Session encryption secret | Yes | - |

## Troubleshooting

### Port already in use

```bash
# Find process using port 3002
lsof -i :3002

# Kill it
kill -9 <PID>
```

### Database connection fails

```bash
# Check if PostgreSQL is running
docker compose ps db

# Check connection
psql postgresql://cartrel:cartrel@localhost:5432/cartrel
```

### Redis connection fails

```bash
# Check if Redis is running
docker compose ps redis

# Test connection
redis-cli -n 2 ping
```

## License

Proprietary - All rights reserved
