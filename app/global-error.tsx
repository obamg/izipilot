"use client";

// global-error.tsx is Next.js' last-resort boundary — it renders inside
// its own <html>/<body> when the root layout itself fails. Keep this
// minimal and dependency-free (no design tokens guaranteed to load).

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f2f6f7",
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: "1rem",
        }}
      >
        <div
          style={{
            maxWidth: 420,
            width: "100%",
            background: "#fff",
            borderRadius: 12,
            border: "1px solid #deeaea",
            padding: "1.5rem",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: 20, margin: "0 0 8px", color: "#1c3a4a" }}>
            IziPilot est temporairement indisponible
          </h1>
          <p style={{ fontSize: 14, color: "#5f6e7a", margin: "0 0 16px" }}>
            Une erreur inattendue est survenue. Veuillez réessayer.
          </p>
          {error.digest && (
            <p
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: 11,
                color: "#5f6e7a",
                margin: "0 0 16px",
              }}
            >
              Réf. {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              minHeight: 44,
              padding: "10px 16px",
              borderRadius: 7,
              background: "#008081",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
            }}
          >
            Réessayer
          </button>
        </div>
      </body>
    </html>
  );
}
