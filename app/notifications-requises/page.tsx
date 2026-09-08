import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { evaluatePushGate } from "@/lib/push-gate-server";
import { PushGateScreen } from "@/components/push/PushGateScreen";

export const dynamic = "force-dynamic";

/**
 * La porte. Volontairement HORS du groupe (dashboard) : son layout redirige
 * ici, et l'y placer créerait une boucle de redirection infinie.
 *
 * La page revérifie l'état plutôt que de faire confiance à la redirection —
 * quelqu'un qui vient de s'abonner sur un autre onglet ne doit pas rester
 * coincé devant une porte déjà ouverte.
 */
export default async function NotificationsRequisesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const state = await evaluatePushGate(
    session.user.orgId,
    session.user.id,
    session.user.role
  );
  if (state !== "REQUIRED") redirect("/dashboard");

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

  // Sans clé VAPID configurée, personne ne PEUT s'abonner : bloquer serait
  // enfermer toute l'organisation dehors sur une erreur de déploiement.
  if (!vapidPublicKey) redirect("/dashboard");

  return (
    <PushGateScreen
      vapidPublicKey={vapidPublicKey}
      userName={session.user.name}
    />
  );
}
