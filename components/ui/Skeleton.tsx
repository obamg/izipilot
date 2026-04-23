interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-izi-gray-lt ${className}`}
    />
  );
}

export function SkeletonCard({ className = "" }: SkeletonProps) {
  return (
    <div className={`bg-white rounded-[10px] border border-[#deeaea] p-4 ${className}`}>
      <Skeleton className="h-3 w-24 mb-2" />
      <Skeleton className="h-7 w-16 mb-1" />
      <Skeleton className="h-2.5 w-20" />
    </div>
  );
}

export function SkeletonRow({ className = "" }: SkeletonProps) {
  return (
    <div className={`flex items-center gap-3 py-2 ${className}`}>
      <Skeleton className="h-3 w-3 rounded-full" />
      <Skeleton className="h-3 flex-1" />
      <Skeleton className="h-3 w-10" />
    </div>
  );
}
