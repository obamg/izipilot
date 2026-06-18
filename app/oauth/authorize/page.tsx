import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { authorizeQuerySchema } from "@/lib/validations/oauth";
import { approveAuthorization } from "./actions";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function asString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

// OAuth 2.1 authorization endpoint. Renders the consent UI inside the
// existing logged-in session — if no session, we redirect to /login and
// come back here with the same query string preserved as callbackUrl.
export default async function AuthorizePage({ searchParams }: PageProps) {
  const raw = await searchParams;

  // Normalize the query into a plain string map for Zod and the form.
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const s = asString(v);
    if (s !== undefined) params[k] = s;
  }

  const parsed = authorizeQuerySchema.safeParse(params);
  if (!parsed.success) {
    return (
      <ErrorBox
        title="Requête invalide"
        body={parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(" · ")}
      />
    );
  }
  const q = parsed.data;

  const session = await auth();
  if (!session?.user) {
    // Preserve the OAuth query so we land back here after login.
    const search = new URLSearchParams(params).toString();
    redirect(`/login?callbackUrl=${encodeURIComponent(`/oauth/authorize?${search}`)}`);
  }

  const client = await prisma.oAuthClient.findUnique({
    where: { clientId: q.client_id },
  });
  if (!client) {
    return <ErrorBox title="Client inconnu" body="client_id non reconnu." />;
  }
  if (!client.redirectUris.includes(q.redirect_uri)) {
    // Per RFC 6749 §4.1.2.1, we MUST NOT redirect to an unregistered URI.
    return (
      <ErrorBox
        title="Redirection non autorisée"
        body="Cette redirect_uri n'est pas enregistrée pour ce client."
      />
    );
  }

  const scopes = (q.scope || "mcp").split(/\s+/).filter(Boolean);

  return (
    <div className="min-h-screen flex items-center justify-center bg-izi-gray-lt px-4 py-8">
      <div className="bg-white rounded-[12px] border border-border-soft shadow-sm w-full max-w-[440px] p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-teal/10 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" className="w-5 h-5">
              <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
            </svg>
          </div>
          <div>
            <div className="font-serif text-[18px] text-dark leading-tight">
              Autoriser l&apos;accès
            </div>
            <div className="text-[12px] text-izi-gray">{client.clientName}</div>
          </div>
        </div>

        <p className="text-[13px] text-dark-md mb-3">
          <span className="font-medium">{client.clientName}</span> souhaite accéder à
          vos données IziPilot via le serveur MCP au nom de{" "}
          <span className="font-medium">{session!.user.email}</span>.
        </p>

        <div className="bg-izi-gray-lt rounded-[8px] p-3 mb-4 border border-border-soft">
          <div className="text-[11px] uppercase tracking-wide text-izi-gray mb-1.5">
            Autorisations demandées
          </div>
          <ul className="text-[12px] text-dark-md space-y-1">
            {scopes.map((s) => (
              <li key={s} className="flex items-start gap-2">
                <span className="text-teal mt-0.5">•</span>
                <span>
                  <code className="font-mono text-[11px] bg-white px-1 rounded">{s}</code>
                  {s === "mcp" && (
                    <span className="text-izi-gray ml-1">
                      — lire vos OKRs et soumettre vos revues hebdo
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="text-[11px] text-izi-gray mb-4 break-all">
          Redirection après autorisation : <code>{q.redirect_uri}</code>
        </div>

        <form action={approveAuthorization} className="flex gap-2">
          <input type="hidden" name="client_id" value={q.client_id} />
          <input type="hidden" name="redirect_uri" value={q.redirect_uri} />
          <input type="hidden" name="code_challenge" value={q.code_challenge} />
          <input
            type="hidden"
            name="code_challenge_method"
            value={q.code_challenge_method}
          />
          <input type="hidden" name="scope" value={q.scope || "mcp"} />
          {q.state && <input type="hidden" name="state" value={q.state} />}

          <button
            type="submit"
            name="decision"
            value="deny"
            className="flex-1 h-10 rounded-[8px] border border-border-soft bg-white text-dark-md text-[13px] font-medium hover:bg-izi-gray-lt transition-colors"
          >
            Refuser
          </button>
          <button
            type="submit"
            name="decision"
            value="approve"
            className="flex-1 h-10 rounded-[8px] bg-teal text-white text-[13px] font-medium hover:bg-teal-dk transition-colors"
          >
            Autoriser
          </button>
        </form>
      </div>
    </div>
  );
}

function ErrorBox({ title, body }: { title: string; body: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-izi-gray-lt px-4">
      <div className="bg-white rounded-[12px] border border-izi-red/20 shadow-sm w-full max-w-[420px] p-6">
        <div className="font-serif text-[16px] text-izi-red mb-2">{title}</div>
        <div className="text-[13px] text-dark-md">{body}</div>
      </div>
    </div>
  );
}
