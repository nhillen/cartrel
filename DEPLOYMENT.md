# Deployment Strategy for Cartrel

## Current Setup (Single Production Environment)

**Status:** You're currently deploying directly to production with no staging environment.

### Current Workflow:
1. Develop locally
2. Commit to `main` branch
3. Run `./deploy.sh`
4. Changes go live immediately

### Risks:
- No testing environment before production
- Schema changes go straight to production database
- Bugs reach users immediately
- No rollback strategy
- Downtime during deployments

---

## Recommended Production-Ready Strategy

### 1. Environment Tiers

#### **Development (Local)**
- Local Docker setup
- PostgreSQL in Docker
- Hot reload for fast development
- Test Shopify app credentials

#### **Staging (New)**
- Separate VPS or Docker container on same server
- Copy of production database (anonymized)
- Separate Shopify Partner app for testing
- URL: `staging.cartrel.com` or `cartrel-staging.com`
- Test billing in Shopify test mode

#### **Production**
- Current setup: `cartrel.com`
- Real customer data
- Real Shopify apps
- Real billing

### 2. Branch Strategy

```
main (production)
  ├── staging (auto-deploy to staging)
  └── feature/* (development branches)
```

**Workflow:**
1. Create feature branch: `feature/billing-annual`
2. Develop and test locally
3. Open PR to `staging` branch
4. Auto-deploy to staging environment
5. Test on staging with real-ish data
6. Merge `staging` → `main` when ready
7. Deploy to production

### 3. Database Migration Strategy

#### **For Breaking Changes:**
```bash
# Example: Adding a required field

# Step 1: Add field as nullable
ALTER TABLE "Shop" ADD COLUMN "newField" TEXT;

# Step 2: Deploy code that populates the field
# (backfill script or gradual population)

# Step 3: After backfill, make it required
ALTER TABLE "Shop" ALTER COLUMN "newField" SET NOT NULL;
```

#### **For Non-Breaking Changes:**
```bash
# Safe to deploy directly
ALTER TABLE "Shop" ADD COLUMN "optionalField" TEXT;
ALTER TABLE "Shop" ADD COLUMN "jsonField" JSONB;
```

#### **Prisma Migration Best Practices:**
1. **Don't use `prisma migrate dev` in production**
2. Use `prisma migrate deploy` instead (applies existing migrations)
3. Create migrations locally, test on staging, then deploy to production
4. Keep migrations small and focused

---

## 4. Zero-Downtime Deployments

### Current Issue:
Your current deployment has brief downtime during Docker restart.

### Solution: Blue-Green Deployment

**Setup:**
```yaml
# docker-compose.prod.yml
services:
  cartrel-app-blue:
    container_name: cartrel-app-blue
    ports:
      - "3002:3002"

  cartrel-app-green:
    container_name: cartrel-app-green
    ports:
      - "3003:3002"

  nginx:
    image: nginx
    ports:
      - "80:80"
      - "443:443"
    # Routes to blue or green based on config
```

**Deployment Process:**
1. New code deploys to "green" container (3003)
2. Run health checks on green
3. If healthy, switch nginx to point to green
4. Blue becomes standby for next deployment
5. Next deployment goes to blue, then switch back

**Benefits:**
- Zero downtime
- Instant rollback (switch nginx back)
- Test new version before switching traffic

---

## 5. Rollback Strategy

### Quick Rollback (Minutes):
```bash
# Switch nginx to previous container (blue-green)
# OR
# Revert to previous Docker image
docker tag cartrel-app:previous cartrel-app:latest
docker-compose up -d --force-recreate app
```

### Full Rollback (If database changed):
```bash
# 1. Revert code
git revert <commit-sha>
git push

# 2. Rollback database migration
prisma migrate resolve --rolled-back <migration-name>

# 3. Deploy previous version
./deploy.sh
```

### Prevention:
- Always test schema changes on staging first
- Make schema changes backwards-compatible when possible
- Keep database backups (see below)

---

## 6. Database Backup Strategy

