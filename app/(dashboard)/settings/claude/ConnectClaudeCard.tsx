"use client";

import { useState } from "react";

interface Props {
  mcpUrl: string;
}

interface TokenResponse {
  token: string;
  expiresIn: number;
  tokenType: "Bearer";
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; token: string; expiresAt: number }
  | { kind: "error"; message: string };

export function ConnectClaudeCard({ mcpUrl }: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [copied, setCopied] = useState<"token" | "config" | null>(null);

  async function generate() {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/mcp/token", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as TokenResponse;
      setState({
        kind: "ready",
        token: data.token,
        expiresAt: Date.now() + data.expiresIn * 1000,
      });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Erreur inconnue",
      });
    }
  }

  async function copy(text: string, label: "token" | "config") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard blocked — user can select manually.
    }
  }

  const config =
    state.kind === "ready"
      ? JSON.stringify(
          {
            mcpServers: {
              izipilot: {
                url: mcpUrl,
                headers: { Authorization: `Bearer ${state.token}` },
              },
            },
          },
          null,
          2,
        )
      : "";

  return (
    <div className="bg-white rounded-xl border border-border-soft p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-dark-md">Jeton MCP</h2>
          <p className="text-[11px] text-izi-gray mt-0.5">
            Sign&eacute; avec votre identit&eacute; ({mcpUrl})
          </p>
        </div>
        <button
          onClick={generate}
          disabled={state.kind === "loading"}
          className="px-3.5 py-2 rounded-lg bg-teal text-white text-sm font-medium hover:bg-teal-dk transition-colors disabled:opacity-60"
        >
          {state.kind === "loading"
            ? "Génération..."
            : state.kind === "ready"
              ? "Regénérer"
              : "Générer un jeton"}
        </button>
      </div>

      {state.kind === "error" && (
        <div className="text-xs text-izi-red bg-izi-red-lt rounded-lg p-3">
          {state.message}
        </div>
      )}

      {state.kind === "ready" && (
        <div className="space-y-4">
          <ExpiryLine expiresAt={state.expiresAt} />

          <Field
            label="Jeton (Bearer)"
            value={state.token}
            onCopy={() => copy(state.token, "token")}
            copied={copied === "token"}
            mono
          />

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-dark-md">
                Configuration Claude Desktop
              </label>
              <button
                onClick={() => copy(config, "config")}
                className="text-[11px] text-teal hover:text-teal-dk font-medium"
              >
                {copied === "config" ? "Copié" : "Copier"}
              </button>
            </div>
            <pre className="text-[11px] font-mono bg-gray-lt rounded-lg p-3 overflow-x-auto whitespace-pre">
              {config}
            </pre>
            <p className="text-[11px] text-izi-gray mt-1.5">
              Collez ce bloc dans{" "}
              <code className="font-mono text-[10px] bg-gray-lt px-1 py-0.5 rounded">
                ~/Library/Application Support/Claude/claude_desktop_config.json
              </code>
              , puis red&eacute;marrez Claude Desktop.
            </p>
          </div>
        </div>
      )}

      {state.kind === "idle" && (
        <p className="text-xs text-izi-gray">
          Aucun jeton actif. Cliquez sur &laquo;&nbsp;G&eacute;n&eacute;rer un
          jeton&nbsp;&raquo; pour en cr&eacute;er un.
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onCopy,
  copied,
  mono,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  copied: boolean;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-medium text-dark-md">{label}</label>
        <button
          onClick={onCopy}
          className="text-[11px] text-teal hover:text-teal-dk font-medium"
        >
          {copied ? "Copié" : "Copier"}
        </button>
      </div>
      <div
        className={`text-[11px] ${mono ? "font-mono" : ""} bg-gray-lt rounded-lg p-3 break-all`}
      >
        {value}
      </div>
    </div>
  );
}

function ExpiryLine({ expiresAt }: { expiresAt: number }) {
  const minutes = Math.max(0, Math.round((expiresAt - Date.now()) / 60000));
  return (
    <div className="text-[11px] text-izi-gray">
      Expire dans <span className="text-dark-md font-medium">{minutes} min</span>
    </div>
  );
}
