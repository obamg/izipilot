import type {
  SupportRequest,
  SupportRequestAttachment,
  SupportRequestCategory,
  SupportRequestComment,
  SupportRequestPriority,
  SupportRequestStatus,
} from "@prisma/client";
import { isOverdue } from "./support-request";

export interface SerializedSupportRequest {
  id: string;
  reference: string;
  title: string;
  description: string;
  category: SupportRequestCategory;
  priority: SupportRequestPriority;
  status: SupportRequestStatus;
  requester: { id: string; name: string };
  assignee: { id: string; name: string } | null;
  /** Personne visée par le demandeur au dépôt (trace, même après réassignation). */
  requestedAssignee: { id: string; name: string } | null;
  department: { id: string; code: string; name: string; color: string };
  task: { id: string; title: string } | null;
  dueAt: string | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  resolutionNote: string | null;
  isOverdue: boolean;
  commentCount: number;
  attachmentCount: number;
  createdAt: string;
  updatedAt: string;
}

type RequestWithRelations = SupportRequest & {
  requester: { id: string; name: string };
  assignee: { id: string; name: string } | null;
  /** Personne visée par le demandeur au dépôt (trace, même après réassignation). */
  requestedAssignee: { id: string; name: string } | null;
  department: { id: string; code: string; name: string; color: string };
  task: { id: string; title: string } | null;
  _count?: { comments: number; attachments: number };
};

export function serializeSupportRequest(
  r: RequestWithRelations,
  now: Date = new Date()
): SerializedSupportRequest {
  return {
    id: r.id,
    reference: r.reference,
    title: r.title,
    description: r.description,
    category: r.category,
    priority: r.priority,
    status: r.status,
    requester: { id: r.requester.id, name: r.requester.name },
    assignee: r.assignee ? { id: r.assignee.id, name: r.assignee.name } : null,
    requestedAssignee: r.requestedAssignee
      ? { id: r.requestedAssignee.id, name: r.requestedAssignee.name }
      : null,
    department: r.department,
    task: r.task ? { id: r.task.id, title: r.task.title } : null,
    dueAt: r.dueAt?.toISOString() ?? null,
    firstResponseAt: r.firstResponseAt?.toISOString() ?? null,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    closedAt: r.closedAt?.toISOString() ?? null,
    resolutionNote: r.resolutionNote,
    isOverdue: isOverdue(r, now),
    commentCount: r._count?.comments ?? 0,
    attachmentCount: r._count?.attachments ?? 0,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export interface SerializedSupportComment {
  id: string;
  content: string;
  isInternal: boolean;
  author: { id: string; name: string };
  createdAt: string;
}

export function serializeSupportComment(
  c: SupportRequestComment & { author: { id: string; name: string } }
): SerializedSupportComment {
  return {
    id: c.id,
    content: c.content,
    isInternal: c.isInternal,
    author: { id: c.author.id, name: c.author.name },
    createdAt: c.createdAt.toISOString(),
  };
}

export interface SerializedSupportAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedBy: { id: string; name: string };
  createdAt: string;
  /** URL de téléchargement — la route vérifie l'accès à la demande. */
  href: string;
}

export function serializeSupportAttachment(
  a: SupportRequestAttachment & { uploadedBy: { id: string; name: string } }
): SerializedSupportAttachment {
  return {
    id: a.id,
    filename: a.filename,
    mimeType: a.mimeType,
    size: a.size,
    uploadedBy: { id: a.uploadedBy.id, name: a.uploadedBy.name },
    createdAt: a.createdAt.toISOString(),
    href: `/api/support-requests/attachments/${a.id}`,
  };
}
