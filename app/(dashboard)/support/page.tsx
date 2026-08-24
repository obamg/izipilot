import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  isSupportAdmin,
  requestableDepartments,
  supportedDepartmentIds,
  supportRequestInclude,
} from "@/lib/support-request-server";
import { serializeSupportRequest } from "@/lib/support-request-serialize";
import { OPEN_STATUSES } from "@/lib/support-request";
import { CreateSupportRequestForm } from "@/components/support/CreateSupportRequestForm";
import { SupportRequestList } from "@/components/support/SupportRequestList";

export const dynamic = "force-dynamic";

/** Mes demandes — le point d'entrée de tout le monde dans le module. */
export default async function SupportPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const viewer = {
    id: session.user.id,
    orgId: session.user.orgId,
    role: session.user.role,
  };

  const [departments, mine, supported] = await Promise.all([
    requestableDepartments(viewer.orgId),
    prisma.supportRequest.findMany({
      where: { orgId: viewer.orgId, requesterId: viewer.id },
      include: supportRequestInclude,
      orderBy: [{ createdAt: "desc" }],
    }),
    supportedDepartmentIds(viewer),
  ]);

  const now = new Date();
  const serialized = mine.map((r) => serializeSupportRequest(r, now));
  const open = serialized.filter((r) => OPEN_STATUSES.includes(r.status));
  const done = serialized.filter((r) => !OPEN_STATUSES.includes(r.status));

  // Le lien vers la file n'apparaît qu'aux personnes qui la traitent.
  const handlesQueue =
    (isSupportAdmin(viewer.role) || supported.length > 0) && viewer.role !== "VIEWER";

  const assignedToMe = handlesQueue
    ? await prisma.supportRequest.count({
        where: {
          orgId: viewer.orgId,
          assigneeId: viewer.id,
          status: { in: [...OPEN_STATUSES] },
        },
      })
    : 0;

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-[24px] text-dark">Mes demandes</h1>
          <p className="mt-0.5 text-[13px] text-izi-gray">
            Adressez vos demandes au guichet concerné — elles sont tracées, priorisées
            et vous êtes notifié à chaque étape.
          </p>
        </div>
        {handlesQueue && (
          <Link
            href="/support/queue"
            className="shrink-0 rounded-[8px] border border-border-soft bg-white px-3 py-2 text-[13px] font-medium text-teal-dk hover:border-teal transition-colors no-underline"
          >
            File du support
            {assignedToMe > 0 && (
              <span className="ml-1.5 rounded-full bg-gold-lt px-1.5 py-0.5 text-[11px] font-bold text-gold">
                {assignedToMe}
              </span>
            )}
          </Link>
        )}
      </div>

      {viewer.role !== "VIEWER" && (
        <CreateSupportRequestForm departments={departments} />
      )}

      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-izi-gray">
          En cours ({open.length})
        </h2>
        <SupportRequestList
          requests={open}
          emptyLabel="Aucune demande en cours."
        />
      </section>

      {done.length > 0 && (
        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-izi-gray">
            Historique ({done.length})
          </h2>
          <SupportRequestList requests={done} />
        </section>
      )}
    </div>
  );
}
