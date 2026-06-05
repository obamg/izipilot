import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div>
      <div className="mb-4">
        <Skeleton className="h-6 w-40 mb-2" />
        <Skeleton className="h-3 w-64" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 mb-3">
        <Skeleton className="h-9 w-52" />
        <Skeleton className="h-9 w-36" />
        <Skeleton className="h-9 w-40 ml-auto" />
      </div>

      {/* Table-ish list */}
      <div className="bg-white rounded-[10px] border border-border-soft overflow-hidden">
        <div className="hidden md:block">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="grid grid-cols-12 gap-3 px-3 py-3 border-b border-izi-gray-lt last:border-b-0 items-center"
            >
              <Skeleton className="col-span-3 h-3" />
              <Skeleton className="col-span-4 h-3" />
              <Skeleton className="col-span-2 h-4" />
              <Skeleton className="col-span-1 h-4" />
              <Skeleton className="col-span-2 h-7" />
            </div>
          ))}
        </div>
        <div className="md:hidden divide-y divide-izi-gray-lt">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="p-3">
              <Skeleton className="h-3 w-40 mb-2" />
              <Skeleton className="h-2 w-56 mb-3" />
              <div className="flex gap-2">
                <Skeleton className="h-11 w-24" />
                <Skeleton className="h-11 w-16" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
