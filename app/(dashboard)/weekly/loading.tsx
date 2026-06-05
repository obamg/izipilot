import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3">
        <div>
          <Skeleton className="h-6 w-40 mb-2" />
          <Skeleton className="h-3 w-60" />
        </div>
        <Skeleton className="h-9 w-44" />
      </div>

      {/* Two entity cards, each with a couple of KR cards */}
      {[1, 2].map((entity) => (
        <div
          key={entity}
          className="bg-white rounded-[10px] border border-border-soft p-4 mb-3"
        >
          <Skeleton className="h-3 w-44 mb-3" />
          <div className="rounded-[10px] border border-teal-md bg-teal-lt/40 overflow-hidden">
            <div className="bg-teal-lt border-b border-teal-md px-4 py-2.5">
              <Skeleton className="h-2 w-16 mb-1" />
              <Skeleton className="h-4 w-3/4" />
            </div>
            <div className="p-3 space-y-3">
              {[1, 2].map((kr) => (
                <div
                  key={kr}
                  className="rounded-[10px] border border-border-soft overflow-hidden bg-white"
                >
                  <div className="px-4 py-3 flex items-center gap-3 bg-izi-gray-lt/30">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="flex-1">
                      <Skeleton className="h-3 w-2/3 mb-1.5" />
                      <Skeleton className="h-2 w-1/3" />
                    </div>
                    <Skeleton className="h-5 w-20" />
                  </div>
                  <div className="px-4 py-3 space-y-3">
                    <Skeleton className="h-8 w-full" />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Skeleton className="h-10" />
                      <Skeleton className="h-10" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
