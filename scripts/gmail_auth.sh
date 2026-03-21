#!/bin/bash
# Google OAuth - Obtiene o refresca el access token
# Usa: bash gmail_auth.sh

CACHE_FILE="/tmp/google_access_token.json"

# Si el token en cache es reciente (menos de 55 min), usarlo directo
if [ -f "$CACHE_FILE" ]; then
    EXPIRES_AT=$(cat "$CACHE_FILE" | grep -o '"expires_at":[0-9]*' | cut -d: -f2)
    NOW=$(date +%s)
    if [ "$NOW" -lt "$EXPIRES_AT" ]; then
        TOKEN=$(cat "$CACHE_FILE" | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)
        echo "$TOKEN"
        exit 0
    fi
fi

# Refrescar token
RESPONSE=$(curl -s -X POST "https://oauth2.googleapis.com/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "client_id=${GOOGLE_CLIENT_ID}" \
    -d "client_secret=${GOOGLE_CLIENT_SECRET}" \
    -d "refresh_token=${GOOGLE_REFRESH_TOKEN}" \
    -d "grant_type=refresh_token")

ERROR=$(echo "$RESPONSE" | grep -o '"error"')

if [ -n "$ERROR" ]; then
    echo "ERROR: No se pudo refrescar el token" >&2
    echo "$RESPONSE" >&2
    exit 1
fi

ACCESS_TOKEN=$(echo "$RESPONSE" | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)
EXPIRES_IN=$(echo "$RESPONSE" | grep -o '"expires_in":[0-9]*' | cut -d: -f2)
NOW=$(date +%s)
EXPIRES_AT=$((NOW + EXPIRES_IN - 300))  # 5 min de márgen

echo "{\"access_token\":\"$ACCESS_TOKEN\",\"expires_at\":$EXPIRES_AT}" > "$CACHE_FILE"
echo "$ACCESS_TOKEN"
