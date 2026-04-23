import type { ProductStatus } from "@prisma/client";

export const PRODUCTS = [
  { code: "P1", name: "Plateforme Trading Crypto", color: "#185FA5", status: "IN_DEVELOPMENT" as ProductStatus },
  { code: "P2", name: "Wallet Électronique Crypto", color: "#008081", status: "ACTIVE" as ProductStatus },
  { code: "P3", name: "Africapart", color: "#D85A30", status: "ACTIVE" as ProductStatus },
  { code: "P4", name: "API Collecte de Fonds", color: "#534AB7", status: "IN_DEVELOPMENT" as ProductStatus },
  { code: "P5", name: "IziChange PAY", color: "#BA7517", status: "IN_DEVELOPMENT" as ProductStatus },
  { code: "P6", name: "Carte Virtuelle IziChange", color: "#C0392B", status: "ACTIVE" as ProductStatus },
  { code: "P7", name: "IziLab", color: "#1D9E75", status: "PLANNED" as ProductStatus },
] as const;

export const DEPARTMENTS = [
  { code: "D1", name: "Communication & Marketing", color: "#D85A30" },
  { code: "D2", name: "IT", color: "#1C3A4A" },
  { code: "D3", name: "Finance", color: "#1D9E75" },
  { code: "D4", name: "Juridique & Compliance", color: "#BA7517" },
  { code: "D5", name: "Support Client", color: "#378ADD" },
  { code: "D6", name: "Stratégie & Innovation", color: "#639922" },
  { code: "D7", name: "Management", color: "#444441" },
  { code: "D8", name: "Ressources Humaines", color: "#C0392B" },
] as const;

/** Status color mapping for KR status badges */
export const STATUS_COLORS = {
  ON_TRACK: { bg: "#e1f5ee", text: "#1d9e75", label: "En bonne voie" },
  AT_RISK: { bg: "#fffbe6", text: "#f4a900", label: "Attention" },
  BLOCKED: { bg: "#fceaea", text: "#e23c4a", label: "Bloqué" },
  NOT_STARTED: { bg: "#f2f6f7", text: "#5f6e7a", label: "Non démarré" },
} as const;
