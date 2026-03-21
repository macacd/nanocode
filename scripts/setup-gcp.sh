#!/bin/bash

# Configuration
PROJECT_ID="nanocode-workspace-$(date +%s)"
PROJECT_NAME="NanoCode Workspace"
USER_EMAIL="macad.macacus@gmail.com"

echo "========================================================="
echo "🚀 Setting up Google Cloud Project for NanoCode"
echo "========================================================="

echo "\n📦 1. Creating Project: $PROJECT_ID..."
gcloud projects create $PROJECT_ID --name="$PROJECT_NAME"

echo "\n🔗 2. Setting active project..."
gcloud config set project $PROJECT_ID

echo "\n💳 3. Linking billing account (Required for some APIs)..."
BILLING_ACCOUNT=$(gcloud beta billing accounts list --format="value(name)" | head -n 1)
if [ -n "$BILLING_ACCOUNT" ]; then
    gcloud beta billing projects link $PROJECT_ID --billing-account $BILLING_ACCOUNT
    echo "✅ Linked to billing account: $BILLING_ACCOUNT"
else
    echo "⚠️ No billing account found. Some APIs might not work."
fi

echo "\n🔌 4. Enabling required APIs (Gmail, Drive, Sheets, Calendar, Contacts)..."
# We need to wait a few seconds for project creation to propagate
sleep 5
gcloud services enable \
    gmail.googleapis.com \
    drive.googleapis.com \
    sheets.googleapis.com \
    calendar-json.googleapis.com \
    people.googleapis.com

echo "\n🛡️ 5. Setting up OAuth Consent Screen..."
# Note: Full OAuth Consent Screen automation via gcloud CLI is limited.
# We use a workaround or tell the user what to do manually.
# Setting up brand identity for OAuth screen
echo "⚠️ We will attempt to create the brand, but if it fails, you may need to do this manually in the Cloud Console."
gcloud alpha iap oauth-brands create \
    --application_title="$PROJECT_NAME" \
    --support_email="$USER_EMAIL" || echo "Note: Brand creation via CLI is restricted for non-organization accounts."

echo "\n🔑 6. Creating OAuth 2.0 Client ID (Desktop App)..."
# For Desktop apps, we can't fully create the client ID purely via gcloud CLI without an organization.
# We will generate a quick link for the user to click.

echo "\n========================================================="
echo "✅ Project $PROJECT_ID is ready!"
echo "========================================================="
echo "⚠️ IMPORTANT MANUAL STEPS REQUIRED:"
echo "Since you are using a personal @gmail.com account, Google prevents CLI creation of OAuth Clients."
echo "Please follow these 3 steps in your browser:"
echo ""
echo "1. Go to: https://console.cloud.google.com/apis/credentials/consent?project=$PROJECT_ID"
echo "   - Select 'External' and click 'Create'"
echo "   - Fill in App name ('NanoCode') and User support email ($USER_EMAIL)"
echo "   - Scroll down to Developer contact info and put $USER_EMAIL"
echo "   - Click 'Save and Continue' through Scopes and Test Users (add $USER_EMAIL as Test User)"
echo "   - VERY IMPORTANT: Click 'PUBLISH APP' on the summary screen so the token doesn't expire in 7 days."
echo ""
echo "2. Go to: https://console.cloud.google.com/apis/credentials?project=$PROJECT_ID"
echo "   - Click '+ CREATE CREDENTIALS' -> 'OAuth client ID'"
echo "   - Application type: 'Desktop app'"
echo "   - Name: 'NanoCode Agent'"
echo "   - Click 'Create'"
echo ""
echo "3. Download the JSON file:"
echo "   - A popup will appear with 'Client ID' and 'Client Secret'"
echo "   - Click the 'DOWNLOAD JSON' button"
echo "   - Save it as 'credentials.json' in your nanocode project folder."
echo "========================================================="
