import { describe, it, expect } from "vitest";
import { buildAuditEvent, escapeCsvField, toCsvRow } from "@/lib/access/audit";

describe("buildAuditEvent", () => {
  it("recopie fidèlement les champs fournis", () => {
    const input = {
      orgId: "org1",
      actorId: "u1",
      actorRole: "ASSET_ADMINISTRATOR",
      primaryCoveredId: null,
      scopeType: "ASSET",
      scopeId: "asset1",
      eventType: "ASSET_CREATED",
      objectType: "AccessAsset",
      objectId: "asset1",
      objectVersion: 1,
      beneficiaryId: null,
      before: null,
      after: { name: "CRM" },
      reason: null,
      outcome: "SUCCESS",
      correlationId: null,
    };
    expect(buildAuditEvent(input)).toEqual(input);
  });
});

describe("escapeCsvField", () => {
  it("neutralise une valeur commençant par =, +, -, @ (injection de formule)", () => {
    expect(escapeCsvField("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(escapeCsvField("+1234")).toBe("'+1234");
    expect(escapeCsvField("-1234")).toBe("'-1234");
    expect(escapeCsvField("@cmd")).toBe("'@cmd");
  });

  it("laisse intacte une valeur normale", () => {
    expect(escapeCsvField("Département IT")).toBe("Département IT");
  });

  it("échappe les guillemets et encadre si la valeur contient une virgule ou un guillemet", () => {
    expect(escapeCsvField("a,b")).toBe('"a,b"');
    expect(escapeCsvField('a"b')).toBe('"a""b"');
  });

  it("gère une valeur vide", () => {
    expect(escapeCsvField("")).toBe("");
  });

  it("neutralise une valeur avec un tab avant un caractère de formule (OWASP CSV injection)", () => {
    expect(escapeCsvField("\t=SUM(A1)")).toBe("'\t=SUM(A1)");
    expect(escapeCsvField("\t+1234")).toBe("'\t+1234");
    expect(escapeCsvField("\t-1234")).toBe("'\t-1234");
    expect(escapeCsvField("\t@cmd")).toBe("'\t@cmd");
  });

  it("neutralise une valeur avec un retour chariot avant un caractère de formule (et la cite pour l'intégrité CSV)", () => {
    expect(escapeCsvField("\r=SUM(A1)")).toBe(`"'\r=SUM(A1)"`);
    expect(escapeCsvField("\r+1234")).toBe(`"'\r+1234"`);
  });

  it("neutralise une valeur avec un espace avant un caractère de formule", () => {
    expect(escapeCsvField(" =1+1")).toBe("' =1+1");
    expect(escapeCsvField(" +100")).toBe("' +100");
    expect(escapeCsvField(" -50")).toBe("' -50");
    expect(escapeCsvField(" @cmd")).toBe("' @cmd");
  });

  it("encadre une valeur contenant un retour chariot seul (intégrité structurelle CSV)", () => {
    expect(escapeCsvField("line1\rline2")).toBe('"line1\rline2"');
  });
});

describe("toCsvRow", () => {
  it("joint les champs échappés avec des virgules", () => {
    expect(toCsvRow(["a", "b,c", "=FORMULE"])).toBe('a,"b,c",\'=FORMULE');
  });
});
