import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  ensureAccessProfile,
  resolvePrimaryDepartment,
} from "@/lib/access/profile-server";

describe("profile-server — ensureAccessProfile & resolvePrimaryDepartment", () => {
  let orgId: string;
  let ownerUserId: string;
  let dept1Id: string;
  let dept2Id: string;
  let userWithZeroDepts: string;
  let userWithOneDept: string;
  let userWithTwoDepts: string;

  beforeAll(async () => {
    // Create test organization
    const org = await prisma.organization.create({
      data: {
        name: "Test Profile Server Org",
        slug: `test-profile-${Date.now()}`,
      },
    });
    orgId = org.id;

    // Create owner user (required for Department.ownerId)
    const owner = await prisma.user.create({
      data: {
        orgId,
        email: `test-profile-owner-${Date.now()}@example.com`,
        name: "Department Owner",
        role: "PO",
      },
    });
    ownerUserId = owner.id;

    // Create two departments with the owner as their owner
    const d1 = await prisma.department.create({
      data: {
        orgId,
        code: "DEPT1",
        name: "Department 1",
        color: "#008081",
        ownerId: ownerUserId,
      },
    });
    dept1Id = d1.id;

    const d2 = await prisma.department.create({
      data: {
        orgId,
        code: "DEPT2",
        name: "Department 2",
        color: "#1d9e75",
        ownerId: ownerUserId,
      },
    });
    dept2Id = d2.id;

    // Create user with zero department memberships
    const userZero = await prisma.user.create({
      data: {
        orgId,
        email: `test-profile-zero-depts-${Date.now()}@example.com`,
        name: "User Zero Depts",
        role: "PO",
      },
    });
    userWithZeroDepts = userZero.id;

    // Create user with exactly one department membership
    const userOne = await prisma.user.create({
      data: {
        orgId,
        email: `test-profile-one-dept-${Date.now()}@example.com`,
        name: "User One Dept",
        role: "PO",
      },
    });
    userWithOneDept = userOne.id;
    await prisma.departmentMember.create({
      data: {
        departmentId: dept1Id,
        userId: userWithOneDept,
      },
    });

    // Create user with two department memberships
    const userTwo = await prisma.user.create({
      data: {
        orgId,
        email: `test-profile-two-depts-${Date.now()}@example.com`,
        name: "User Two Depts",
        role: "PO",
      },
    });
    userWithTwoDepts = userTwo.id;
    await prisma.departmentMember.create({
      data: {
        departmentId: dept1Id,
        userId: userWithTwoDepts,
      },
    });
    await prisma.departmentMember.create({
      data: {
        departmentId: dept2Id,
        userId: userWithTwoDepts,
      },
    });
  });

  afterAll(async () => {
    // Delete in safe order: profiles → members → departments → users → org
    await prisma.accessProfile.deleteMany({ where: { orgId } });
    await prisma.departmentMember.deleteMany({
      where: {
        department: { orgId },
      },
    });
    await prisma.department.deleteMany({ where: { orgId } });
    await prisma.user.deleteMany({ where: { orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  // ============================================================================
  // Tests for resolvePrimaryDepartment
  // ============================================================================

  it("resolvePrimaryDepartment returns null for user with zero memberships", async () => {
    const result = await resolvePrimaryDepartment(prisma, userWithZeroDepts);
    expect(result).toBeNull();
  });

  it("resolvePrimaryDepartment returns department id for user with exactly one membership", async () => {
    const result = await resolvePrimaryDepartment(prisma, userWithOneDept);
    expect(result).toBe(dept1Id);
  });

  it("resolvePrimaryDepartment returns null for user with multiple memberships", async () => {
    const result = await resolvePrimaryDepartment(prisma, userWithTwoDepts);
    expect(result).toBeNull();
  });

  // ============================================================================
  // Tests for ensureAccessProfile
  // ============================================================================

  it("ensureAccessProfile creates profile with primaryDepartmentId for one-department user", async () => {
    // Create a fresh user with exactly one department for this test
    const user = await prisma.user.create({
      data: {
        orgId,
        email: `test-profile-one-dept-fresh-${Date.now()}@example.com`,
        name: "Fresh One Dept User",
        role: "PO",
      },
    });
    await prisma.departmentMember.create({
      data: {
        departmentId: dept1Id,
        userId: user.id,
      },
    });

    // Ensure profile doesn't exist yet
    const existingProfile = await prisma.accessProfile.findUnique({
      where: { userId: user.id },
    });
    expect(existingProfile).toBeNull();

    // Call ensureAccessProfile
    await ensureAccessProfile(prisma, orgId, user.id);

    // Verify profile was created with correct primaryDepartmentId
    const profile = await prisma.accessProfile.findUnique({
      where: { userId: user.id },
    });
    expect(profile).toBeDefined();
    expect(profile?.primaryDepartmentId).toBe(dept1Id);
    expect(profile?.lifecycle).toBe("ACTIVE");
    expect(profile?.orgId).toBe(orgId);

    // Cleanup
    await prisma.departmentMember.deleteMany({ where: { userId: user.id } });
    await prisma.accessProfile.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("ensureAccessProfile creates profile with null primaryDepartmentId for zero-department user", async () => {
    // Create a fresh user with zero departments
    const user = await prisma.user.create({
      data: {
        orgId,
        email: `test-profile-zero-depts-fresh-${Date.now()}@example.com`,
        name: "Fresh Zero Dept User",
        role: "PO",
      },
    });

    // Call ensureAccessProfile
    await ensureAccessProfile(prisma, orgId, user.id);

    // Verify profile was created with null primaryDepartmentId
    const profile = await prisma.accessProfile.findUnique({
      where: { userId: user.id },
    });
    expect(profile).toBeDefined();
    expect(profile?.primaryDepartmentId).toBeNull();
    expect(profile?.lifecycle).toBe("ACTIVE");
    expect(profile?.orgId).toBe(orgId);

    // Cleanup
    await prisma.accessProfile.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("ensureAccessProfile creates profile with null primaryDepartmentId for multi-department user", async () => {
    // Create a fresh user with two departments
    const user = await prisma.user.create({
      data: {
        orgId,
        email: `test-profile-two-depts-fresh-${Date.now()}@example.com`,
        name: "Fresh Two Depts User",
        role: "PO",
      },
    });
    await prisma.departmentMember.create({
      data: {
        departmentId: dept1Id,
        userId: user.id,
      },
    });
    await prisma.departmentMember.create({
      data: {
        departmentId: dept2Id,
        userId: user.id,
      },
    });

    // Call ensureAccessProfile
    await ensureAccessProfile(prisma, orgId, user.id);

    // Verify profile was created with null primaryDepartmentId
    const profile = await prisma.accessProfile.findUnique({
      where: { userId: user.id },
    });
    expect(profile).toBeDefined();
    expect(profile?.primaryDepartmentId).toBeNull();
    expect(profile?.lifecycle).toBe("ACTIVE");
    expect(profile?.orgId).toBe(orgId);

    // Cleanup
    await prisma.departmentMember.deleteMany({ where: { userId: user.id } });
    await prisma.accessProfile.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("ensureAccessProfile is idempotent and does not overwrite existing profile", async () => {
    // Create a fresh user with exactly one department
    const user = await prisma.user.create({
      data: {
        orgId,
        email: `test-profile-idempotent-${Date.now()}@example.com`,
        name: "Idempotent Test User",
        role: "PO",
      },
    });
    await prisma.departmentMember.create({
      data: {
        departmentId: dept1Id,
        userId: user.id,
      },
    });

    // Call ensureAccessProfile first time
    await ensureAccessProfile(prisma, orgId, user.id);

    // Verify profile was created with dept1Id as primary
    const profileAfterFirst = await prisma.accessProfile.findUnique({
      where: { userId: user.id },
    });
    expect(profileAfterFirst?.primaryDepartmentId).toBe(dept1Id);

    // Manually update the profile to a DIFFERENT department (simulating admin correction)
    await prisma.accessProfile.update({
      where: { userId: user.id },
      data: { primaryDepartmentId: dept2Id },
    });

    // Verify the update worked
    const profileAfterManualUpdate = await prisma.accessProfile.findUnique({
      where: { userId: user.id },
    });
    expect(profileAfterManualUpdate?.primaryDepartmentId).toBe(dept2Id);

    // Call ensureAccessProfile again
    await ensureAccessProfile(prisma, orgId, user.id);

    // Verify profile still has the manually-corrected department (NOT overwritten)
    const profileAfterSecond = await prisma.accessProfile.findUnique({
      where: { userId: user.id },
    });
    expect(profileAfterSecond?.primaryDepartmentId).toBe(dept2Id);
    expect(profileAfterSecond?.lifecycle).toBe("ACTIVE");

    // Cleanup
    await prisma.departmentMember.deleteMany({ where: { userId: user.id } });
    await prisma.accessProfile.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});