### Automated Daily Backups:
```bash
# Add to crontab on VPS
0 2 * * * docker exec gridtome-db pg_dump -U gridtome cartrel > /backups/cartrel-$(date +\%Y\%m\%d).sql
```

### Before Major Changes:
```bash
# Manual backup before risky deployments
docker exec gridtome-db pg_dump -U gridtome cartrel > cartrel-backup-$(date +\%Y\%m\%d-%H%M).sql
```

### Restore from Backup:
```bash
# Stop app
docker stop cartrel-app

# Restore database
docker exec -i gridtome-db psql -U gridtome -d cartrel < cartrel-backup-20250111.sql

# Restart app
docker start cartrel-app
```

---

## 7. Handling Downtime (Maintenance Mode)

### Option 1: Nginx Maintenance Page
```nginx
# /etc/nginx/sites-available/cartrel.com
server {
    listen 80;
    server_name cartrel.com;

    # Return 503 during maintenance
    if (-f /var/www/maintenance.html) {
        return 503;
    }

    error_page 503 @maintenance;
    location @maintenance {
        root /var/www;
        rewrite ^(.*)$ /maintenance.html break;
    }

    location / {
        proxy_pass http://localhost:3002;
    }
}
```

**Enable maintenance:**
```bash
touch /var/www/maintenance.html
nginx -s reload
```

### Option 2: App-Level Maintenance Mode
```typescript
// Add to index.ts
const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === 'true';

app.use((req, res, next) => {
  if (MAINTENANCE_MODE && !req.path.startsWith('/health')) {
    return res.status(503).send('Maintenance in progress. Back soon!');
  }
  next();
});
```

---

## 8. Monitoring & Alerts

### Health Checks:
```bash
# Current health endpoint
curl https://cartrel.com/health

# Add to monitoring service (UptimeRobot, Pingdom, etc.)
# Alert if down for > 2 minutes
```

### Log Monitoring:
```bash
# View live logs
tailscale ssh root@vps-0b87e710.tail751d97.ts.net 'docker logs -f cartrel-app'

# Search for errors
tailscale ssh root@vps-0b87e710.tail751d97.ts.net 'docker logs cartrel-app | grep ERROR'
```

### Database Monitoring:
```sql
-- Check connection count
SELECT count(*) FROM pg_stat_activity WHERE datname = 'cartrel';

-- Check slow queries
SELECT query, calls, mean_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

---

## 9. Staging Environment Setup

### Quick Setup (Same Server):
```yaml
# docker-compose.staging.yml
services:
  cartrel-app-staging:
    container_name: cartrel-app-staging
    build: .
    ports:
      - "3004:3002"
    environment:
      - NODE_ENV=staging
      - DATABASE_URL=postgresql://gridtome:gridtome_dev@gridtome-db:5432/cartrel_staging
      - APP_URL=https://staging.cartrel.com
    env_file:
      - .env.staging
```

### Deploy Script for Staging:
```bash
#!/bin/bash
# deploy-staging.sh
set -e

echo "🚀 Deploying to STAGING..."
git push origin staging

tailscale ssh root@vps-0b87e710.tail751d97.ts.net << 'ENDSSH'
cd /opt/cartrel
git checkout staging
git pull origin staging
docker compose -f docker-compose.staging.yml build app
docker compose -f docker-compose.staging.yml up -d app
ENDSSH

echo "✅ Staging deployment complete!"
echo "🌐 https://staging.cartrel.com"
```

### Staging Database:
```bash
# Create staging database (anonymized copy of production)
docker exec gridtome-db createdb -U gridtome cartrel_staging
docker exec gridtome-db pg_dump -U gridtome cartrel | \
  docker exec -i gridtome-db psql -U gridtome cartrel_staging

# Anonymize sensitive data
docker exec gridtome-db psql -U gridtome -d cartrel_staging -c "
  UPDATE \"Shop\" SET email = CONCAT('test+', id, '@example.com');
  UPDATE \"Shop\" SET accessToken = 'test-token-' || id;
