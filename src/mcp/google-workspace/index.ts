import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { google } from "googleapis";

// Ensure environment variables are loaded
const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

if (!clientId || !clientSecret || !refreshToken) {
  console.error("❌ MCP Google Workspace Error: Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REFRESH_TOKEN");
  process.exit(1);
}

// 1. Initialize OAuth2 Client
const oauth2Client = new google.auth.OAuth2(
  clientId,
  clientSecret,
  "http://localhost" // not used for refresh token grant, but required parameter
);

oauth2Client.setCredentials({
  refresh_token: refreshToken
});

// 2. Initialize Google APIs
const gmail = google.gmail({ version: "v1", auth: oauth2Client });
const drive = google.drive({ version: "v3", auth: oauth2Client });
const calendar = google.calendar({ version: "v3", auth: oauth2Client });
const sheets = google.sheets({ version: "v4", auth: oauth2Client });
const docs = google.docs({ version: "v1", auth: oauth2Client });
const people = google.people({ version: "v1", auth: oauth2Client });

// 3. Create MCP Server
const server = new Server(
  {
    name: "nanocode-google-workspace",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 4. Define Tools (Capabilities)
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "gmail_search",
        description: "Search for emails in Gmail using standard query syntax (e.g. 'is:unread', 'from:boss@company.com')",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Gmail search query" },
            maxResults: { type: "number", description: "Max results (default 5)" },
          },
          required: ["query"],
        },
      },
      {
        name: "gmail_read",
        description: "Read the full content of an email by ID",
        inputSchema: {
          type: "object",
          properties: {
            messageId: { type: "string", description: "Gmail message ID" },
          },
          required: ["messageId"],
        },
      },
      {
        name: "gmail_send",
        description: "Send an email. Subject and body must be text.",
        inputSchema: {
          type: "object",
          properties: {
            to: { type: "string", description: "Recipient email address" },
            subject: { type: "string", description: "Email subject" },
            body: { type: "string", description: "Email body (plain text or html)" },
          },
          required: ["to", "subject", "body"],
        },
      },
      {
        name: "drive_search",
        description: "Search for files in Google Drive",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Google Drive query string (e.g. 'name contains \"budget\"')" },
            maxResults: { type: "number", description: "Max results (default 5)" }
          },
          required: ["query"],
        },
      },
      {
        name: "drive_read_doc",
        description: "Read a Google Doc by its file ID. Returns plain text.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the Google Doc" },
          },
          required: ["documentId"],
        },
      },
      {
        name: "sheets_read",
        description: "Read data from a Google Sheet",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "The ID of the Google Sheet" },
            range: { type: "string", description: "The A1 notation of the range to retrieve (e.g. 'Sheet1!A1:D10')" },
          },
          required: ["spreadsheetId", "range"],
        },
      },
      {
        name: "calendar_events",
        description: "List upcoming events from the primary Google Calendar",
        inputSchema: {
          type: "object",
          properties: {
            maxResults: { type: "number", description: "Max number of events to fetch (default 10)" },
            timeMin: { type: "string", description: "Lower bound (inclusive) for an event's end time. Default is current time (e.g. '2024-03-22T00:00:00Z')" }
          },
        },
      },
      {
        name: "contacts_search",
        description: "Search Google Contacts",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Name or email to search for" },
          },
          required: ["query"],
        },
      }
    ],
  };
});

