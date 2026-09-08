import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { evaluateAllMembers } from "@/lib/member-compliance-server";
import { ISSUE_LABELS, STANDUP_CUTOFF_HOUR } from "@/lib/member-compliance";

export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<string, string> = {
  CEO: "CEO",
  MANAGEMENT: "Management",
  PO: "PO",
  CONTRIBUTOR: "Contributeur",
  VIEWER: "Viewer",
};

export default async function SuiviEquipePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = session.user.role;
  if (role !== "CEO" && role !== "MANAGEMENT") redirect("/dashboard");

  const { rows, sprintId, standupDue } = await evaluateAllMembers(session.user.orgId);

  if (!sprintId) {
    return (
      <div className="max-w-3xl">
        <h1 className="font-serif text-[24px] text-dark">Suivi de l&apos;équipe</h1>
        <p className="text-[13px] text-izi-gray mt-2">
          Aucun sprint actif : les deux règles ne s&apos;appliquent pas et
          personne n&apos;est bloqué.
        </p>
      </div>
    );
  }

  const enRegle = rows.filter((r) => r.issues.length === 0);
  const bloques = rows.filter((r) => r.blocking);
  // Volontairement défini par le MANQUEMENT et non par « non bloqué » : sans
  // travail assigné mais bloqué sur le standup, quelqu'un doit apparaître dans
  // les deux listes. Le compter une seule fois ferait disparaître du compteur
  // du management la seule chose qu'il puisse corriger.
  const signales = rows.filter(
    (r) =>
      r.issues.includes("NO_TASK_ASSIGNED") || r.issues.includes("NO_TASK_TO_START")
  );

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="font-serif text-[24px] text-dark">Suivi de l&apos;équipe</h1>
        <p className="text-[13px] text-izi-gray mt-0.5">
          Deux règles sur le sprint actif : avoir <strong>une tâche en cours</strong>{" "}
          et avoir rempli son <strong>rapport quotidien</strong>. Qui ne les
          respecte pas est renvoyé vers un écran de mise à jour avant de pouvoir
          continuer.
        </p>
        {!standupDue && (
          <p className="text-[11px] text-izi-gray mt-1.5">
            Le rapport quotidien n&apos;est exigé qu&apos;à partir de{" "}
            {STANDUP_CUTOFF_HOUR}h, les jours ouvrés — il n&apos;est pas compté
            comme manquant pour l&apos;instant.
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="En règle" value={enRegle.length} tone="green" />
        <Stat label="Bloqués" value={bloques.length} tone={bloques.length > 0 ? "red" : "gray"} />
        <Stat label="À traiter par vous" value={signales.length} tone={signales.length > 0 ? "gold" : "gray"} />
      </div>

      {signales.length > 0 && (
        <Section
          title={`En attente de travail (${signales.length})`}
          tone="gold"
          note="Ces personnes n'ont rien en cours faute de matière : aucune tâche assignée, ou tout est déjà terminé. Ce manquement-là ne les bloque jamais — elles ne peuvent pas s'assigner du travail elles-mêmes, c'est à leur PO de le faire. Certaines peuvent tout de même figurer plus bas si leur rapport quotidien manque."
          rows={signales}
        />
      )}

      {bloques.length > 0 && (
        <Section
          title={`Bloqués jusqu'à régularisation (${bloques.length})`}
          tone="red"
          note="L'application les conduit vers un écran qui leur permet de démarrer une tâche et de remplir leur rapport sur place."
          rows={bloques}
        />
      )}

      {enRegle.length > 0 && (
        <Section title={`En règle (${enRegle.length})`} tone="green" rows={enRegle} />
      )}

      <p className="text-[11px] text-izi-gray">
        Le détail des rapports se lit dans l&apos;onglet{" "}
        <Link href={`/sprints/${sprintId}`} className="text-teal hover:text-teal-dk font-medium">
          Rapport quotidien du sprint
        </Link>
        .
      </p>
    </div>
  );
}

function Section({
  title,
  tone,
  note,
  rows,
}: {
  title: string;
  tone: "red" | "gold" | "green";
  note?: string;
  rows: {
    userId: string;
    userName: string;
    role: string;
    assignedCount: number;
    inProgressCount: number;
    hasStandupToday: boolean;
    issues: string[];
  }[];
}) {
  const border =
    tone === "red" ? "border-red/40" : tone === "gold" ? "border-gold/40" : "border-border-soft";
  return (
    <div className={`bg-white rounded-[10px] border ${border} overflow-hidden`}>
      <div className="px-4 py-3 border-b border-border-soft">
        <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-izi-gray">
          {title}
        </div>
        {note && <p className="text-[11px] text-izi-gray mt-1">{note}</p>}
      </div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-izi-gray text-left">
            <th className="font-medium px-4 py-2">Membre</th>
            <th className="font-medium px-4 py-2 text-right">En cours</th>
            <th className="font-medium px-4 py-2 text-right">Assignées</th>
            <th className="font-medium px-4 py-2 text-center">Rapport</th>
            <th className="font-medium px-4 py-2">Manquements</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.userId} className="border-t border-border-soft">
              <td className="px-4 py-2 text-dark">
                {r.userName}
                <span className="ml-1.5 text-[10px] text-izi-gray">
                  {ROLE_LABELS[r.role] ?? r.role}
                </span>
              </td>
              <td className="px-4 py-2 text-right font-mono tabular-nums text-dark">
                {r.inProgressCount}
              </td>
              <td className="px-4 py-2 text-right font-mono tabular-nums text-izi-gray">
                {r.assignedCount}
              </td>
              <td className="px-4 py-2 text-center">{r.hasStandupToday ? "✓" : "—"}</td>
              <td className="px-4 py-2 text-[11px] text-izi-gray">
                {r.issues.length === 0
                  ? "—"
                  : r.issues
                      .map((i) => ISSUE_LABELS[i as keyof typeof ISSUE_LABELS] ?? i)
                      .join(" · ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "green" | "red" | "gold" | "gray";
}) {
  const color =
    tone === "green"
      ? "var(--green)"
      : tone === "red"
        ? "var(--red)"
        : tone === "gold"
          ? "var(--gold)"
          : "var(--gray)";
  return (
    <div className="bg-white rounded-[10px] border border-border-soft p-4">
      <div className="font-mono text-[24px] font-bold tabular-nums" style={{ color }}>
        {value}
      </div>
      <div className="text-[11px] text-izi-gray mt-0.5">{label}</div>
    </div>
  );
}
