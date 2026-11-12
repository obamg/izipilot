import { describe, expect, it } from "vitest";
import { textTone } from "@/lib/text-tone";

describe("textTone", () => {
  it("assombrit les couleurs de statut, en variable ou en hex", () => {
    expect(textTone("var(--red)")).toBe("var(--red-dk)");
    expect(textTone("var(--green)")).toBe("var(--green-dk)");
    expect(textTone("#F4A900")).toBe("var(--gold-dk)");
  });

  it("laisse passer toute autre couleur et undefined", () => {
    expect(textTone("var(--teal)")).toBe("var(--teal)");
    expect(textTone("#185FA5")).toBe("#185FA5");
    expect(textTone(undefined)).toBeUndefined();
  });
});
