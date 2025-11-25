#!/bin/bash
set -e

# ============================================================================
# DEPRECATED: Manual deployment script
# ============================================================================
# This script is DEPRECATED. Use GitHub Actions instead:
#   - Push to main branch for automatic deployment
#   - Or manually trigger: gh workflow run deploy.yml
#
# This script remains for emergency fallback only.
# ============================================================================

echo "⚠️  WARNING: This script is deprecated. Prefer GitHub Actions deployment."
echo "   To deploy via GitHub Actions: gh workflow run deploy.yml"
echo ""
read -p "Continue with manual deployment? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted. Use 'gh workflow run deploy.yml' instead."
    exit 0
fi

echo "🚀 Deploying Cartrel to production..."

# Check for uncommitted changes
if [[ -n $(git status -s) ]]; then
    echo "❌ Error: You have uncommitted changes"
    git status -s
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

echo "🔗 Copying monorepo dependencies..."
# Copy manabot slack-reporter package for Docker build
rm -rf /opt/cartrel/backend/slack-reporter
cp -r /opt/manabot/packages/slack-reporter /opt/cartrel/backend/slack-reporter

echo "🎨 Building embedded frontend..."
cd /opt/cartrel/frontend
npm install
npm run build
cd /opt/cartrel

echo "🏗️  Building Docker images..."
docker compose -f docker-compose.prod.yml build app admin

echo "🧹 Cleaning up copied dependencies..."
rm -rf /opt/cartrel/backend/slack-reporter

echo "🗄️  Running migrations..."
docker compose -f docker-compose.prod.yml run --rm app npx prisma migrate deploy

echo "♻️  Restarting applications..."
docker compose -f docker-compose.prod.yml up -d --force-recreate --no-deps app admin

echo "✅ Deployment complete!"

echo ""
echo "📊 Container status:"
docker compose -f docker-compose.prod.yml ps

echo ""
echo "📝 Recent logs:"
docker compose -f docker-compose.prod.yml logs --tail=50 app
ENDSSH

echo ""
echo "✅ Deployment finished!"
echo "🌐 App should be live at: https://cartrel.com"
echo "💚 Health check: https://cartrel.com/health"
echo "📋 Check logs: tailscale ssh root@vps-0b87e710.tail751d97.ts.net 'docker logs -f cartrel-app'"
