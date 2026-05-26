"use client";

import { useEffect, useState } from "react";

interface Props {
  vapidPublicKey: string;
}

const DISMISS_KEY = "izipilot:push-prompt-dismissed";
// Re-prompt cadence: a user who clicked "Plus tard" gets nudged once a week.
// The browser permission state still gates this — "denied" or "granted"
// short-circuits before we ever read the timestamp, so the reminder only
// reaches users who have not yet made a decision at the OS level.
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
 * Welcome-style modal that invites the user to enable browser notifications
 * once. Shows only when:
 *   - the browser supports Web Push,
 *   - permission has never been answered (`Notification.permission === "default"`),
 *   - this device's last dismissal is older than DISMISS_TTL_MS (1 week),
 *   - VAPID is configured server-side (key non-empty).
 * Dismissals are stored per device as a timestamp and the modal re-appears
 * after a week, giving us a gentle weekly reminder for users who keep
 * clicking "Plus tard". A user who later changes their mind can also
 * re-activate directly from /settings/notifications.
 */
export function PushPermissionModal({ vapidPublicKey }: Props) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!vapidPublicKey) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (Notification.permission !== "default") return;
    const dismissedAt = Number(window.localStorage.getItem(DISMISS_KEY) ?? 0);
    if (dismissedAt && Date.now() - dismissedAt < DISMISS_TTL_MS) return;

    // Slight delay so the modal does not collide with the dashboard's
    // first paint — it appears once the layout has settled.
    const t = window.setTimeout(() => setVisible(true), 1200);
    return () => window.clearTimeout(t);
  }, [vapidPublicKey]);

  function dismiss(remember = true) {
    if (remember && typeof window !== "undefined") {
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
        // User actively denied or dismissed → remember so we don't ask again.
        dismiss(true);
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
      dismiss(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="push-modal-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-dark/40 p-4 sm:items-center"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <div className="mb-3 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-lt text-teal text-xl">
            🔔
          </div>
          <div className="flex-1 min-w-0">
            <h2
              id="push-modal-title"
              className="font-serif text-lg text-dark"
            >
              Activer les notifications
            </h2>
            <p className="mt-1 text-[13px] text-izi-gray">
              Recevez une notification sur cet appareil pour les rappels
              hebdomadaires, les alertes KR et le digest CODIR — même quand
              l&apos;onglet est fermé. Vous gardez le contrôle par
              événement depuis vos préférences.
            </p>
          </div>
        </div>

        {error && (
          <p className="mb-3 rounded-md bg-izi-red-lt px-3 py-2 text-[12px] text-izi-red">
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => dismiss(true)}
            disabled={busy}
            className="rounded-lg border border-[#deeaea] px-4 py-2 text-sm font-medium text-dark hover:bg-izi-gray-lt disabled:opacity-50"
          >
            Plus tard
          </button>
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className="rounded-lg bg-teal px-4 py-2 text-sm font-medium text-white hover:bg-teal-dk disabled:opacity-50"
          >
            {busy ? "Activation…" : "Activer les notifications"}
          </button>
        </div>
      </div>
    </div>
  );
}
