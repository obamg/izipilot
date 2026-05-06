import type { GleapProjectKey } from "@/lib/gleap";

// Maps each IziChange product code to the Gleap project that owns its support
// data. P1 (Trading) and P3 (Africapart) have dedicated Gleap projects;
// the others share a single project.
export const PRODUCT_GLEAP_PROJECT: Record<string, GleapProjectKey> = {
  P1: "TRADING",
  P2: "SHARED",
  P3: "AFRICAPART",
  P4: "SHARED",
  P5: "SHARED",
  P6: "SHARED",
  P7: "SHARED",
};
