import { OAuth2Client } from 'google-auth-library';
import fs from 'fs';

const SCOPES = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/contacts'
];

const credsStr = fs.readFileSync('credentials.json', 'utf8');
const creds = JSON.parse(credsStr);
const keys = creds.installed || creds.web;

const oAuth2Client = new OAuth2Client(
  keys.client_id,
  keys.client_secret,
  'http://127.0.0.1:3000'
);

const authorizeUrl = oAuth2Client.generateAuthUrl({
  access_type: 'offline', 
  scope: SCOPES,
  prompt: 'consent' 
});

console.log(authorizeUrl);