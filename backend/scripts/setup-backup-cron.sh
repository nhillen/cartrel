#!/bin/bash
set -e

# Setup automated daily database backups via cron
# Run this script once on the production server to configure backups

CRON_TIME="0 3 * * *"  # 3 AM daily
SCRIPT_PATH="/opt/cartrel/scripts/backup-database.sh"
LOG_PATH="/opt/cartrel/logs/backup.log"

echo "🔧 Setting up automated database backups..."

# Make backup script executable
chmod +x "$SCRIPT_PATH"

# Create log directory if it doesn't exist
mkdir -p /opt/cartrel/logs

# Add cron job if it doesn't exist
CRON_CMD="$CRON_TIME $SCRIPT_PATH >> $LOG_PATH 2>&1"

if ! crontab -l 2>/dev/null | grep -q "$SCRIPT_PATH"; then
  # Add to crontab
  (crontab -l 2>/dev/null; echo "$CRON_CMD") | crontab -
  echo "✅ Cron job added: Daily backups at 3:00 AM"
  echo "   Script: $SCRIPT_PATH"
  echo "   Log: $LOG_PATH"
else
  echo "ℹ️  Cron job already exists"
fi

# Show current crontab
echo ""
echo "📋 Current backup schedule:"
crontab -l | grep "$SCRIPT_PATH" || echo "  None found"

echo ""
echo "✅ Backup setup complete!"
echo ""
echo "Manual commands:"
echo "  Run backup now:  $SCRIPT_PATH"
echo "  View backups:    ls -lh /opt/cartrel/backups/"
echo "  View logs:       tail -f $LOG_PATH"
echo "  Restore backup:  /opt/cartrel/scripts/restore-database.sh <backup-file>"
