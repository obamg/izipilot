"use client";

import { useEffect, useState } from "react";

interface Props {
  vapidPublicKey: string;
}

type Status = "unsupported" | "denied" | "default" | "subscribed" | "loading";

function urlBase64ToUint8Array(b64: string): Uint8Array {
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export function PushToggle({ vapidPublicKey }: Props) {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (typeof window === "undefined") return;
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        if (!cancelled) setStatus("unsupported");
        return;
      }
      try {
        await navigator.serviceWorker.register("/sw.js");
        const existing = await currentSubscription();
        const perm = Notification.permission;
        if (cancelled) return;
        if (existing) setStatus("subscribed");
        else if (perm === "denied") setStatus("denied");
        else setStatus("default");
      } catch (e) {
        if (!cancelled) {
          setStatus("default");
          setError(e instanceof Error ? e.message : "Erreur d'initialisation");
        }
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    setError(null);
    setStatus("loading");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setStatus(perm === "denied" ? "denied" : "default");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer,
      });

      // sub.toJSON() gives the canonical {endpoint, keys:{p256dh, auth}} shape
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
      setStatus("subscribed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
      setStatus("default");
    }
  }

  async function disable() {
    setError(null);
    setStatus("loading");
    try {
      const sub = await currentSubscription();
      if (sub) {
        await fetch("/api/account/push-subscription", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setStatus("default");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
      setStatus("subscribed");
    }
  }

  return (
    <div className="bg-white rounded-[10px] border border-[#deeaea] p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-dark">
            Notifications navigateur
          </div>
          <p className="text-[11px] text-izi-gray mt-0.5">
            Recevez une notification système sur cet appareil pour les
            événements OKR cochés ci-dessus, même quand l&apos;onglet est
            fermé. Les notifications respectent vos préférences par
            événement et votre rôle.
          </p>
          {status === "unsupported" && (
            <p className="text-[11px] text-izi-gray mt-2">
              Votre navigateur ne supporte pas les notifications push.
            </p>
          )}
          {status === "denied" && (
            <p className="text-[11px] text-izi-red mt-2">
              Permission refusée. Réactivez-la dans les réglages du
              navigateur (icône de cadenas à gauche de l&apos;URL) pour
              recevoir les notifications.
            </p>
          )}
          {error && (
            <p className="text-[11px] text-izi-red mt-2">{error}</p>
          )}
        </div>
        <div className="shrink-0">
          {status === "subscribed" ? (
            <button
              type="button"
              onClick={disable}
              className="text-[12px] font-medium px-3 py-1.5 rounded-[7px] border border-[#deeaea] text-dark hover:bg-izi-gray-lt"
            >
              Désactiver
            </button>
          ) : (
            <button
              type="button"
              onClick={enable}
              disabled={status === "unsupported" || status === "denied" || status === "loading"}
              className="bg-teal hover:bg-teal-dk text-white text-[12px] font-medium px-3 py-1.5 rounded-[7px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status === "loading" ? "…" : "Activer"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
