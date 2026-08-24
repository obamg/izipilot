import type {
  SupportRequestCategory,
  SupportRequestPriority,
  SupportRequestStatus,
} from "@prisma/client";
import {
  SUPPORT_CATEGORY_META,
  SUPPORT_PRIORITY_META,
  SUPPORT_STATUS_META,
} from "@/lib/support-request";

const pill =
  "inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap";

export function StatusPill({ status }: { status: SupportRequestStatus }) {
  const meta = SUPPORT_STATUS_META[status];
  return (
    <span className={pill} style={{ color: meta.color, backgroundColor: meta.bg }}>
      {meta.label}
    </span>
  );
}

export function PriorityPill({ priority }: { priority: SupportRequestPriority }) {
  const meta = SUPPORT_PRIORITY_META[priority];
  return (
    <span className={pill} style={{ color: meta.color, backgroundColor: meta.bg }}>
      {meta.label}
    </span>
  );
}

export function CategoryPill({ category }: { category: SupportRequestCategory }) {
  return (
    <span className={`${pill} bg-gray-lt text-izi-gray`}>
      {SUPPORT_CATEGORY_META[category].label}
    </span>
  );
}

/** Marqueur de retard — rouge, jamais décoratif (design system IziPilot). */
export function OverduePill() {
  return (
    <span className={pill} style={{ color: "var(--red)", backgroundColor: "var(--red-lt)" }}>
      En retard
    </span>
  );
}
