"use client";

import { useEffect } from "react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side logging is wired through Next.js' built-in reporter;
    // surface the digest in the browser console for support.
    if (process.env.NODE_ENV !== "production") {
      console.error("Dashboard route error:", error);
    }
  }, [error]);

  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <div className="w-full max-w-md bg-white rounded-[10px] border border-border-soft p-6 text-center">
        <div
          className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-izi-red-lt"
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--red)"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-6 w-6"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
        </div>
        <h2 className="font-serif text-xl text-dark">
          Une erreur est survenue
        </h2>
        <p className="mt-2 text-sm text-izi-gray">
          Nous n&apos;avons pas pu charger cette page. Réessayez ou revenez au
          tableau de bord.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-[10px] text-izi-gray">
            Réf. {error.digest}
          </p>
        )}
        <div className="mt-5 flex flex-col sm:flex-row gap-2 justify-center">
          <button
            type="button"
            onClick={() => reset()}
            className="min-h-[44px] px-4 py-2 rounded-[7px] text-sm font-semibold bg-teal text-white hover:bg-teal-dk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-1 transition-colors"
          >
            Réessayer
          </button>
          <a
            href="/dashboard"
            className="min-h-[44px] px-4 py-2 rounded-[7px] text-sm font-medium border border-teal-md text-teal hover:bg-teal-lt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-1 transition-colors inline-flex items-center justify-center no-underline"
          >
            Retour au tableau de bord
          </a>
        </div>
      </div>
    </div>
  );
}
