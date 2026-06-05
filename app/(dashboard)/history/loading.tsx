import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div>
      <div className="mb-4">
        <Skeleton className="h-6 w-44 mb-2" />
        <Skeleton className="h-3 w-72" />
      </div>

      {/* Entity selector */}
      <div className="bg-white rounded-[10px] border border-border-soft p-4 mb-3">
        <Skeleton className="h-2 w-32 mb-3" />
        <div className="flex flex-wrap gap-1.5">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <Skeleton key={i} className="h-9 w-32" />
          ))}
        </div>
      </div>

      {/* Chart area */}
      <div className="bg-white rounded-[10px] border border-border-soft p-4">
        <Skeleton className="h-4 w-48 mb-3" />
        <Skeleton className="h-[280px] w-full" />
      </div>
    </div>
  );
}
