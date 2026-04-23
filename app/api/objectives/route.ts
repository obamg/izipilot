import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { scoreToPercent, objectiveScore } from "@/lib/score";

const getObjectivesSchema = z.object({
  entityType: z.enum(["DEPARTMENT", "PRODUCT"]).optional(),
  departmentId: z.string().optional(),
  productId: z.string().optional(),
  quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]).optional(),
  year: z.coerce.number().int().min(2024).max(2030).optional(),
});

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const params = getObjectivesSchema.safeParse({
    entityType: searchParams.get("entityType") ?? undefined,
    departmentId: searchParams.get("departmentId") ?? undefined,
    productId: searchParams.get("productId") ?? undefined,
    quarter: searchParams.get("quarter") ?? undefined,
    year: searchParams.get("year") ?? undefined,
  });

  if (!params.success) {
    return Response.json(
      { error: "Invalid query params", details: params.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { entityType, departmentId, productId, quarter, year } = params.data;

  const objectives = await prisma.objective.findMany({
    where: {
      orgId: session.user.orgId,
      isActive: true,
      ...(entityType && { entityType }),
      ...(departmentId && { departmentId }),
      ...(productId && { productId }),
      ...(quarter && { quarter }),
      ...(year && { year }),
    },
    include: {
      keyResults: {
        where: { isActive: true, deletedAt: null },
        include: { owner: { select: { name: true } } },
        orderBy: { sortOrder: "asc" },
      },
      department: { select: { name: true, color: true } },
      product: { select: { name: true, color: true } },
    },
    orderBy: { sortOrder: "asc" },
  });

  const data = objectives.map((obj) => {
    const krSummaries = obj.keyResults.map((kr) => ({
      id: kr.id,
      title: kr.title,
      krType: kr.krType,
      target: kr.target,
      targetUnit: kr.targetUnit,
      currentValue: kr.currentValue,
      scorePercent: scoreToPercent(kr.score),
      status: kr.status,
      ownerName: kr.owner?.name ?? "—",
    }));

    return {
      id: obj.id,
      title: obj.title,
      why: obj.why,
      entityType: obj.entityType,
      departmentId: obj.departmentId,
      productId: obj.productId,
      quarter: obj.quarter,
      year: obj.year,
      entityName: obj.product?.name ?? obj.department?.name ?? null,
      entityColor: obj.product?.color ?? obj.department?.color ?? null,
      keyResults: krSummaries,
      scorePercent: scoreToPercent(
        objectiveScore(obj.keyResults.map((kr) => kr.score))
      ),
    };
  });

  return Response.json({ data });
}
