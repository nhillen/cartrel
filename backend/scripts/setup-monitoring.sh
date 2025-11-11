#!/bin/bash
set -e

# Setup automated health monitoring via cron
# Run this script once on the production server to configure monitoring

CRON_TIME="*/5 * * * *"  # Every 5 minutes
SCRIPT_PATH="/opt/cartrel/scripts/healthcheck-monitor.sh"
LOG_PATH="/opt/cartrel/logs/healthcheck.log"

echo "🔧 Setting up health monitoring..."

# Make script executable
chmod +x "$SCRIPT_PATH"

# Create log directory if it doesn't exist
mkdir -p /opt/cartrel/logs

# Add cron job if it doesn't exist
CRON_CMD="$CRON_TIME $SCRIPT_PATH >> $LOG_PATH 2>&1"

if ! crontab -l 2>/dev/null | grep -q "$SCRIPT_PATH"; then
  # Add to crontab
  (crontab -l 2>/dev/null; echo "$CRON_CMD") | crontab -
  echo "✅ Cron job added: Health checks every 5 minutes"
  echo "   Script: $SCRIPT_PATH"
  echo "   Log: $LOG_PATH"
else
  echo "ℹ️  Cron job already exists"
fi

# Show current crontab
echo ""
echo "📋 Current monitoring schedule:"
crontab -l | grep "$SCRIPT_PATH" || echo "  None found"

echo ""
echo "✅ Monitoring setup complete!"
echo ""
echo "Optional: Set ALERT_WEBHOOK environment variable for alerts"
echo "  Example: export ALERT_WEBHOOK='https://discord.com/api/webhooks/...'"
echo ""
echo "Manual commands:"
echo "  Run check now:   $SCRIPT_PATH"
echo "  View logs:       tail -f $LOG_PATH"
echo "  Test alert:      ALERT_WEBHOOK='your-webhook-url' $SCRIPT_PATH"
