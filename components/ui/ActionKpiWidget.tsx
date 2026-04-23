interface ActionKpiWidgetProps {
  todo: number;
  inProgress: number;
  blocked: number;
  done: number;
  total: number;
}

export function ActionKpiWidget({ todo, inProgress, blocked, done, total }: ActionKpiWidgetProps) {
  const donePercent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="rounded-[10px] border border-[#deeaea] bg-white px-4 py-[14px]">
      <div className="text-[10px] text-izi-gray font-medium uppercase tracking-wide mb-1">
        Actions
      </div>
      <div className="text-[24px] font-mono font-bold text-dark leading-none">
        {done}<span className="text-[14px] text-izi-gray font-normal">/{total}</span>
      </div>
      <div className="text-[10px] text-izi-gray mt-0.5">{donePercent}% terminées</div>

      {/* Mini breakdown */}
      <div className="flex gap-3 mt-2 text-[10px]">
        <span style={{ color: "var(--gray)" }}>{todo} à faire</span>
        <span style={{ color: "#185FA5" }}>{inProgress} en cours</span>
        {blocked > 0 && (
          <span style={{ color: "var(--red)" }}>{blocked} bloquées</span>
        )}
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="h-[4px] rounded-full bg-gray-lt mt-2 overflow-hidden flex">
          <div
            className="h-full rounded-full"
            style={{ width: `${(done / total) * 100}%`, backgroundColor: "var(--green)" }}
          />
          <div
            className="h-full"
            style={{ width: `${(inProgress / total) * 100}%`, backgroundColor: "#185FA5" }}
          />
          <div
            className="h-full"
            style={{ width: `${(blocked / total) * 100}%`, backgroundColor: "var(--red)" }}
          />
        </div>
      )}
    </div>
  );
}
