#!/bin/bash
set -e

# Database backup script for Cartrel
# Backs up PostgreSQL database to local storage with rotation

BACKUP_DIR="/opt/cartrel/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/cartrel_backup_$TIMESTAMP.sql.gz"
RETENTION_DAYS=30

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Database connection info (from environment or defaults)
DB_HOST="${DB_HOST:-gridtome-db}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-cartrel}"
DB_USER="${DB_USER:-gridtome}"

echo "🗄️  Starting database backup..."
echo "   Database: $DB_NAME"
echo "   Host: $DB_HOST:$DB_PORT"
echo "   Backup file: $BACKUP_FILE"

# Perform backup using pg_dump, compress with gzip
if PGPASSWORD="$DB_PASSWORD" pg_dump \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --no-owner \
  --no-acl \
  --clean \
  --if-exists \
  | gzip > "$BACKUP_FILE"; then

  # Get backup file size
  BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo "✅ Backup completed successfully"
  echo "   Size: $BACKUP_SIZE"

  # Delete backups older than retention period
  echo "🧹 Cleaning up old backups (keeping last $RETENTION_DAYS days)..."
  find "$BACKUP_DIR" -name "cartrel_backup_*.sql.gz" -type f -mtime +$RETENTION_DAYS -delete

  # Count remaining backups
  BACKUP_COUNT=$(find "$BACKUP_DIR" -name "cartrel_backup_*.sql.gz" -type f | wc -l)
  echo "   Current backups: $BACKUP_COUNT"

  echo "✅ Backup process complete!"
  exit 0
else
  echo "❌ Backup failed!"
  exit 1
fi
