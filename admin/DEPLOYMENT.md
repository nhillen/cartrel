# Admin Dashboard Deployment Guide

## Overview

The admin dashboard is a Next.js application that runs as a separate Docker container alongside the main Cartrel backend. It's accessible at `admin.cartrel.com` and provides Customer Success tools for managing shops, plans, and platform statistics.

## Architecture

- **Container**: `cartrel-admin`
- **Port**: 3001 (internal)
- **Public URL**: https://admin.cartrel.com
- **Backend API**: https://cartrel.com/api/admin

## Deployment Process

The admin app is automatically deployed via:

1. **GitHub Actions**: Pushes to `main` trigger `.github/workflows/deploy.yml`
2. **Manual Deploy**: Run `./deploy.sh` from project root

Both methods:
- Build the Next.js app with standalone output
- Create a Docker image
- Deploy to production server via Tailscale SSH
- Restart the container

## Environment Variables

Production environment variables are stored in `.env.production.admin` on the server.

Required variables:
```bash
AUTH_SECRET='<32-byte random string>'
NEXTAUTH_URL='https://admin.cartrel.com'
NEXT_PUBLIC_API_URL='https://cartrel.com/api/admin'
NEXT_PUBLIC_API_BASE_URL='https://cartrel.com'
```

To generate AUTH_SECRET:
```bash
openssl rand -base64 32
```

## Initial Setup on Server

1. **Create production environment file**:
```bash
cd /opt/cartrel
cp .env.production.admin.example .env.production.admin
nano .env.production.admin  # Fill in values
```

2. **Configure reverse proxy** (Caddy/nginx) to route `admin.cartrel.com` to `localhost:3001`:

### Caddy Configuration:
```
admin.cartrel.com {
    reverse_proxy localhost:3001
}
```

### Nginx Configuration:
```nginx
server {
    listen 80;
    listen [::]:80;
    server_name admin.cartrel.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

3. **Deploy for first time**:
```bash
./deploy.sh
```

## Authentication

The admin dashboard uses NextAuth.js with credentials provider:

- **Email**: admin@cartrel.com
- **Password**: Set in `lib/auth.config.ts` (hardcoded temporarily)

Future enhancement: Move admin users to database.

## Health Checks

- **Container health**: `http://localhost:3001/api/health`
- **Public health**: `https://admin.cartrel.com/api/health`

## Troubleshooting

### Check container status:
```bash
docker compose -f docker-compose.prod.yml ps admin
```

### View logs:
```bash
docker compose -f docker-compose.prod.yml logs -f admin
```

### Restart container:
```bash
docker compose -f docker-compose.prod.yml restart admin
```

### Rebuild and redeploy:
```bash
docker compose -f docker-compose.prod.yml build admin
docker compose -f docker-compose.prod.yml up -d --force-recreate admin
```

## Local Development

```bash
cd admin
npm install
npm run dev  # Runs on http://localhost:3001
```

Make sure backend is running on `localhost:3000` for API access.
