import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3">
        <div>
          <Skeleton className="h-6 w-48 mb-2" />
          <Skeleton className="h-3 w-72" />
        </div>
        <Skeleton className="h-9 w-44" />
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {[1, 2, 3, 4].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>

      {/* Main grid: OKRs left, alerts right */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-[10px] border border-border-soft p-4">
          <Skeleton className="h-4 w-32 mb-3" />
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-3 py-2">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-3 w-3/4 mb-1.5" />
                  <Skeleton className="h-2 w-1/2" />
                </div>
                <Skeleton className="h-3 w-12" />
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-[10px] border border-border-soft p-4">
          <Skeleton className="h-4 w-24 mb-3" />
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-start gap-2 py-1.5">
                <Skeleton className="h-6 w-6 rounded-[7px]" />
                <div className="flex-1">
                  <Skeleton className="h-3 w-full mb-1" />
                  <Skeleton className="h-2 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
