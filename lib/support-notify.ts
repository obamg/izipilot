/**
 * Notifications du module demandes internes : email (Resend) + push (VAPID) +
 * trace en base, en respectant la préférence `supportRequest` de chaque
 * destinataire.
 *
 * Toutes les fonctions sont best-effort : une notification qui échoue ne doit
 * jamais faire échouer l'action métier qui l'a déclenchée. Les appelants les
 * lancent après avoir committé leur écriture.
 */

import * as React from "react";
import type { NotificationType } from "@prisma/client";
import { prisma } from "./prisma";
import { sendEmail } from "./email";
import { sendPushToUser } from "./push";
import { filterRecipientsByPref } from "./notification-prefs";
import { log } from "./log";
import {
  SUPPORT_CATEGORY_META,
  SUPPORT_PRIORITY_META,
  SUPPORT_STATUS_META,
} from "./support-request";
import SupportRequestNotification, {
  type SupportEmailKind,
} from "@/emails/SupportRequestNotification";

const logger = log.child("support-notify");

export interface NotifiableRequest {
  id: string;
  reference: string;
  title: string;
  status: keyof typeof SUPPORT_STATUS_META;
  priority: keyof typeof SUPPORT_PRIORITY_META;
  category: keyof typeof SUPPORT_CATEGORY_META;
  dueAt: Date | null;
  department: { name: string };
  requester: { name: string };
  assignee: { name: string } | null;
}

export interface Recipient {
  id: string;
  name: string;
  email: string;
}

const TYPE_BY_KIND: Record<SupportEmailKind, NotificationType> = {
  NEW: "SUPPORT_REQUEST_NEW",
  UPDATE: "SUPPORT_REQUEST_UPDATE",
  OVERDUE: "SUPPORT_REQUEST_OVERDUE",
};

const dateFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Africa/Porto-Novo",
});

/**
 * Envoie une notification à plusieurs personnes. Les destinataires ayant coupé
 * l'événement `supportRequest` ne reçoivent ni email ni push, mais rien n'est
 * écrit non plus en base : la préférence vaut opt-out complet.
 */
export async function notifySupportRequest(params: {
  kind: SupportEmailKind;
  request: NotifiableRequest;
  recipients: ReadonlyArray<Recipient>;
  /** Phrase de contexte affichée dans l'email et le push. */
  message?: string | null;
}): Promise<{ sent: number; failed: number }> {
  const { kind, request, recipients, message } = params;
  if (recipients.length === 0) return { sent: 0, failed: 0 };

  const allowed = await filterRecipientsByPref(recipients, "supportRequest");
  if (allowed.length === 0) return { sent: 0, failed: 0 };

  const href = `/support/${request.id}`;
  const categoryLabel = SUPPORT_CATEGORY_META[request.category].label;
  const priorityLabel = SUPPORT_PRIORITY_META[request.priority].label;
  const statusLabel = SUPPORT_STATUS_META[request.status].label;
  const subject =
    kind === "NEW"
      ? `[${request.reference}] Nouvelle demande — ${request.title}`
      : kind === "OVERDUE"
        ? `[${request.reference}] En retard — ${request.title}`
        : `[${request.reference}] ${statusLabel} — ${request.title}`;

  let sent = 0;
  let failed = 0;

  for (const r of allowed) {
    const result = await sendEmail({
      to: r.email,
      subject,
      react: React.createElement(SupportRequestNotification, {
        kind,
        recipientName: r.name,
        reference: request.reference,
        title: request.title,
        departmentName: request.department.name,
        categoryLabel,
        priorityLabel,
        statusLabel,
        requesterName: request.requester.name,
        assigneeName: request.assignee?.name ?? null,
        message: message ?? null,
        dueLabel: request.dueAt ? dateFmt.format(request.dueAt) : null,
        href,
      }),
    });

    await prisma.notification
      .create({
        data: {
          userId: r.id,
          channel: "EMAIL",
          type: TYPE_BY_KIND[kind],
          subject,
          body: message ?? `${request.reference} — ${request.title}`,
          isSent: result.success,
          sentAt: result.success ? new Date() : null,
        },
      })
      .catch((err) => logger.warn("notification row failed", { userId: r.id, err: String(err) }));

    if (result.success) {
      sent++;
    } else {
      failed++;
      logger.error("support email failed", {
        requestId: request.id,
        userId: r.id,
        reason: result.error,
      });
    }

    await sendPushToUser(r.id, {
      title: `${request.reference} · ${statusLabel}`,
      body: message ? `${request.title} — ${message}` : request.title,
      url: href,
      // Une seule bulle par demande : les changements successifs se remplacent
      // au lieu d'empiler cinq notifications pour le même ticket.
      tag: `support-request:${request.id}`,
    });
  }

  return { sent, failed };
}
