import { describe, expect, it } from "vitest";
import { krVisibilityWhere } from "@/lib/visibility";
import { krVisibilityWhere as mcpKrVisibilityWhere } from "../../mcp-server/src/context";

// The MCP server can't import lib/, so it carries a copy of the D7 filter.
// This keeps the copy from drifting: a divergence would re-open the D7 leak.
describe("MCP krVisibilityWhere stays in sync with lib/visibility", () => {
  for (const role of ["CEO", "MANAGEMENT", "PO", "CONTRIBUTOR", "VIEWER"] as const) {
    it(`same filter for ${role}`, () => {
      expect(mcpKrVisibilityWhere(role)).toEqual(krVisibilityWhere(role));
    });
  }

  it("hides D7 from non-privileged roles", () => {
    expect(mcpKrVisibilityWhere("VIEWER")).not.toEqual({});
  });
});
