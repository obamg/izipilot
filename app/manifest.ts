import type { MetadataRoute } from "next";

// PWA manifest — served at /manifest.webmanifest (whitelisted in middleware).
// start_url points at /dashboard: unauthenticated launches bounce through
// /login with a callbackUrl and land back there after sign-in.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "IziPilot — Pilotage OKR",
    short_name: "IziPilot",
    description: "L'exécution au rythme de vos ambitions",
    id: "/",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "fr",
    background_color: "#f2f6f7",
    theme_color: "#008081",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Ma revue hebdo",
        short_name: "Ma revue",
        url: "/weekly",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Alertes & décisions",
        short_name: "Alertes",
        url: "/alerts",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Synthèse Management",
        short_name: "Synthèse",
        url: "/synthesis",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