"
```

---

## 10. CI/CD Pipeline (Future)

### GitHub Actions Workflow:
```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run tests
        run: npm test

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - name: Deploy via Tailscale
        run: |
          tailscale up --authkey=${{ secrets.TAILSCALE_KEY }}
          ssh root@vps-0b87e710.tail751d97.ts.net './deploy.sh'
```

### Benefits:
- Automated testing before deploy
- Deploy on merge to main
- Slack notifications on deploy
- Automatic rollback on failure

---

## 11. Common Deployment Scenarios

### Scenario 1: Add New Feature (No Schema Change)
1. Develop on feature branch
2. Test locally
3. Merge to `staging`, test on staging
4. Merge to `main`
5. `./deploy.sh` (zero downtime)

### Scenario 2: Add New Database Field
1. Create Prisma migration locally
2. Test migration on local DB
3. Deploy to staging, run migration
4. Test feature on staging
5. Deploy to production:
   ```bash
   # Add column to production
   tailscale ssh root@vps 'docker exec gridtome-db psql -U gridtome -d cartrel -c "ALTER TABLE \"Shop\" ADD COLUMN \"newField\" TEXT;"'

   # Deploy code
   ./deploy.sh
   ```

### Scenario 3: Breaking Database Change
1. Deploy backwards-compatible version first
2. Run data migration script
3. Deploy new version that requires the change
4. Remove old code paths

### Scenario 4: Emergency Hotfix
1. Create hotfix branch from `main`
2. Fix bug
3. Test quickly on staging
4. Merge to `main` and deploy immediately
5. Skip staging if critical

---

## 12. Pre-Deployment Checklist

Before running `./deploy.sh`:

- [ ] Code reviewed and tested locally
- [ ] Database migrations tested on staging
- [ ] No breaking API changes (or coordinated with frontend)
- [ ] Environment variables updated if needed
- [ ] Database backup taken (for risky changes)
- [ ] Rollback plan documented
- [ ] Off-hours deployment scheduled (if risky)
- [ ] Monitoring/alerts active
- [ ] Stakeholders notified (if customer-facing changes)

---

## 13. Current Deployment Improvements (Quick Wins)

### Implement These First:
1. **Add staging environment** (1-2 hours)
2. **Automated database backups** (30 minutes)
3. **Health check monitoring** (30 minutes)
4. **Blue-green deployment** (2-3 hours)
5. **Maintenance mode toggle** (1 hour)

### Commands to Add:
```bash
# deploy-staging.sh
./deploy-staging.sh

# backup-db.sh
./backup-db.sh

# restore-db.sh <backup-file>
./restore-db.sh cartrel-backup-20250111.sql

# rollback.sh
./rollback.sh
```

---

## 14. Production Readiness Score

**Current State:** 🟡 Basic (60/100)
- ✅ Docker containerization
- ✅ Automated deployment script
- ✅ Health check endpoint
- ✅ Git version control
- ❌ No staging environment
- ❌ No automated backups
- ❌ No zero-downtime deployment
- ❌ No monitoring/alerts
- ❌ No CI/CD

**Target State:** 🟢 Production-Ready (95/100)
- ✅ Everything above, plus:
- ✅ Staging environment
- ✅ Automated daily backups
- ✅ Blue-green deployment
- ✅ Uptime monitoring
- ✅ Error tracking (Sentry)
- ✅ CI/CD pipeline
- ✅ Rollback procedures
- ✅ Load testing
- ✅ Security audit

---

## Summary

**Your deployment is functional but has risks.** The biggest issues:

1. **No staging** = bugs go straight to production
2. **Downtime during deploys** = poor user experience
3. **No automated backups** = data loss risk
4. **Manual migrations** = human error risk

**Recommended next steps (in order):**
1. Set up staging environment (this weekend)
2. Implement automated backups (30 min)
3. Add uptime monitoring (30 min)
4. Implement blue-green deployment (next sprint)
5. Set up CI/CD (when time permits)

Would you like me to help implement any of these? I can create the staging setup, backup scripts, or blue-green deployment configuration.
