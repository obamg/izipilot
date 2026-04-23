import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { createActionCommentSchema } from "@/lib/validations/actions";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ actionId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { actionId } = await params;

  // Verify action belongs to org
  const action = await prisma.action.findFirst({
    where: { id: actionId, orgId: session.user.orgId },
    select: { id: true },
  });

  if (!action) {
    return Response.json({ error: "Action not found" }, { status: 404 });
  }

  const comments = await prisma.actionComment.findMany({
    where: { actionId },
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

  return Response.json({
    data: comments.map((c) => ({
      id: c.id,
      authorId: c.author.id,
      authorName: c.author.name,
      content: c.content,
      createdAt: c.createdAt.toISOString(),
    })),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ actionId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role === "VIEWER") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { actionId } = await params;

  // Verify action belongs to org
  const action = await prisma.action.findFirst({
    where: { id: actionId, orgId: session.user.orgId },
    select: { id: true },
  });

  if (!action) {
    return Response.json({ error: "Action not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = createActionCommentSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const comment = await prisma.actionComment.create({
    data: {
      actionId,
      authorId: session.user.id,
      content: parsed.data.content,
    },
    include: { author: { select: { id: true, name: true } } },
  });

  return Response.json(
    {
      data: {
        id: comment.id,
        authorId: comment.author.id,
        authorName: comment.author.name,
        content: comment.content,
        createdAt: comment.createdAt.toISOString(),
      },
    },
    { status: 201 }
  );
}
