export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-3 border-teal border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-izi-gray">Chargement de la revue...</span>
      </div>
    </div>
  );
}
