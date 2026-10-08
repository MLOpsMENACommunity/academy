export function Progress({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="font-semibold text-fg">{label}</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={v}
        className="h-2 overflow-hidden rounded-full bg-muted-bg"
      >
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}
