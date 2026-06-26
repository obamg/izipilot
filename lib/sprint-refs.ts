import { prisma } from "@/lib/prisma";

/**
 * Validate that an assignee / product / department referenced by a sprint task
 * all belong to the given org. Returns an error `Response` to short-circuit the
 * handler, or `null` when everything checks out. Only provided fields are
 * checked (use `undefined` to skip, `null` to explicitly clear a field).
 */
export async function validateTeamAndAssignee(
  orgId: string,
  d: {
    assigneeId?: string | null;
    productId?: string | null;
    departmentId?: string | null;
  }
): Promise<Response | null> {
  if (d.assigneeId) {
    const assignee = await prisma.user.findFirst({
      where: { id: d.assigneeId, orgId, isActive: true },
      select: { id: true },
    });
    if (!assignee) {
      return Response.json(
        { error: "Assignee not found in your organization" },
        { status: 400 }
      );
    }
  }
  if (d.productId) {
    const product = await prisma.product.findFirst({
      where: { id: d.productId, orgId },
      select: { id: true },
    });
    if (!product) {
      return Response.json({ error: "Product not found" }, { status: 400 });
    }
  }
  if (d.departmentId) {
    const department = await prisma.department.findFirst({
      where: { id: d.departmentId, orgId },
      select: { id: true },
    });
    if (!department) {
      return Response.json({ error: "Department not found" }, { status: 400 });
    }
  }
  return null;
}
