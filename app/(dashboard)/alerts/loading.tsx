import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div>
      <div className="mb-4">
        <Skeleton className="h-6 w-32 mb-2" />
        <Skeleton className="h-3 w-56" />
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="flex gap-0.5 bg-white rounded-lg border border-border-soft p-0.5">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-9 w-20" />
          ))}
        </div>
        <Skeleton className="h-9 w-40" />
      </div>

      {/* Alert cards */}
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="bg-white rounded-[10px] border border-border-soft p-3">
            <div className="flex items-start gap-3">
              <Skeleton className="h-[26px] w-[26px] rounded-[7px]" />
              <div className="flex-1 min-w-0">
                <Skeleton className="h-3 w-3/4 mb-2" />
                <Skeleton className="h-2 w-1/2 mb-2" />
                <Skeleton className="h-2 w-1/3" />
              </div>
              <Skeleton className="h-7 w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
