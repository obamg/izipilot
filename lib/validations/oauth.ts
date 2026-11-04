import { z } from "zod";

// Registration is unauthenticated, so only Claude may register: claude.ai /
// claude.com over https, or loopback http (Claude Desktop / Claude Code).
// Blocks phishing via a look-alike client pointing at an attacker's site.
const CLAUDE_HOSTS = new Set(["claude.ai", "claude.com"]);
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
export const redirectUri = z.string().url().refine((u) => {
  const { protocol, hostname } = new URL(u);
  return (
    (protocol === "https:" && CLAUDE_HOSTS.has(hostname)) ||
    (protocol === "http:" && LOOPBACK.has(hostname))
  );
}, "redirect_uri must be a Claude callback (claude.ai, claude.com or localhost)");

// RFC 7591 §2 — Dynamic Client Registration request. We accept a subset
// because claude.ai sends predictable values; unknown fields are ignored
// rather than rejected so we stay forward-compatible.
export const dcrRequestSchema = z.object({
  client_name: z.string().min(1).max(120).optional(),
  redirect_uris: z.array(redirectUri).min(1).max(5),
  token_endpoint_auth_method: z
    .enum(["client_secret_post", "client_secret_basic", "none"])
    .optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  scope: z.string().optional(),
});

export type DcrRequest = z.infer<typeof dcrRequestSchema>;

// RFC 6749 §4.1.1 authorize-endpoint query.
export const authorizeQuerySchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  scope: z.string().optional(),
  state: z.string().optional(),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256"),
});

export type AuthorizeQuery = z.infer<typeof authorizeQuerySchema>;

// RFC 6749 §4.1.3 / §6 — token endpoint accepts form-urlencoded.
export const tokenRequestSchema = z.discriminatedUnion("grant_type", [
  z.object({
    grant_type: z.literal("authorization_code"),
    code: z.string().min(1),
    redirect_uri: z.string().url(),
    client_id: z.string().min(1),
    client_secret: z.string().min(1).optional(), // optional only for token_endpoint_auth_method="none" (public clients with PKCE)
    code_verifier: z.string().min(43).max(128),
  }),
  z.object({
    grant_type: z.literal("refresh_token"),
    refresh_token: z.string().min(1),
    client_id: z.string().min(1),
    client_secret: z.string().min(1).optional(),
    scope: z.string().optional(),
  }),
]);

export type TokenRequest = z.infer<typeof tokenRequestSchema>;