// 5. Handle Tools Execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    switch (request.params.name) {
      
      // --- GMAIL ---
      case "gmail_search": {
        const { query, maxResults = 5 } = request.params.arguments as any;
        const res = await gmail.users.messages.list({ userId: "me", q: query, maxResults });

        if (!res.data.messages || res.data.messages.length === 0) {
          return { content: [{ type: "text", text: "No emails found matching the query." }] };
        }

        const results = [];
        for (const msg of res.data.messages) {
          try {
            const detail = await gmail.users.messages.get({ userId: "me", id: msg.id! });
            const headers = detail.data.payload?.headers || [];
            results.push({
              id: msg.id,
              subject: headers.find(h => h.name === "Subject")?.value || "(No Subject)",
              from: headers.find(h => h.name === "From")?.value || "(Unknown)",
              date: headers.find(h => h.name === "Date")?.value || "(Unknown)",
              snippet: detail.data.snippet || "",
            });
          } catch(e) {}
        }
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      case "gmail_read": {
        const { messageId } = request.params.arguments as any;
        const res = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
        
        let body = "";
        const parts = res.data.payload?.parts || [];
        
        const textPart = parts.find(p => p.mimeType === "text/plain");
        if (textPart && textPart.body && textPart.body.data) {
          body = Buffer.from(textPart.body.data, "base64url").toString("utf-8");
        } else if (res.data.payload?.body?.data) {
          body = Buffer.from(res.data.payload.body.data, "base64url").toString("utf-8");
        } else {
          body = "Email body could not be parsed as plain text. Snippet: " + res.data.snippet;
        }

        return { content: [{ type: "text", text: body }] };
      }

      case "gmail_send": {
        const { to, subject, body } = request.params.arguments as any;
        const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
        const messageParts = [
          `To: ${to}`,
          `Subject: ${utf8Subject}`,
          'MIME-Version: 1.0',
          'Content-Type: text/plain; charset="UTF-8"',
          '',
          body,
        ];
        const message = messageParts.join('\n');
        const encodedMessage = Buffer.from(message)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        const res = await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw: encodedMessage },
        });

        return { content: [{ type: "text", text: `Email sent successfully. Message ID: ${res.data.id}` }] };
      }

      // --- DRIVE & DOCS ---
      case "drive_search": {
        const { query, maxResults = 5 } = request.params.arguments as any;
        const res = await drive.files.list({
          q: query,
          pageSize: maxResults,
          fields: "files(id, name, mimeType, webViewLink)",
        });
        return { content: [{ type: "text", text: JSON.stringify(res.data.files || [], null, 2) }] };
      }

      case "drive_read_doc": {
        const { documentId } = request.params.arguments as any;
        // Fetch text from google docs
        const doc = await docs.documents.get({ documentId });
        let text = "";
        if (doc.data.body && doc.data.body.content) {
          doc.data.body.content.forEach(element => {
            if (element.paragraph && element.paragraph.elements) {
              element.paragraph.elements.forEach(el => {
                if (el.textRun && el.textRun.content) {
                  text += el.textRun.content;
                }
              });
            }
          });
        }
        return { content: [{ type: "text", text: text }] };
      }

      // --- SHEETS ---
      case "sheets_read": {
        const { spreadsheetId, range } = request.params.arguments as any;
        const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
        return { content: [{ type: "text", text: JSON.stringify(res.data.values || [], null, 2) }] };
      }

      // --- CALENDAR ---
      case "calendar_events": {
        const { maxResults = 10, timeMin = (new Date()).toISOString() } = request.params.arguments as any;
        const res = await calendar.events.list({
          calendarId: 'primary',
          timeMin: timeMin,
          maxResults: maxResults,
          singleEvents: true,
          orderBy: 'startTime',
        });
        const events = res.data.items || [];
        const cleanEvents = events.map(e => ({
          summary: e.summary,
          start: e.start?.dateTime || e.start?.date,
          end: e.end?.dateTime || e.end?.date,
          link: e.htmlLink
        }));
        return { content: [{ type: "text", text: JSON.stringify(cleanEvents, null, 2) }] };
      }

      // --- CONTACTS ---
      case "contacts_search": {
        const { query } = request.params.arguments as any;
        const res = await people.people.searchContacts({
          query: query,
          readMask: 'names,emailAddresses,phoneNumbers',
        });
        const contacts = res.data.results || [];
        return { content: [{ type: "text", text: JSON.stringify(contacts, null, 2) }] };
      }

      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error executing tool: ${error.message}` }],
      isError: true,
    };
  }
});

// Start the server
async function startServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🟢 NanoCode Google Workspace MCP Server is running");
}

startServer().catch(console.error);