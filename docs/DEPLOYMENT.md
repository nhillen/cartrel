# Cartrel Production Deployment Guide

## Server Infrastructure

**Server**: OVH VPS (shared with GridTome and AnteTown)

**Access**:
```bash
tailscale ssh root@vps-0b87e710.tail751d97.ts.net
```

**Tech Stack**:
- OS: Ubuntu Linux
- Reverse Proxy: Caddy (automatic HTTPS with Let's Encrypt)
- Container Runtime: Docker + Docker Compose
- Shared Infrastructure: PostgreSQL, Redis, MinIO (from GridTome)

## Port Allocation

**Cartrel Port**: `3002`

**Current Port Map**:
- 3000: GridTome (Next.js)
- 3001: AnteTown (Node.js)
- **3002: Cartrel (Node.js/Express) ← OURS**
- 5432: PostgreSQL (internal to Docker)
- 6379: Redis (exposed)
- 8080: Static file server
- 9000-9001: MinIO S3

## Deployment Strategy

### Option A: Shared Infrastructure (Recommended for MVP)

**Pros**:
- Lower resource usage
- Simpler setup
- Faster deployment

**Cons**:
- Coupled to GridTome infrastructure
- Shared database server

**Services Used**:
- PostgreSQL: `localhost:5432` (create separate `cartrel` database)
- Redis: `localhost:6379/2` (use DB 2, GridTome uses 0, AnteTown uses 1)
- MinIO: `localhost:9000` (create `cartrel` bucket)

### Option B: Separate Infrastructure

Create dedicated Docker services for complete isolation. Only use if resource usage becomes an issue.

---

## Pre-Deployment Checklist

### 1. DNS Configuration

```bash
# Add A record for cartrel.com pointing to OVH IP
# Get server IP:
tailscale ssh root@vps-0b87e710.tail751d97.ts.net "curl -4 ifconfig.me"
```

DNS Records needed:
- `A` record: `cartrel.com` → Server IP
- `CNAME` record: `www.cartrel.com` → `cartrel.com`

### 2. Shopify Partner Account

- Create Shopify Partner account
- Create new app in Partner Dashboard
- Configure OAuth redirect URL: `https://cartrel.com/auth/shopify/callback`
- Save API credentials to `.env.production`

### 3. Environment Variables

Create `/opt/cartrel/.env.production`:

```bash
# Node Environment
NODE_ENV=production
PORT=3002

# Public URL
APP_URL=https://cartrel.com

# Database (shared PostgreSQL)
DATABASE_URL=postgresql://gridtome:PASSWORD@localhost:5432/cartrel

# Redis (DB 2 for Cartrel)
REDIS_URL=redis://localhost:6379/2

# Shopify App Credentials
SHOPIFY_API_KEY=your_api_key_here
SHOPIFY_API_SECRET=your_api_secret_here
SHOPIFY_SCOPES=read_products,write_products,read_orders,write_orders,write_draft_orders,read_inventory,read_customers,write_metafields
SHOPIFY_APP_URL=https://cartrel.com

# Session Secret (generate with: openssl rand -base64 32)
SESSION_SECRET=your_session_secret_here

# Optional: Email (for notifications)
EMAIL_FROM=noreply@cartrel.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password

# Optional: MinIO/S3 (if using file uploads)
S3_ENDPOINT=localhost
S3_PORT=9000
S3_USE_SSL=false
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=cartrel
```

**Get GridTome PostgreSQL password**:
```bash
tailscale ssh root@vps-0b87e710.tail751d97.ts.net "grep POSTGRES_PASSWORD /opt/gridtome/.env"
```

---

## Initial Deployment

### Step 1: Create Cartrel Database

```bash
tailscale ssh root@vps-0b87e710.tail751d97.ts.net << 'ENDSSH'
# Create database in shared PostgreSQL
docker exec -it gridtome-db psql -U gridtome -c "CREATE DATABASE cartrel;"

# Grant permissions
docker exec -it gridtome-db psql -U gridtome -c "GRANT ALL PRIVILEGES ON DATABASE cartrel TO gridtome;"
ENDSSH
```

### Step 2: Deploy Application

```bash
# Create app directory
tailscale ssh root@vps-0b87e710.tail751d97.ts.net "mkdir -p /opt/cartrel"

# Clone repo and set up
tailscale ssh root@vps-0b87e710.tail751d97.ts.net << 'ENDSSH'
cd /opt/cartrel
git clone https://github.com/nhillen/cartrel.git .

# Copy environment file (you'll need to create .env.production with real values)
# Note: Create this file manually with proper secrets

# Start with Docker Compose
docker compose -f docker-compose.prod.yml up -d
ENDSSH
```

### Step 3: Run Database Migrations

```bash
tailscale ssh root@vps-0b87e710.tail751d97.ts.net << 'ENDSSH'
cd /opt/cartrel
docker compose exec app npx prisma migrate deploy
ENDSSH
```

### Step 4: Configure Caddy Reverse Proxy

```bash
# Edit Caddy configuration
tailscale ssh root@vps-0b87e710.tail751d97.ts.net "nano /etc/caddy/Caddyfile"
```

Add this block:

```
# Cartrel - Shopify Wholesale Infrastructure
www.cartrel.com, cartrel.com {
    reverse_proxy localhost:3002 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
        header_up X-Forwarded-Host {host}
    }
    log {
        output file /var/log/caddy/cartrel.log
    }
}
```

Reload Caddy:

```bash
tailscale ssh root@vps-0b87e710.tail751d97.ts.net << 'ENDSSH'
systemctl reload caddy
systemctl status caddy
ENDSSH
```

---

## Deployment Script

Create `deploy.sh` in project root:

```bash
#!/bin/bash
set -e

echo "🚀 Deploying Cartrel to production..."

# Check for uncommitted changes
if [[ -n $(git status -s) ]]; then
    echo "❌ Error: You have uncommitted changes"
    exit 1
fi

# Push to GitHub
echo "📤 Pushing to GitHub..."
git push origin main

# Deploy to production
echo "🔧 Deploying to server..."
tailscale ssh root@vps-0b87e710.tail751d97.ts.net << 'ENDSSH'
set -e

cd /opt/cartrel

echo "📥 Pulling latest code..."
git pull origin main

echo "🏗️  Building Docker image..."
docker compose -f docker-compose.prod.yml build app

echo "🗄️  Running migrations..."
docker compose -f docker-compose.prod.yml run --rm app npx prisma migrate deploy

echo "♻️  Restarting application..."
docker compose -f docker-compose.prod.yml up -d --force-recreate --no-deps app

echo "✅ Deployment complete!"

echo "📊 Container status:"
docker compose -f docker-compose.prod.yml ps

echo "📝 Recent logs:"
docker compose -f docker-compose.prod.yml logs --tail=50 app
ENDSSH

echo "✅ Deployment finished!"
echo "🌐 App should be live at: https://cartrel.com"
echo "📋 Check logs: tailscale ssh root@vps-0b87e710.tail751d97.ts.net 'docker logs -f cartrel-app'"
```

Make executable:
```bash
chmod +x deploy.sh
```

---

## Health Checks

### Verify App is Running

```bash
# Check if port 3002 is listening
tailscale ssh root@vps-0b87e710.tail751d97.ts.net "curl -I http://localhost:3002"

# Check from public URL
curl -I https://cartrel.com

# View application logs
tailscale ssh root@vps-0b87e710.tail751d97.ts.net "docker logs -f cartrel-app"

# View Caddy logs
tailscale ssh root@vps-0b87e710.tail751d97.ts.net "tail -f /var/log/caddy/cartrel.log"
```

### Database Connection Test

```bash
# Connect to database
tailscale ssh root@vps-0b87e710.tail751d97.ts.net << 'ENDSSH'
docker exec -it gridtome-db psql -U gridtome -d cartrel -c "\dt"
ENDSSH
```

### Redis Connection Test

```bash
# Test Redis connection
tailscale ssh root@vps-0b87e710.tail751d97.ts.net << 'ENDSSH'
redis-cli -n 2 ping
ENDSSH
```

---

## Updates & Maintenance

### Deploying Updates

```bash
# Simple deployment
./deploy.sh

# Or manually:
tailscale ssh root@vps-0b87e710.tail751d97.ts.net << 'ENDSSH'
cd /opt/cartrel
git pull
docker compose -f docker-compose.prod.yml build app
docker compose -f docker-compose.prod.yml up -d --force-recreate --no-deps app
ENDSSH
```

### Database Migrations

```bash
# Generate migration locally
npx prisma migrate dev --name your_migration_name

# Deploy to production
./deploy.sh  # Runs migrations automatically

# Or manually:
tailscale ssh root@vps-0b87e710.tail751d97.ts.net << 'ENDSSH'
cd /opt/cartrel
docker compose exec app npx prisma migrate deploy
ENDSSH
```

### Viewing Logs

```bash
# Application logs
tailscale ssh root@vps-0b87e710.tail751d97.ts.net "docker logs -f cartrel-app"

# Last 100 lines
tailscale ssh root@vps-0b87e710.tail751d97.ts.net "docker logs --tail 100 cartrel-app"

# Caddy logs
tailscale ssh root@vps-0b87e710.tail751d97.ts.net "tail -f /var/log/caddy/cartrel.log"
```

### Restarting Services

```bash
# Restart Cartrel
tailscale ssh root@vps-0b87e710.tail751d97.ts.net << 'ENDSSH'
cd /opt/cartrel
docker compose -f docker-compose.prod.yml restart app
ENDSSH

# Restart Caddy
tailscale ssh root@vps-0b87e710.tail751d97.ts.net "systemctl restart caddy"
```

---

## Resource Monitoring

```bash
# Check server resources
tailscale ssh root@vps-0b87e710.tail751d97.ts.net << 'ENDSSH'
echo "=== Disk Usage ==="
df -h

echo "=== Memory Usage ==="
free -h

echo "=== Docker Stats ==="
docker stats --no-stream

echo "=== Cartrel Specific ==="
docker stats cartrel-app --no-stream
ENDSSH
```

---

## Troubleshooting

### Port Already in Use

```bash
# Find what's using port 3002
tailscale ssh root@vps-0b87e710.tail751d97.ts.net "lsof -i :3002"

# Kill process
tailscale ssh root@vps-0b87e710.tail751d97.ts.net "kill -9 <PID>"
```

### Database Connection Fails

```bash
# Verify database exists
tailscale ssh root@vps-0b87e710.tail751d97.ts.net << 'ENDSSH'
docker exec gridtome-db psql -U gridtome -l | grep cartrel
ENDSSH

# Test connection from container
tailscale ssh root@vps-0b87e710.tail751d97.ts.net << 'ENDSSH'
docker compose exec app node -e "const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient(); prisma.\$connect().then(() => console.log('Connected!')).catch(e => console.error(e));"
ENDSSH
```

### Caddy Certificate Issues

```bash
# Check Caddy status
tailscale ssh root@vps-0b87e710.tail751d97.ts.net << 'ENDSSH'
systemctl status caddy
journalctl -u caddy -n 50
ENDSSH

# Validate configuration
tailscale ssh root@vps-0b87e710.tail751d97.ts.net "caddy validate --config /etc/caddy/Caddyfile"

# Force certificate renewal
tailscale ssh root@vps-0b87e710.tail751d97.ts.net << 'ENDSSH'
systemctl stop caddy
rm -rf /var/lib/caddy/.local/share/caddy/certificates/*
systemctl start caddy
ENDSSH
```

---

## Backup & Recovery

### Database Backup

```bash
# Backup database
tailscale ssh root@vps-0b87e710.tail751d97.ts.net << 'ENDSSH'
docker exec gridtome-db pg_dump -U gridtome cartrel > /opt/cartrel/backups/cartrel_$(date +%Y%m%d_%H%M%S).sql
ENDSSH

# Restore database
tailscale ssh root@vps-0b87e710.tail751d97.ts.net << 'ENDSSH'
docker exec -i gridtome-db psql -U gridtome cartrel < /opt/cartrel/backups/cartrel_20241110_120000.sql
ENDSSH
```

### Full Backup

```bash
# Backup entire /opt/cartrel directory
tailscale ssh root@vps-0b87e710.tail751d97.ts.net << 'ENDSSH'
tar -czf /root/cartrel_backup_$(date +%Y%m%d).tar.gz /opt/cartrel
ENDSSH
```

---

## Removal / Cleanup

If you need to remove Cartrel:

```bash
tailscale ssh root@vps-0b87e710.tail751d97.ts.net << 'ENDSSH'
# Stop containers
cd /opt/cartrel
docker compose -f docker-compose.prod.yml down

# Drop database
docker exec gridtome-db psql -U gridtome -c "DROP DATABASE cartrel;"

# Remove directory
rm -rf /opt/cartrel

# Remove Caddy config
nano /etc/caddy/Caddyfile  # Delete Cartrel block
systemctl reload caddy
ENDSSH
```

---

## Security Notes

1. **Never expose database port publicly** - PostgreSQL is only accessible within Docker network
2. **Use strong secrets** - Generate with `openssl rand -base64 32`
3. **Secure .env files** - `chmod 600 /opt/cartrel/.env.production`
4. **Separate Redis databases** - Use DB 2 to avoid conflicts
5. **HTTPS only** - Caddy handles this automatically
6. **Regular backups** - Automate database backups

---

## Contact

For deployment issues:
- Check this guide first
- Review logs: `docker logs cartrel-app`
- Check Caddy logs: `/var/log/caddy/cartrel.log`
- Verify DNS: `dig cartrel.com`
