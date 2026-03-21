import { OAuth2Client } from 'google-auth-library';
import fs from 'fs';

async function main() {
  const credsStr = fs.readFileSync('credentials.json', 'utf8');
  const creds = JSON.parse(credsStr);
  const keys = creds.installed || creds.web;

  const oAuth2Client = new OAuth2Client(
    keys.client_id,
    keys.client_secret,
    'http://127.0.0.1:3000'
  );

  const code = '4/0AfrIepClaaSJEtJLUuLBvT9yD1Z8cAw3B4_ikHhUcqG-lj9zgLLTDsTFUfbWNi1DEAGeOw';
  
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    console.log('✅ Refresh Token Obtenido!');
    console.log('Token:', tokens.refresh_token);
    
    // Escribir a un archivo para usarlo luego en bash
    fs.writeFileSync('.google_tokens', `GOOGLE_CLIENT_ID=${keys.client_id}\nGOOGLE_CLIENT_SECRET=${keys.client_secret}\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    console.log('Guardados en .google_tokens');
  } catch (e) {
    console.error('Error:', e.message);
  }
}

main();