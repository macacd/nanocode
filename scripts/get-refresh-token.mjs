import { OAuth2Client } from 'google-auth-library';
import fs from 'fs';
import http from 'http';
import url from 'url';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/contacts.readonly'
];

async function main() {
  try {
    const credsStr = fs.readFileSync('credentials.json', 'utf8');
    const creds = JSON.parse(credsStr);
    
    const keys = creds.installed || creds.web;
    if (!keys || !keys.client_id) {
      throw new Error('Invalid credentials.json structure: missing client_id');
    }

    console.log('Using Client ID:', keys.client_id);
    
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

    console.log('========================================================');
    console.log('🔗 AUTORIZACIÓN OAUTH 2.0 NECESARIA');
    console.log('========================================================');
    console.log('1. Abre la siguiente URL en tu navegador:');
    console.log('\n\x1b[36m' + authorizeUrl + '\x1b[0m\n');
    console.log('2. Inicia sesión, acepta advertencias, marca todas las casillas y da a Continuar.');
    console.log('3. Te redirigirá a 127.0.0.1 y el token aparecerá aquí abajo.\n');
    
    console.log('⏳ Esperando autorización en http://127.0.0.1:3000...');

    const server = http.createServer(async (req, res) => {
      try {
        if (req.url && req.url.startsWith('/?code=')) {
          const qs = new url.URL(req.url, 'http://127.0.0.1:3000').searchParams;
          const code = qs.get('code');
          res.end('<h1>Autorizacion exitosa!</h1><p>Ya puedes cerrar esta ventana y volver a la terminal.</p>');
          server.close();
          
          console.log('\n⏳ Obteniendo tokens...');
          const { tokens } = await oAuth2Client.getToken(code);
          
          if (tokens.refresh_token) {
            console.log('\n✅ ¡ÉXITO! Refresh Token obtenido.\n');
            console.log('Por favor, pega el token en el chat:');
            console.log('\x1b[32m' + tokens.refresh_token + '\x1b[0m\n');
            
            const envStr = '\nGOOGLE_REFRESH_TOKEN="' + tokens.refresh_token + '"\n';
            fs.appendFileSync('.env', envStr);
          } else {
            console.log('\n❌ No se devolvio Refresh Token. Elimina los permisos en Google y vuelve a intentar.');
          }
        }
      } catch (err) {
        console.error('Error canjeando el código:', err.message);
        res.end('Error: ' + err.message);
      }
    }).listen(3000);

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

main();