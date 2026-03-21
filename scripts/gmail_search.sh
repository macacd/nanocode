#!/bin/bash
# Gmail Search - Lista emails que coinciden con una query
# Uso: bash gmail_search.sh "<query>" [maxResults]
# Ejemplo: bash gmail_search.sh "is:unread from:boss@gmail.com" 5

QUERY="$1"
MAX_RESULTS="${2:-5}"

if [ -z "$QUERY" ]; then
    echo "Uso: gmail_search.sh <query> [maxResults]"
    exit 1
fi

# Obtener token
TOKEN=$(bash /scripts/gmail_auth.sh)
if [ -z "$TOKEN" ]; then
    echo "ERROR: No se pudo obtener token de acceso"
    exit 1
fi

# URL-encode la query
ENCODED_QUERY=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$QUERY'))" 2>/dev/null) || \
ENCODED_QUERY=$(node -e "console.log(encodeURIComponent('$QUERY'))" 2>/dev/null) || \
ENCODED_QUERY="$QUERY"

# Hacer la peticion
RESPONSE=$(curl -s -G "https://gmail.googleapis.com/gmail/v1/users/me/messages" \
    -H "Authorization: Bearer $TOKEN" \
    --data-urlencode "q=$QUERY" \
    --data "maxResults=$MAX_RESULTS")

ERROR=$(echo "$RESPONSE" | grep -o '"error"')

if [ -n "$ERROR" ]; then
    echo "ERROR: $RESPONSE"
    exit 1
fi

COUNT=$(echo "$RESPONSE" | grep -o '"resultCount":[0-9]*' | cut -d: -f2)

if [ "$COUNT" = "0" ] || [ -z "$COUNT" ]; then
    echo "No se encontraron emails para la busqueda: $QUERY"
    exit 0
fi

echo "=== $COUNT emails encontrados para '$QUERY' ==="
echo ""

# Por cada mensaje, obtener metadata
MESSAGE_IDS=$(echo "$RESPONSE" | grep -o '"id":"[^"]*' | cut -d'"' -f4)

for MSG_ID in $MESSAGE_IDS; do
    METADATA=$(curl -s -G "https://gmail.googleapis.com/gmail/v1/users/me/messages/$MSG_ID" \
        -H "Authorization: Bearer $TOKEN" \
        --data "format=METADATA" \
        --data "metadataHeaders=Subject" \
        --data "metadataHeaders=From" \
        --data "metadataHeaders=Date")
    
    SUBJECT=$(echo "$METADATA" | grep -o '"value":"[^"]*' | head -n 1 | cut -d'"' -f4)
    FROM=$(echo "$METADATA" | grep -o '"value":"[^"]*' | sed -n 2p | cut -d'"' -f4)
    DATE=$(echo "$METADATA" | grep -o '"value":"[^"]*' | sed -n 3p | cut -d'"' -f4)
    SNIPPET=$(echo "$METADATA" | grep -o '"snippet":"[^"]*' | cut -d'"' -f4)
    
    echo "ID: $MSG_ID"
    echo "De: $FROM"
    echo "Asunto: $SUBJECT"
    echo "Fecha: $DATE"
    echo "Preview: $SNIPPET"
    echo "---"
done
