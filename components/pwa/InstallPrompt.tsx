"use client";

import { useEffect, useState } from "react";

/* "Installer IziPilot" banner.
 * Android/desktop Chrome: captures beforeinstallprompt and triggers the native
 * install flow. iOS Safari has no install API, so we show the manual
 * Partager → « Sur l'écran d'accueil » instructions instead.
 * Dismissal is remembered for 30 days; never shown when already installed. */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "izipilot-install-dismissed-at";
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari legacy flag
    ("standalone" in window.navigator &&
      (window.navigator as { standalone?: boolean }).standalone === true)
  );
}

function isRecentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return Boolean(at) && Date.now() - at < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

export function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOS, setShowIOS] = useState(false);

  useEffect(() => {
    if (isStandalone() || isRecentlyDismissed()) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      // Chrome refires this on SPA navigations — re-check dismissal here,
      // not just at mount, or the banner resurrects after "Plus tard".
      if (isRecentlyDismissed() || isStandalone()) return;
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // iPadOS reports itself as Mac — the maxTouchPoints check catches it.
    const ua = window.navigator.userAgent;
    const isIOS =
      /iPhone|iPad|iPod/.test(ua) ||
      (/Macintosh/.test(ua) && window.navigator.maxTouchPoints > 1);
    // Delayed reveal: let the page settle before pitching the install.
    const iosTimer = isIOS ? setTimeout(() => setShowIOS(true), 2000) : undefined;

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      clearTimeout(iosTimer);
    };
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Private mode without storage — the banner just reappears next session.
    }
    setInstallEvent(null);
    setShowIOS(false);
  }

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    if (outcome === "accepted") {
      setInstallEvent(null);
      setShowIOS(false);
    } else {
      dismiss();
    }
  }

  if (!installEvent && !showIOS) return null;

  return (
    <div
      role="dialog"
      aria-label="Installer IziPilot"
      className="fixed left-4 right-4 lg:left-auto lg:right-6 lg:max-w-sm z-[var(--z-toast)] bottom-[calc(72px+env(safe-area-inset-bottom))] lg:bottom-6 bg-white border border-teal-md rounded-xl shadow-xl p-4 animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 bg-teal rounded-[10px] flex items-center justify-center shrink-0" aria-hidden="true">
          <svg viewBox="0 0 28 28" fill="none" className="w-5 h-5">
            <circle cx="14" cy="14" r="10" stroke="white" strokeWidth="2" />
            <path d="M14 8L14 14L18 17" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="14" cy="14" r="2.5" fill="white" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-semibold text-dark">Installer IziPilot</div>
          {installEvent ? (
            <p className="text-sm text-izi-gray mt-0.5">
              Ajoutez l&apos;app &agrave; votre &eacute;cran d&apos;accueil pour saisir votre revue en un geste.
            </p>
          ) : (
            <p className="text-sm text-izi-gray mt-0.5">
              Touchez{" "}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 inline align-[-2px] text-teal" aria-label="Partager">
                <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>{" "}
              <span className="font-medium">Partager</span> puis{" "}
              <span className="font-medium">&laquo;&nbsp;Sur l&apos;&eacute;cran d&apos;accueil&nbsp;&raquo;</span>{" "}
              pour installer l&apos;app.
            </p>
          )}
          <div className="flex gap-2 mt-3">
            {installEvent && (
              <button
                onClick={install}
                className="bg-teal hover:bg-teal-dk text-white text-sm font-medium px-4 py-2 min-h-[40px] rounded-lg cursor-pointer border-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 transition-colors"
              >
                Installer
              </button>
            )}
            <button
              onClick={dismiss}
              className="text-sm text-izi-gray hover:text-dark-md font-medium px-3 py-2 min-h-[40px] rounded-lg cursor-pointer border-none bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 transition-colors"
            >
              Plus tard
            </button>
          </div>
        </div>
        <button
          onClick={dismiss}
          aria-label="Fermer"
          className="w-8 h-8 -mt-1 -mr-1 rounded-lg flex items-center justify-center text-izi-gray hover:bg-gray-lt cursor-pointer border-none bg-transparent shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
