# IziPilot MCP Server

Exposes IziPilot OKR data to Claude (Desktop / Claude Code) via the
**Model Context Protocol** over Streamable HTTP.

## Why a separate service

- The Next.js app stays focused on UI + Server Actions.
- The MCP server **never** exposes raw Postgres — every request goes through
  Prisma + an `requireAccess()` check that mirrors `lib/auth-guard.ts`.
- Multi-tenant `orgId` and role checks are enforced per-tool.

## Auth model

Each MCP request must carry `Authorization: Bearer <JWT>`. The JWT is
**signed (HS256)** with `MCP_JWT_SECRET` and must contain:

```json
{
  "sub":  "<userId>",
  "org":  "<orgId>",
  "role": "CEO" | "MANAGEMENT" | "PO" | "VIEWER",
  "iss":  "izipilot",
  "aud":  "izipilot-mcp",
  "exp":  <unix seconds>
}
```

A dedicated Next.js Server Action (TODO: `app/api/mcp/token/route.ts`) issues
these tokens to authenticated users — we do **not** reuse the NextAuth session
cookie because the MCP server has no access to the NextAuth JWE.

## Tools exposed (initial set)

| Tool                  | Roles                    | Effect          |
| --------------------- | ------------------------ | --------------- |
| `get_dashboard`       | all                      | read            |
| `list_blocked_krs`    | all                      | read            |
| `get_okr_history`     | all                      | read            |
| `submit_weekly_entry` | PO (owner) / MANAGEMENT / CEO | write       |
| `submit_daily_report` | all except VIEWER (own report, today WAT) | write |
| `list_sprint_tasks`   | all                      | read (via app)  |
| `create_sprint_task`  | CEO / MANAGEMENT / PO; CONTRIBUTOR only for a department they lead | write (via app) |
| `update_task_status`  | CEO / MANAGEMENT / PO; CONTRIBUTOR only on own tasks | write (via app) |

All reads are scoped by `orgId` from the JWT. "Via app" tools call the app's own API route with the caller's token (`MCP_APP_URL`), so permissions and board rules are not duplicated here; the app only accepts a Bearer on the routes listed in `MCP_BEARER_ROUTES` (middleware.ts). Writes additionally verify
ownership for PO accounts.

## Run locally

```bash
cp .env.example .env
npm install
npm run dev
```

## Build & run with Docker

From the **project root** (build context):

```bash
docker compose up -d --build mcp-server
```

## Connect Claude Desktop

```jsonc
// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "izipilot": {
      "url": "https://mcp.izipilot.com/mcp",
      "headers": {
        "Authorization": "Bearer <JWT issued by Next.js>"
      }
    }
  }
}
```
