"use client";

import { useEffect } from "react";

/* Registers the service worker for every signed-in user so offline fallback
 * and asset caching work without requiring push opt-in (push registration in
 * PushToggle/PushNudgeBanner reuses the same registration). */
export function SWRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline support is progressive enhancement — never block the app on it.
    });
  }, []);

  return null;
}
