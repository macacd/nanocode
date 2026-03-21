#!/bin/bash
# Gmail Read - Lee el contenido completo de un email
# Uso: bash gmail_read.sh <messageId>
# Ejemplo: bash gmail_read.sh 19d0dc308e823b79

MSG_ID="$1"

if [ -z "$MSG_ID" ]; then
    echo "Uso: gmail_read.sh <messageId>"
    exit 1
fi

TOKEN=$(bash /scripts/gmail_auth.sh)
if [ -z "$TOKEN" ]; then
    echo "ERROR: No se pudo obtener token de acceso"
    exit 1
fi

# Obtener email completo
RESPONSE=$(curl -s -G "https://gmail.googleapis.com/gmail/v1/users/me/messages/$MSG_ID" \
    -H "Authorization: Bearer $TOKEN" \
    --data "format=FULL")

ERROR=$(echo "$RESPONSE" | grep -o '"error"')

if [ -n "$ERROR" ]; then
    echo "ERROR: $RESPONSE"
    exit 1
fi

# Headers
FROM=$(echo "$RESPONSE" | grep -o '"name":"[^"]*","value":"[^"]*' | head -n 1 | sed 's/.*"value":"//;s/"$//')
FROM_VALUE=$(echo "$RESPONSE" | grep -o '"value":"[^"]*' | sed -n 1p | cut -d'"' -f4)
SUBJECT=$(echo "$RESPONSE" | grep -o '"value":"[^"]*' | sed -n 2p | cut -d'"' -f4)
DATE=$(echo "$RESPONSE" | grep -o '"value":"[^"]*' | sed -n 3p | cut -d'"' -f4)
TO=$(echo "$RESPONSE" | grep -o '"value":"[^"]*' | sed -n 4p | cut -d'"' -f4)

echo "========================================="
echo "DE: $FROM_VALUE"
echo "PARA: $TO"
echo "ASUNTO: $SUBJECT"
echo "FECHA: $DATE"
echo "========================================="
echo ""

# Extraer body plain text
# Buscar parts con mimeType text/plain
PAYLOAD=$(echo "$RESPONSE" | grep -o '"payload":{[^}]*}')

# Intentar extraer texto plano de various locations
BODY=$(echo "$RESPONSE" | grep -o '"body":{"data":"[^"]*' | head -n 1 | sed 's/.*"data":"//;s/"$//' | base64 -d 2>/dev/null)

if [ -z "$BODY" ]; then
    # Buscar en parts
    BODY=$(echo "$RESPONSE" | python3 -c "
import sys, json, base64
try:
    data = json.load(sys.stdin)
    parts = data.get('payload', {}).get('parts', [])
    for p in parts:
        if p.get('mimeType') == 'text/plain' and 'body' in p:
            text = base64.urlsafe_b64decode(p['body'].get('data','')).decode('utf-8', errors='replace')
            print(text)
            break
    else:
        for p in parts:
            if p.get('mimeType') == 'text/html' and 'body' in p:
                text = base64.urlsafe_b64decode(p['body'].get('data','')).decode('utf-8', errors='replace')
                print('--- Contenido HTML (no se puede mostrar completamente ---)')
                # Strip HTML tags
                import re
                clean = re.sub('<[^<]+>', '', text)
                print(clean[:2000])
                break
        else:
            print('(No se pudo extraer el cuerpo del email)')
except Exception as e:
    print(f'(Error parsing: {e})')
" 2>/dev/null)
fi

if [ -z "$BODY" ]; then
    BODY="(No se encontro cuerpo de texto plano en este email)"
fi

echo "$BODY"
