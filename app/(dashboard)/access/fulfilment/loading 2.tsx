import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div>
      <div className="mb-4">
        <Skeleton className="h-6 w-32 mb-2" />
        <Skeleton className="h-3 w-48" />
      </div>
      <div className="mb-3 flex gap-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-9 w-24" />
        ))}
      </div>
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-[10px] border border-border-soft bg-white p-4">
            <Skeleton className="h-4 w-1/2 mb-2" />
            <Skeleton className="h-3 w-1/3 mb-3" />
            <Skeleton className="h-3 w-3/4 mb-2" />
            <Skeleton className="h-9 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}
