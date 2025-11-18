#!/bin/bash
set -e

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

echo "🎨 Building embedded frontend..."
cd /opt/cartrel/frontend
npm install
npm run build
cd /opt/cartrel

echo "🏗️  Building Docker image..."
docker compose -f docker-compose.prod.yml build app

echo "🗄️  Running migrations..."
docker compose -f docker-compose.prod.yml run --rm app npx prisma migrate deploy

echo "♻️  Restarting application..."
docker compose -f docker-compose.prod.yml up -d --force-recreate --no-deps app

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
