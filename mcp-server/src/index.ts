import express, { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { verifyBearer } from "./auth.js";
import { runWithCaller } from "./context.js";
import { registerTools } from "./tools/index.js";

const PORT = Number(process.env.MCP_PORT || 3001);
const ALLOWED_ORIGINS = new Set(
  (process.env.MCP_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

// One MCP server instance per session. Sessions are keyed by the
// Mcp-Session-Id header the SDK manages for us.
const sessions = new Map<string, StreamableHTTPServerTransport>();

function buildServer(): McpServer {
  const server = new McpServer({
    name: "izipilot-mcp",
    version: "0.1.0",
  });
  registerTools(server);
  return server;
}

const app = express();
app.use(express.json({ limit: "1mb" }));

// Strip any client-supplied Origin we don't trust before the SDK sees it —
// blocks DNS-rebinding and stray browser callers.
app.use((req, res, next) => {
  const origin = req.header("origin");
  if (origin && ALLOWED_ORIGINS.size > 0 && !ALLOWED_ORIGINS.has(origin)) {
    res.status(403).json({ error: "Origin not allowed" });
    return;
  }
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

async function handleMcp(req: Request, res: Response) {
  let caller;
  try {
    caller = await verifyBearer(req.header("authorization"));
  } catch (err) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: (err as Error).message },
      id: null,
    });
    return;
  }

  const sessionId = req.header("mcp-session-id");
  let transport = sessionId ? sessions.get(sessionId) : undefined;

  if (!transport) {
    if (req.method !== "POST" || !isInitializeRequest(req.body)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "No valid session — send initialize first" },
        id: null,
      });
      return;
    }
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.set(sid, transport!);
      },
      enableDnsRebindingProtection: true,
      allowedOrigins: Array.from(ALLOWED_ORIGINS),
    });
    transport.onclose = () => {
      if (transport!.sessionId) sessions.delete(transport!.sessionId);
    };
    await buildServer().connect(transport);
  }

  // All tool handlers run inside the caller context — they can pull
  // userId/orgId/role from AsyncLocalStorage without us threading args.
  await runWithCaller(caller, () => transport!.handleRequest(req, res, req.body));
}

app.post("/mcp", handleMcp);
app.get("/mcp", handleMcp);
app.delete("/mcp", handleMcp);

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[izipilot-mcp] listening on :${PORT}`);
});

function shutdown(signal: string) {
  // eslint-disable-next-line no-console
  console.log(`[izipilot-mcp] ${signal} received, closing sessions`);
  for (const t of sessions.values()) t.close();
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
