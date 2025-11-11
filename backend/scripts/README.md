# Cartrel Production Scripts

This directory contains scripts for database backups, monitoring, and production management.

## 📦 Database Backups

### Setup (Run Once)
```bash
cd /opt/cartrel
chmod +x scripts/*.sh
./scripts/setup-backup-cron.sh
```

This configures daily backups at 3:00 AM.

### Manual Backup
```bash
./scripts/backup-database.sh
```

### Restore from Backup
```bash
# List available backups
ls -lh /opt/cartrel/backups/

# Restore specific backup
./scripts/restore-database.sh /opt/cartrel/backups/cartrel_backup_20250111_030000.sql.gz
```

### Backup Details
- **Location**: `/opt/cartrel/backups/`
- **Format**: Compressed SQL dumps (`.sql.gz`)
- **Retention**: 30 days (automatic cleanup)
- **Schedule**: Daily at 3:00 AM
- **Logs**: `/opt/cartrel/logs/backup.log`

---

## 🔍 Health Monitoring

### Setup (Run Once)
```bash
./scripts/setup-monitoring.sh
```

This configures health checks every 5 minutes.

### Manual Health Check
```bash
./scripts/healthcheck-monitor.sh
```

### With Alerts (Optional)
```bash
# Set webhook URL for Discord/Slack alerts
export ALERT_WEBHOOK='https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN'

# Run check (will alert if down)
./scripts/healthcheck-monitor.sh
```

### Monitoring Details
- **Frequency**: Every 5 minutes
- **Endpoint**: `https://cartrel.com/health`
- **Timeout**: 10 seconds
- **Logs**: `/opt/cartrel/logs/healthcheck.log`
- **Alerts**: Optional webhook notifications

---

## 🔔 Setting Up Alerts

### Discord Webhook
1. Go to Server Settings → Integrations → Webhooks
2. Create webhook, copy URL
3. Add to server environment:
   ```bash
   echo 'ALERT_WEBHOOK=https://discord.com/api/webhooks/...' >> /opt/cartrel/.env.production
   ```

### Slack Webhook
1. Go to https://api.slack.com/messaging/webhooks
2. Create webhook, copy URL
3. Add to server environment (same as above)

---

## 📊 Viewing Logs

```bash
# Backup logs
tail -f /opt/cartrel/logs/backup.log

# Health check logs
tail -f /opt/cartrel/logs/healthcheck.log

# Application logs
docker compose -f /opt/cartrel/docker-compose.prod.yml logs -f app
```

---

## 🔧 Maintenance Commands

### Check Backup Status
```bash
# List all backups
ls -lh /opt/cartrel/backups/

# Check disk usage
du -sh /opt/cartrel/backups/

# Count backups
ls /opt/cartrel/backups/ | wc -l
```

### Check Cron Jobs
```bash
# View scheduled jobs
crontab -l

# Check if backup/monitoring are scheduled
crontab -l | grep -E 'backup|healthcheck'
```

### Test Database Connection
```bash
# From within app container
docker compose -f /opt/cartrel/docker-compose.prod.yml exec app npx prisma db pull

# Direct connection
docker exec -it gridtome-db psql -U gridtome -d cartrel -c '\dt'
```

---

## 🆘 Troubleshooting

### Backup Fails
```bash
# Check logs
tail -n 50 /opt/cartrel/logs/backup.log

# Test manually
cd /opt/cartrel
./scripts/backup-database.sh
```

### Monitoring Alerts Not Working
```bash
# Test webhook
curl -X POST "$ALERT_WEBHOOK" \
  -H "Content-Type: application/json" \
  -d '{"content": "Test alert from Cartrel"}'

# Check monitoring logs
tail -n 50 /opt/cartrel/logs/healthcheck.log
```

### Restore Backup
```bash
# 1. Stop application
cd /opt/cartrel
docker compose -f docker-compose.prod.yml stop app

# 2. Restore database
./scripts/restore-database.sh /opt/cartrel/backups/cartrel_backup_YYYYMMDD_HHMMSS.sql.gz

# 3. Start application
docker compose -f docker-compose.prod.yml start app
```
