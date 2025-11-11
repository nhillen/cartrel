#!/bin/bash
set -e

# Simple uptime monitoring script for Cartrel
# Checks if the application is healthy and alerts if down
# Can be run via cron every 5 minutes

URL="${HEALTH_URL:-https://cartrel.com/health}"
TIMEOUT=10
ALERT_WEBHOOK="${ALERT_WEBHOOK:-}"  # Optional: Discord/Slack webhook URL

# Function to send alert
send_alert() {
  local message="$1"
  local timestamp=$(date '+%Y-%m-%d %H:%M:%S')

  echo "[$timestamp] ⚠️  ALERT: $message"

  # Send to webhook if configured
  if [ -n "$ALERT_WEBHOOK" ]; then
    curl -X POST "$ALERT_WEBHOOK" \
      -H "Content-Type: application/json" \
      -d "{\"content\": \"🚨 **Cartrel Alert**\n$message\nTime: $timestamp\"}" \
      --silent --max-time 5 || true
  fi
}

# Check if site is up
echo "Checking health of $URL..."

if response=$(curl -s -w "\n%{http_code}" --max-time $TIMEOUT "$URL" 2>&1); then
  http_code=$(echo "$response" | tail -n 1)
  body=$(echo "$response" | head -n -1)

  if [ "$http_code" = "200" ]; then
    # Parse JSON response to check status
    if echo "$body" | grep -q '"status":"ok"'; then
      echo "✅ Service is healthy (HTTP $http_code)"
      exit 0
    else
      send_alert "Health check returned HTTP 200 but status is not 'ok'. Response: $body"
      exit 1
    fi
  else
    send_alert "Service returned HTTP $http_code (expected 200). Response: $body"
    exit 1
  fi
else
  send_alert "Service is unreachable or timed out after ${TIMEOUT}s. Error: $response"
  exit 1
fi
