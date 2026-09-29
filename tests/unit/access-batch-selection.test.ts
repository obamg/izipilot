import { describe, it, expect } from "vitest";
import { splitBatchSelection } from "@/lib/access/batch-selection";

describe("splitBatchSelection — une escalade cochée n'entre jamais dans un lot", () => {
  it("exclut du lot les étapes sélectionnées dont l'escalade est cochée", () => {
    const result = splitBatchSelection(
      { s1: true, s2: true, s3: true },
      { s2: true }
    );
    expect(result.approvable).toEqual(["s1", "s3"]);
    expect(result.escalating).toEqual(["s2"]);
  });

  it("ignore les étapes désélectionnées, escaladées ou non", () => {
    const result = splitBatchSelection({ s1: false, s2: false, s3: true }, { s1: true, s3: false });
    expect(result.approvable).toEqual(["s3"]);
    expect(result.escalating).toEqual([]);
  });

  it("sélection vide : rien à approuver", () => {
    expect(splitBatchSelection({}, { s1: true })).toEqual({ approvable: [], escalating: [] });
  });
});
