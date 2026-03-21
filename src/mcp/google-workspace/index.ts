import { google } from "googleapis";
import * as readline from "readline";
import { OAuth2Client } from "google-auth-library";

const clientId = process.env.GOOGLE_CLIENT_ID!;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
const refreshToken = process.env.GOOGLE_REFRESH_TOKEN!;

if (!clientId || !clientSecret || !refreshToken) {
  process.stderr.write("Missing Google credentials\n");
  process.exit(1);
}

const oauth2Client = new OAuth2Client(clientId, clientSecret, "http://localhost");
oauth2Client.setCredentials({ refresh_token: refreshToken });

const gmail = google.gmail({ version: "v1", auth: oauth2Client });
const drive = google.drive({ version: "v3", auth: oauth2Client });
const calendar = google.calendar({ version: "v3", auth: oauth2Client });
const sheets = google.sheets({ version: "v4", auth: oauth2Client });
const docs = google.docs({ version: "v1", auth: oauth2Client });
const people = google.people({ version: "v1", auth: oauth2Client });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

function sendResponse(id: number | string | null, result: any) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function sendError(id: number | string | null, code: number, message: string) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

async function handleRequest(method: string, params: any, id: number | string | null) {
  try {
    if (method === "initialize") {
      sendResponse(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "google-workspace", version: "1.0.0" } });
      return;
    }

    if (method === "tools/list") {
      sendResponse(id, {
        tools: [
          { name: "gmail_search", description: "Search Gmail emails", inputSchema: { type: "object", properties: { query: { type: "string" }, maxResults: { type: "number" } }, required: ["query"] } },
          { name: "gmail_read", description: "Read a Gmail email by ID", inputSchema: { type: "object", properties: { messageId: { type: "string" } }, required: ["messageId"] } },
          { name: "gmail_send", description: "Send an email", inputSchema: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } }, required: ["to", "subject", "body"] } },
          { name: "drive_search", description: "Search Google Drive files", inputSchema: { type: "object", properties: { query: { type: "string" }, maxResults: { type: "number" } }, required: ["query"] } },
          { name: "drive_read_doc", description: "Read a Google Doc", inputSchema: { type: "object", properties: { documentId: { type: "string" } }, required: ["documentId"] } },
          { name: "sheets_read", description: "Read a Google Sheet range", inputSchema: { type: "object", properties: { spreadsheetId: { type: "string" }, range: { type: "string" } }, required: ["spreadsheetId", "range"] } },
          { name: "calendar_events", description: "List upcoming calendar events", inputSchema: { type: "object", properties: { maxResults: { type: "number" }, timeMin: { type: "string" } } } },
          { name: "contacts_search", description: "Search Google Contacts", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
        ],
      });
      return;
    }

    if (method === "tools/call") {
      const { name, arguments: args } = params;
      let result = "";

      switch (name) {
        case "gmail_search": {
          const { query, maxResults = 5 } = args;
          const res = await gmail.users.messages.list({ userId: "me", q: query, maxResults });
          if (!res.data.messages?.length) { result = "No emails found."; break; }
          const items = [];
          for (const msg of res.data.messages) {
            try {
              const d = await gmail.users.messages.get({ userId: "me", id: msg.id!, format: "metadata", metadataHeaders: ["Subject", "From", "Date"] });
              const hdrs = d.data.payload?.headers || [];
              items.push({ id: msg.id, subject: hdrs.find((h: any) => h.name === "Subject")?.value || "(No Subject)", from: hdrs.find((h: any) => h.name === "From")?.value || "", date: hdrs.find((h: any) => h.name === "Date")?.value || "", snippet: d.data.snippet || "" });
            } catch {}
          }
          result = JSON.stringify(items, null, 2);
          break;
        }

        case "gmail_read": {
          const { messageId } = args;
          const res = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
          let body = "";
          const parts = res.data.payload?.parts || [];
          const txt = parts.find((p: any) => p.mimeType === "text/plain");
          if (txt?.body?.data) body = Buffer.from(txt.body.data, "base64url").toString();
          else if (res.data.payload?.body?.data) body = Buffer.from(res.data.payload.body.data, "base64url").toString();
          else body = "Could not parse email body. Snippet: " + res.data.snippet;
          result = body;
          break;
        }

        case "gmail_send": {
          const { to, subject, body: emailBody } = args;
          const sub = Buffer.from(subject).toString("base64");
          const msg = Buffer.from(`To: ${to}\nSubject: =?utf-8?B?${sub}?=\nMIME-Version: 1.0\nContent-Type: text/plain; charset="UTF-8"\n\n${emailBody}`).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
          const r = await gmail.users.messages.send({ userId: "me", requestBody: { raw: msg } });
          result = "Email sent. ID: " + r.data.id;
          break;
        }

        case "drive_search": {
          const { query, maxResults = 5 } = args;
          const res = await drive.files.list({ q: query, pageSize: maxResults, fields: "files(id,name,mimeType,webViewLink)" });
          result = JSON.stringify(res.data.files || [], null, 2);
          break;
        }

        case "drive_read_doc": {
          const { documentId } = args;
          const doc = await docs.documents.get({ documentId });
          let text = "";
          if (doc.data.body?.content) {
            for (const el of doc.data.body.content) {
              if (el.paragraph?.elements) {
                for (const e of el.paragraph.elements) {
                  if (e.textRun?.content) text += e.textRun.content;
                }
              }
            }
          }
          result = text || "(Empty document)";
          break;
        }

        case "sheets_read": {
          const { spreadsheetId, range } = args;
          const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
          result = JSON.stringify(res.data.values || [], null, 2);
          break;
        }

        case "calendar_events": {
          const { maxResults = 10, timeMin } = args;
          const minTime = timeMin || new Date().toISOString();
          const res = await calendar.events.list({ calendarId: "primary", timeMin: minTime, maxResults, singleEvents: true, orderBy: "startTime" });
          const events = (res.data.items || []).map((e: any) => ({ summary: e.summary || "(No title)", start: e.start?.dateTime || e.start?.date, end: e.end?.dateTime || e.end?.date, link: e.htmlLink }));
          result = JSON.stringify(events, null, 2);
          break;
        }

        case "contacts_search": {
          const { query } = args;
          const res = await people.people.searchContacts({ query, readMask: "names,emailAddresses,phoneNumbers" });
          result = JSON.stringify(res.data.results || [], null, 2);
          break;
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      sendResponse(id, { content: [{ type: "text", text: result }] });
      return;
    }

    if (method === "notifications/initialized") return;

    sendError(id, -32601, `Method not found: ${method}`);
  } catch (error: any) {
    sendError(id, -32603, error.message);
  }
}

rl.on("line", (line) => {
  if (!line.trim()) return;
  try {
    const msg = JSON.parse(line);
    handleRequest(msg.method, msg.params, msg.id);
  } catch {
    sendError(null, -32700, "Parse error");
  }
});

process.stderr.write("google-workspace-mcp running\n");