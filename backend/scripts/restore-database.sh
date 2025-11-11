#!/bin/bash
set -e

# Database restore script for Cartrel
# Restores PostgreSQL database from backup file

if [ -z "$1" ]; then
  echo "Usage: $0 <backup-file.sql.gz>"
  echo ""
  echo "Available backups:"
  ls -lh /opt/cartrel/backups/cartrel_backup_*.sql.gz 2>/dev/null || echo "  No backups found"
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "❌ Backup file not found: $BACKUP_FILE"
  exit 1
fi

# Database connection info (from environment or defaults)
DB_HOST="${DB_HOST:-gridtome-db}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-cartrel}"
DB_USER="${DB_USER:-gridtome}"

echo "⚠️  WARNING: This will REPLACE the current database!"
echo "   Database: $DB_NAME"
echo "   Host: $DB_HOST:$DB_PORT"
echo "   Backup file: $BACKUP_FILE"
echo ""
read -p "Are you sure you want to continue? (type 'yes' to confirm): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo "❌ Restore cancelled"
  exit 1
fi

echo "🔄 Starting database restore..."

# Restore from backup
if gunzip < "$BACKUP_FILE" | PGPASSWORD="$DB_PASSWORD" psql \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  -v ON_ERROR_STOP=1; then

  echo "✅ Database restored successfully!"
  exit 0
else
  echo "❌ Restore failed!"
  exit 1
fi
