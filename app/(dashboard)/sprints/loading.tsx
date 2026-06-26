export default function SprintsLoading() {
  return (
    <div>
      <div className="mb-6">
        <div className="h-6 w-32 bg-izi-gray-lt rounded animate-pulse" />
        <div className="h-3 w-64 bg-izi-gray-lt rounded animate-pulse mt-2" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        {[1, 2].map((i) => (
          <div key={i} className="h-40 bg-izi-gray-lt rounded-[12px] animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 bg-izi-gray-lt rounded-[10px] animate-pulse" />
        ))}
      </div>
    </div>
  );
}
