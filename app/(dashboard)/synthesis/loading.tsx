import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div>
      <div className="mb-4">
        <Skeleton className="h-6 w-40 mb-2" />
        <Skeleton className="h-3 w-64" />
      </div>

      {/* Desktop grid */}
      <div className="hidden md:block bg-white rounded-[10px] border border-border-soft overflow-hidden">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className="grid grid-cols-12 gap-3 px-4 py-3 border-b border-border-soft last:border-b-0 items-center"
          >
            <Skeleton className="col-span-3 h-3" />
            <Skeleton className="col-span-2 h-3" />
            <div className="col-span-7 grid grid-cols-3 gap-2">
              {[1, 2, 3].map((j) => (
                <Skeleton key={j} className="h-8" />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white rounded-[10px] border border-border-soft p-3">
            <Skeleton className="h-3 w-32 mb-2" />
            <Skeleton className="h-2 w-48 mb-3" />
            <div className="flex gap-2">
              {[1, 2, 3].map((j) => (
                <Skeleton key={j} className="h-8 flex-1" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
