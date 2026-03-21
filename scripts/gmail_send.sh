#!/bin/bash
# Gmail Send - Envía un email
# Uso: bash gmail_send.sh <to> <subject> <body>
# Ejemplo: bash gmail_send.sh "test@gmail.com" "Asunto" "Cuerpo del mensaje"

TO="$1"
SUBJECT="$2"
BODY="$3"

if [ -z "$TO" ] || [ -z "$SUBJECT" ]; then
    echo "Uso: gmail_send.sh <to> <subject> <body>"
    exit 1
fi

if [ -z "$BODY" ]; then
    BODY="(sin contenido)"
fi

TOKEN=$(bash /scripts/gmail_auth.sh)
if [ -z "$TOKEN" ]; then
    echo "ERROR: No se pudo obtener token de acceso"
    exit 1
fi

# Preparar email en formato RFC 2822
# 1. Headers
EMAIL="To: $TO\n"
EMAIL+="Subject: $SUBJECT\n"
EMAIL+="Content-Type: text/plain; charset=\"UTF-8\"\n"
EMAIL+="Content-Transfer-Encoding: 7bit\n"
EMAIL+="\n"
EMAIL+="$BODY"

# 2. Base64url encode
ENCODED=$(printf "%s" "$EMAIL" | base64 | tr '+/' '-_' | tr -d '=')

# 3. Enviar
RESPONSE=$(curl -s -X POST "https://gmail.googleapis.com/gmail/v1/users/me/messages/send" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"raw\":\"$ENCODED\"}")

ERROR=$(echo "$RESPONSE" | grep -o '"error"')

if [ -n "$ERROR" ]; then
    echo "ERROR: $RESPONSE"
    exit 1
fi

MESSAGE_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*' | cut -d'"' -f4)
echo "OK: Email enviado exitosamente. ID: $MESSAGE_ID"
