import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { isExemptReason, EXEMPT_REASONS } from "@/lib/push-gate";

/**
 * POST /api/account/push-exempt
 * Enregistre une dérogation à l'obligation de notifications pour le compte
 * courant.
 *
 * Les motifs acceptés sont une liste fermée d'impossibilités techniques
 * (cf. EXEMPT_REASONS) : un refus de permission n'en fait pas partie, il se
 * rattrape dans les réglages du navigateur.
 *
 * Cette route n'est pas une frontière de sécurité — l'appeler à la main
 * contourne la porte. C'est assumé : l'obligation vise à faire adopter les
 * notifications, pas à retenir quelqu'un contre son gré, et chaque dérogation
 * est datée, motivée et affichée au management sur /push-adoption.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const reason = (body as { reason?: unknown }).reason;
  if (!isExemptReason(reason)) {
    return Response.json(
      { error: "Motif de dérogation inconnu" },
      { status: 400 }
    );
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { pushExemptAt: new Date(), pushExemptReason: reason },
  });

  return Response.json({ ok: true, reason: EXEMPT_REASONS[reason] });
}

/**
 * DELETE — lever sa propre dérogation. Sert au retour à la normale : on change
 * de navigateur, on installe enfin l'application, et la porte doit redevenir
 * effective sans intervention d'un administrateur.
 */
export async function DELETE() {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  await prisma.user.update({
    where: { id: session.user.id },
    data: { pushExemptAt: null, pushExemptReason: null },
  });
  return Response.json({ ok: true });
}
