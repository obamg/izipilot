"use client";

import { useEffect, useState } from "react";

interface Props {
  vapidPublicKey: string;
}

const DISMISS_KEY = "izipilot:push-nudge-dismissed";
// A user who clicks "Plus tard" is left alone for a week, then gently nudged
// again — but only while they remain unsubscribed and haven't denied at the
// OS level (both short-circuit before we ever read this timestamp).
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function urlBase64ToUint8Array(b64: string): Uint8Array {
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Slim, non-blocking banner inviting the user to enable browser notifications.
 * Push is now the primary channel for the daily-report reminder (no email), so
 * we want adoption — but gently. Shows only when:
 *   - VAPID is configured (key non-empty),
 *   - the browser supports Web Push,
 *   - permission is not "denied" (nothing we can do from JS in that case),
 *   - this device has no active subscription yet,
 *   - the last "Plus tard" dismissal is older than a week.
 * Unlike a modal it never blocks the page; it sits at the top of the content
 * until the user enables notifications or dismisses it.
 */
export function PushNudgeBanner({ vapidPublicKey }: Props) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!vapidPublicKey) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (Notification.permission === "denied") return;

    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (cancelled || existing) return; // already subscribed → nothing to nudge
      } catch {
        // If we can't read the subscription state, don't nag.
        return;
      }
      const dismissedAt = Number(window.localStorage.getItem(DISMISS_KEY) ?? 0);
      if (dismissedAt && Date.now() - dismissedAt < DISMISS_TTL_MS) return;
      if (!cancelled) setVisible(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [vapidPublicKey]);

  function dismiss() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    }
    setVisible(false);
  }

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        dismiss(); // denied/undecided → back off for a week
        return;
      }
      await navigator.serviceWorker.register("/sw.js");
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer,
        }));
      const json = sub.toJSON();
      const res = await fetch("/api/account/push-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Erreur d'abonnement");
      }
      setVisible(false); // subscribed — no need to remember a dismissal
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  if (!visible) return null;

  return (
    <div className="mb-4 rounded-[10px] border border-red/40 bg-red-lt px-4 py-3">
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-red"
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 01-3.46 0" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-dark">
            Activez les notifications sur cet appareil
          </p>
          <p className="mt-0.5 text-[12px] text-izi-gray">
            Recevez vos rappels de rapport quotidien et les alertes KR
            directement — même quand l&apos;onglet est fermé. Aucun email.
          </p>
          {error && <p className="mt-1.5 text-[11px] text-izi-red">{error}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={dismiss}
            disabled={busy}
            className="rounded-[7px] px-2.5 py-1.5 text-[12px] font-medium text-izi-gray hover:bg-white/70 disabled:opacity-50"
          >
            Plus tard
          </button>
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className="rounded-[7px] bg-red px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#c0392b] transition-colors disabled:opacity-50"
          >
            {busy ? "Activation…" : "Activer"}
          </button>
        </div>
      </div>
    </div>
  );
}
