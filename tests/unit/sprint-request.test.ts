import { describe, it, expect } from "vitest";
import {
  isTargetedAt,
  canRaiseRequest,
  canResolveRequest,
  canCancelRequest,
  partitionInbox,
  describeTarget,
  targetCount,
  type ViewerTeams,
  type RequestLike,
} from "@/lib/sprint-request";

function req(over: Partial<RequestLike> = {}): RequestLike {
  return {
    requestedById: "asker",
    status: "OPEN",
    targetUserId: null,
    targetDepartmentId: null,
    targetProductId: null,
    ...over,
  };
}

function viewer(over: Partial<ViewerTeams> = {}): ViewerTeams {
  return {
    userId: "u1",
    role: "CONTRIBUTOR",
    departmentIds: [],
    productIds: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// isTargetedAt
// ---------------------------------------------------------------------------
describe("isTargetedAt", () => {
  it("matches the target user directly", () => {
    expect(isTargetedAt(req({ targetUserId: "u1" }), viewer())).toBe(true);
    expect(isTargetedAt(req({ targetUserId: "u2" }), viewer())).toBe(false);
  });
  it("matches via department membership", () => {
    expect(
      isTargetedAt(req({ targetDepartmentId: "d3" }), viewer({ departmentIds: ["d3"] }))
    ).toBe(true);
    expect(
      isTargetedAt(req({ targetDepartmentId: "d3" }), viewer({ departmentIds: ["d5"] }))
    ).toBe(false);
  });
  it("matches via product ownership", () => {
    expect(
      isTargetedAt(req({ targetProductId: "p2" }), viewer({ productIds: ["p2"] }))
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// canRaiseRequest
// ---------------------------------------------------------------------------
describe("canRaiseRequest", () => {
  it("VIEWER can never raise", () => {
    expect(canRaiseRequest({ assigneeId: "u1" }, { userId: "u1", role: "VIEWER" })).toBe(false);
  });
  it("CEO / MANAGEMENT / PO can raise on any task", () => {
    for (const role of ["CEO", "MANAGEMENT", "PO"] as const) {
      expect(canRaiseRequest({ assigneeId: "someone" }, { userId: "u1", role })).toBe(true);
    }
  });
  it("CONTRIBUTOR can raise only on their own assigned task", () => {
    expect(canRaiseRequest({ assigneeId: "u1" }, { userId: "u1", role: "CONTRIBUTOR" })).toBe(true);
    expect(canRaiseRequest({ assigneeId: "u2" }, { userId: "u1", role: "CONTRIBUTOR" })).toBe(false);
    expect(canRaiseRequest({ assigneeId: null }, { userId: "u1", role: "CONTRIBUTOR" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canResolveRequest
// ---------------------------------------------------------------------------
describe("canResolveRequest", () => {
  it("privileged roles can resolve any open request", () => {
    expect(canResolveRequest(req({ targetUserId: "other" }), viewer({ role: "MANAGEMENT" }))).toBe(true);
  });
  it("the target can resolve", () => {
    expect(canResolveRequest(req({ targetUserId: "u1" }), viewer())).toBe(true);
    expect(canResolveRequest(req({ targetDepartmentId: "d3" }), viewer({ departmentIds: ["d3"] }))).toBe(true);
  });
  it("a non-target non-privileged user cannot", () => {
    expect(canResolveRequest(req({ targetUserId: "other" }), viewer())).toBe(false);
  });
  it("cannot resolve a request that is not OPEN", () => {
    expect(canResolveRequest(req({ targetUserId: "u1", status: "RESOLVED" }), viewer())).toBe(false);
    // even privileged
    expect(canResolveRequest(req({ status: "DECLINED" }), viewer({ role: "CEO" }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canCancelRequest
// ---------------------------------------------------------------------------
describe("canCancelRequest", () => {
  it("the requester can cancel while OPEN", () => {
    expect(canCancelRequest(req({ requestedById: "u1" }), { userId: "u1" })).toBe(true);
  });
  it("a non-requester cannot", () => {
    expect(canCancelRequest(req({ requestedById: "other" }), { userId: "u1" })).toBe(false);
  });
  it("cannot cancel once closed", () => {
    expect(canCancelRequest(req({ requestedById: "u1", status: "RESOLVED" }), { userId: "u1" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// partitionInbox
// ---------------------------------------------------------------------------
describe("partitionInbox", () => {
  it("splits sent vs received and never double-lists", () => {
    const me = viewer({ userId: "u1", departmentIds: ["d3"] });
    const requests = [
      req({ requestedById: "u1", targetUserId: "x" }), // sent
      req({ requestedById: "x", targetUserId: "u1" }), // received (to me)
      req({ requestedById: "x", targetDepartmentId: "d3" }), // received (my dept)
      req({ requestedById: "x", targetUserId: "other" }), // neither
    ];
    const { received, sent } = partitionInbox(requests, me);
    expect(sent).toHaveLength(1);
    expect(received).toHaveLength(2);
  });
  it("excludes closed requests from received", () => {
    const me = viewer({ userId: "u1" });
    const requests = [req({ requestedById: "x", targetUserId: "u1", status: "RESOLVED" })];
    const { received } = partitionInbox(requests, me);
    expect(received).toHaveLength(0);
  });
  it("keeps my own closed requests in sent", () => {
    const me = viewer({ userId: "u1" });
    const { sent } = partitionInbox(
      [req({ requestedById: "u1", targetUserId: "x", status: "DECLINED" })],
      me
    );
    expect(sent).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// describeTarget / targetCount
// ---------------------------------------------------------------------------
describe("describeTarget", () => {
  it("prefers user, then department, then product", () => {
    expect(describeTarget({ targetUser: { name: "Awa" } })).toBe("Awa");
    expect(describeTarget({ targetDepartment: { code: "D3", name: "Finance" } })).toBe("Finance (D3)");
    expect(describeTarget({ targetProduct: { code: "P3", name: "Africapart" } })).toBe("Africapart (P3)");
    expect(describeTarget({})).toBe("—");
  });
});

describe("targetCount", () => {
  it("counts how many targets are set", () => {
    expect(targetCount({ targetUserId: "u1" })).toBe(1);
    expect(targetCount({})).toBe(0);
    expect(targetCount({ targetUserId: "u1", targetProductId: "p1" })).toBe(2);
  });
});
