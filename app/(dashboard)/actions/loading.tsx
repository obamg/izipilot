export default function ActionsLoading() {
  return (
    <div>
      <div className="mb-4">
        <div className="h-6 w-32 bg-izi-gray-lt rounded animate-pulse" />
        <div className="h-3 w-48 bg-izi-gray-lt rounded animate-pulse mt-2" />
      </div>
      <div className="flex gap-2 mb-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-8 w-32 bg-izi-gray-lt rounded-[7px] animate-pulse" />
        ))}
      </div>
      <div className="bg-white rounded-[10px] border border-[#deeaea] p-4 space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex gap-3 items-center">
            <div className="h-4 flex-1 bg-izi-gray-lt rounded animate-pulse" />
            <div className="h-4 w-16 bg-izi-gray-lt rounded animate-pulse" />
            <div className="h-4 w-16 bg-izi-gray-lt rounded animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
