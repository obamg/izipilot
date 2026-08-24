import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadRequestForViewer } from "@/lib/support-request-server";
import {
  serializeSupportAttachment,
  serializeSupportComment,
  serializeSupportRequest,
} from "@/lib/support-request-serialize";
import { SupportRequestDetail } from "@/components/support/SupportRequestDetail";

export const dynamic = "force-dynamic";

export default async function SupportRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const viewer = {
    id: session.user.id,
    orgId: session.user.orgId,
    role: session.user.role,
  };
  const { id } = await params;

  const loaded = await loadRequestForViewer(viewer, id);
  if (!loaded) notFound();
  const { request, access } = loaded;

  const [comments, attachments] = await Promise.all([
    prisma.supportRequestComment.findMany({
      // Les notes internes sont filtrées en base, pas à l'affichage : elles ne
      // doivent jamais transiter jusqu'au navigateur du demandeur.
      where: { requestId: id, ...(access.canHandle ? {} : { isInternal: false }) },
      include: { author: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.supportRequestAttachment.findMany({
      where: { requestId: id },
      include: { uploadedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  // Assignables et sprints ne servent qu'au panneau de traitement.
  const [assignables, sprints] = access.canHandle
    ? await Promise.all([
        prisma.user.findMany({
          where: {
            orgId: viewer.orgId,
            isActive: true,
            OR: [
              { departmentMembers: { some: { departmentId: request.departmentId } } },
              { ownedDepartments: { some: { id: request.departmentId } } },
              { supportedDepartments: { some: { id: request.departmentId } } },
            ],
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
        prisma.sprint.findMany({
          where: { orgId: viewer.orgId, status: { in: ["ACTIVE", "PLANNED"] } },
          select: { id: true, name: true, number: true },
          orderBy: { number: "desc" },
        }),
      ])
    : [[], []];

  return (
    <div className="max-w-3xl space-y-4">
      <Link
        href="/support"
        className="inline-block text-[12px] text-izi-gray hover:text-dark no-underline"
      >
        ← Toutes mes demandes
      </Link>

      <SupportRequestDetail
        request={serializeSupportRequest(request)}
        comments={comments.map(serializeSupportComment)}
        attachments={attachments.map(serializeSupportAttachment)}
        access={{
          canHandle: access.canHandle,
          isRequester: access.isRequester,
          actor: access.actor,
        }}
        currentUserId={viewer.id}
        assignables={assignables}
        sprints={sprints}
      />
    </div>
  );
}
