import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { AppraisalDetail } from "@/components/appraisals/AppraisalDetail";
import { serializeAppraisal } from "@/lib/appraisal-serialize";
import { evaluableSubjectIds, canEvaluate } from "@/lib/appraisal-server";

export const dynamic = "force-dynamic";

export default async function AppraisalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { id } = await params;
  const orgId = session.user.orgId;

  const appraisal = await prisma.appraisal.findFirst({
    where: { id, orgId },
    include: {
      subject: { select: { id: true, name: true } },
      manager: { select: { id: true, name: true } },
    },
  });
  if (!appraisal) notFound();

  const isSubject = appraisal.subjectId === session.user.id;
  const allowed = await evaluableSubjectIds(orgId, {
    id: session.user.id,
    role: session.user.role,
  });
  const isManager =
    appraisal.managerId === session.user.id ||
    canEvaluate(allowed, appraisal.subjectId, session.user.id);
  const canView =
    isSubject || isManager || session.user.role === "CEO" || session.user.role === "MANAGEMENT";
  if (!canView) redirect("/dashboard");

  const backHref = isSubject && !isManager ? "/my-appraisals" : "/appraisals";

  return (
    <div>
      <Link href={backHref} className="text-[12px] text-teal hover:text-teal-dk">
        ← Retour
      </Link>
      <div className="mt-2">
        <AppraisalDetail
          appraisal={serializeAppraisal(appraisal)}
          isSubject={isSubject}
          isManager={isManager}
        />
      </div>
    </div>
  );
}
