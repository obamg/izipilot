"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { ExemptReason } from "@/lib/push-gate";

interface Props {
  vapidPublicKey: string;
  userName: string;
}

/**
 * Ce que le navigateur permet réellement, une fois interrogé. Chaque cas
 * appelle une conduite différente : proposer, expliquer comment débloquer,
 * expliquer comment installer, ou laisser passer.
 */
type Situation =
  | "CHECKING"
  /** Permission jamais demandée → un clic suffit. */
  | "CAN_ASK"
  /** Refusée : plus aucun moyen de redemander depuis le code. */
  | "DENIED"
  /** iPhone/iPad hors écran d'accueil → le push n'existe pas encore. */
  | "IOS_NOT_INSTALLED"
  /** Navigateur sans Web Push du tout. */
  | "NO_SUPPORT"
  /**
   * API présente mais service push injoignable (`subscribe` → AbortError).
   * Cas typique : Brave, qui coupe la messagerie push Google par défaut.
   * Constaté à l'usage, jamais détectable d'avance.
   */
  | "PUSH_SERVICE_ERROR";

function urlBase64ToUint8Array(b64: string): Uint8Array {
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function isIOS(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ se présente comme un Mac ; l'écran tactile le trahit.
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function detect(): Situation {
  const hasApi = "serviceWorker" in navigator && "PushManager" in window;
  // Sur iOS le PushManager n'apparaît qu'une fois l'app installée : on teste
  // l'installation AVANT l'API, sinon on afficherait « navigateur incapable »
  // à quelqu'un dont le seul tort est de ne pas avoir installé l'application.
  if (isIOS() && !isStandalone()) return "IOS_NOT_INSTALLED";
  if (!hasApi) return "NO_SUPPORT";
  if (Notification.permission === "denied") return "DENIED";
  return "CAN_ASK";
}

/**
 * La situation est un état du NAVIGATEUR, pas de React : on la lit via
 * `useSyncExternalStore` plutôt que de la copier dans un state depuis un effet.
 * `detect()` rend une chaîne, donc la comparaison d'instantanés est stable et
 * ne boucle pas. Le serveur, lui, ne sait rien : il rend « CHECKING ».
 */
const listeners = new Set<() => void>();
function subscribeSituation(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
/** À appeler quand la permission a pu changer (après une demande refusée). */
function situationChanged() {
  for (const cb of listeners) cb();
}

export function PushGateScreen({ vapidPublicKey, userName }: Props) {
  const router = useRouter();
  const situation = useSyncExternalStore<Situation>(
    subscribeSituation,
    detect,
    () => "CHECKING"
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushServiceDown, setPushServiceDown] = useState(false);
  const shown: Situation = pushServiceDown ? "PUSH_SERVICE_ERROR" : situation;

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        // Un refus ici bascule définitivement en « denied » : on montre la
        // marche à suivre plutôt que de reproposer un bouton sans effet.
        situationChanged();
        return;
      }
      await navigator.serviceWorker.register("/sw.js");
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
            .buffer as ArrayBuffer,
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
      router.replace("/dashboard");
      router.refresh();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setPushServiceDown(true);
        return;
      }
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  /** Porte de sortie — réservée aux impossibilités techniques constatées. */
  async function exempt(reason: ExemptReason) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/push-exempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Erreur");
      }
      router.replace("/dashboard");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-lt flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-[12px] border border-border-soft bg-white p-6">
        <h1 className="font-serif text-xl text-dark mb-1">
          Activez les notifications, {userName}
        </h1>
        <p className="text-[13px] text-izi-gray mb-4">
          IziPilot vous prévient de vos rappels de rapport quotidien et des KR
          bloqués par notification — il n&apos;y a plus d&apos;email pour ça.
          L&apos;activation est requise pour accéder à l&apos;application.
        </p>

        {shown === "CHECKING" && (
          <p className="text-[13px] text-izi-gray py-4">Vérification…</p>
        )}

        {shown === "CAN_ASK" && (
          <>
            <p className="text-[12px] text-dark mb-3">
              Votre navigateur va demander l&apos;autorisation. Choisissez{" "}
              <strong>Autoriser</strong> — c&apos;est le seul moment où le choix
              vous sera proposé.
            </p>
            <button
              type="button"
              onClick={enable}
              disabled={busy}
              className="w-full rounded-[7px] bg-teal px-4 py-2.5 text-[13px] font-medium text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
            >
              {busy ? "Activation…" : "Activer les notifications"}
            </button>
          </>
        )}

        {shown === "DENIED" && (
          <Instructions
            title="Les notifications sont bloquées pour ce site"
            intro="Une application ne peut pas rouvrir la demande une fois refusée. Il faut la réautoriser dans votre navigateur, puis recharger cette page."
            steps={[
              "Chrome / Edge : cliquez sur l'icône à gauche de l'adresse (cadenas ou curseurs) → Notifications → Autoriser.",
              "Firefox : cadenas à gauche de l'adresse → Effacer l'autorisation, puis rechargez.",
              "Safari (Mac) : menu Safari → Réglages → Sites web → Notifications → passez izipilote.com sur Autoriser.",
            ]}
            action={
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-[7px] bg-teal px-4 py-2 text-[13px] font-medium text-white hover:bg-teal-dk"
              >
                J&apos;ai réautorisé — recharger
              </button>
            }
          />
        )}

        {shown === "IOS_NOT_INSTALLED" && (
          <Instructions
            title="Ajoutez IziPilot à votre écran d'accueil"
            intro="Sur iPhone et iPad, les notifications n'existent que si l'application est installée. C'est une règle d'Apple, pas un réglage d'IziPilot."
            steps={[
              "Dans Safari, touchez le bouton Partager (carré avec une flèche vers le haut).",
              "Choisissez « Sur l'écran d'accueil », puis Ajouter.",
              "Ouvrez IziPilot depuis l'icône ainsi créée, et revenez ici.",
            ]}
            action={
              <button
                type="button"
                onClick={() => exempt("IOS_NOT_INSTALLED")}
                disabled={busy}
                className="rounded-[7px] border border-border-soft bg-white px-4 py-2 text-[12px] font-medium text-izi-gray hover:bg-gray-lt disabled:opacity-50"
              >
                Je ne peux pas installer — continuer sans notifications
              </button>
            }
          />
        )}

        {shown === "NO_SUPPORT" && (
          <Instructions
            title="Ce navigateur ne gère pas les notifications"
            intro="Rien à régler de votre côté : cette version ne propose pas le Web Push. Vous pouvez continuer, mais vous ne recevrez aucun rappel — le management verra que vous êtes dans ce cas."
            steps={[
              "Sur ordinateur, Chrome, Edge et Firefox à jour les gèrent.",
              "Sur Android, Chrome les gère.",
            ]}
            action={
              <button
                type="button"
                onClick={() => exempt("NO_SUPPORT")}
                disabled={busy}
                className="rounded-[7px] bg-teal px-4 py-2 text-[13px] font-medium text-white hover:bg-teal-dk disabled:opacity-50"
              >
                Continuer sans notifications
              </button>
            }
          />
        )}

        {shown === "PUSH_SERVICE_ERROR" && (
          <Instructions
            title="Le service de notifications du navigateur ne répond pas"
            intro="L'autorisation est bien donnée, mais votre navigateur n'arrive pas à joindre son service de notifications. C'est presque toujours Brave, qui le désactive par défaut."
            steps={[
              "Brave : ouvrez brave://settings/privacy et activez « Utiliser les services Google pour la messagerie push ».",
              "Fermez complètement Brave et rouvrez-le, puis revenez sur cette page.",
              "Sinon, ouvrez IziPilot dans Chrome, Edge ou Firefox.",
            ]}
            action={
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="rounded-[7px] bg-teal px-4 py-2 text-[13px] font-medium text-white hover:bg-teal-dk"
                >
                  J&apos;ai activé le réglage — réessayer
                </button>
                <button
                  type="button"
                  onClick={() => exempt("PUSH_SERVICE_ERROR")}
                  disabled={busy}
                  className="rounded-[7px] border border-border-soft bg-white px-4 py-2 text-[12px] font-medium text-izi-gray hover:bg-gray-lt disabled:opacity-50"
                >
                  Impossible de régler — continuer sans notifications
                </button>
              </div>
            }
          />
        )}

        {error && (
          <p className="mt-3 rounded-[7px] border border-red/30 bg-red-lt px-3 py-2 text-[11px] text-red">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}

function Instructions({
  title,
  intro,
  steps,
  action,
}: {
  title: string;
  intro: string;
  steps: string[];
  action: React.ReactNode;
}) {
  return (
    <div>
      <div className="rounded-[10px] border border-gold/40 bg-gold-lt px-3.5 py-3 mb-3">
        <p className="text-[13px] font-medium text-dark">{title}</p>
        <p className="mt-1 text-[12px] text-dark-md">{intro}</p>
      </div>
      <ol className="space-y-1.5 mb-4">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2 text-[12px] text-dark">
            <span className="font-mono text-izi-gray shrink-0">{i + 1}.</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      {action}
    </div>
  );
}
