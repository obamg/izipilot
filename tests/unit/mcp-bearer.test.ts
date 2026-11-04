import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";

process.env.MCP_JWT_SECRET ||= "test-secret-for-mcp-bearer-0123456789abcdef";
const { mintMcpAccessToken, verifyMcpBearer } = await import("@/lib/mcp-token");

// verifyMcpBearer lets the MCP server forward writes to app routes; it must
// apply the same revocation rules as the MCP server itself.
describe("verifyMcpBearer", () => {
  let orgId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Test MCP Bearer Org", slug: `test-mcp-bearer-${Date.now()}` },
    });
    orgId = org.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  async function userWithToken(data: { isActive?: boolean } = {}) {
    const user = await prisma.user.create({
      data: {
        orgId,
        email: `test-mcp-bearer-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
        name: "MCP Bearer",
        role: "PO",
        isActive: data.isActive ?? true,
      },
    });
    const token = await mintMcpAccessToken({ userId: user.id, orgId, role: "PO" });
    return { user, header: `Bearer ${token}` };
  }

  it("accepts a valid token and returns the DB role", async () => {
    const { user, header } = await userWithToken();
    await prisma.user.update({ where: { id: user.id }, data: { role: "VIEWER" } });
    expect(await verifyMcpBearer(header)).toEqual({ id: user.id, orgId, role: "VIEWER" });
  });

  it("rejects missing, malformed and forged tokens", async () => {
    expect(await verifyMcpBearer(null)).toBeNull();
    expect(await verifyMcpBearer("Bearer not-a-jwt")).toBeNull();
    const { header } = await userWithToken();
    expect(await verifyMcpBearer(header.slice(0, -2) + "xx")).toBeNull();
  });

  it("rejects a deactivated user", async () => {
    const { header } = await userWithToken({ isActive: false });
    expect(await verifyMcpBearer(header)).toBeNull();
  });

  it("rejects a user who must still change their password", async () => {
    const { user, header } = await userWithToken();
    await prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: true } });
    expect(await verifyMcpBearer(header)).toBeNull();
  });

  it("rejects a token minted before the last password change", async () => {
    const { user, header } = await userWithToken();
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordChangedAt: new Date(Date.now() + 5_000) },
    });
    expect(await verifyMcpBearer(header)).toBeNull();
  });
});
