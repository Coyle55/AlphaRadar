// src/components/RadarSweep.tsx
export function RadarSweep({ size = 120 }: { size?: number }) {
  const ringInset = Math.round(size * 0.15);

  return (
    <div
      className="relative shrink-0 rounded-full border border-amber/30"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <div
        className="absolute rounded-full border border-amber/10"
        style={{ inset: ringInset }}
      />
      <div
        className="absolute inset-0 origin-center"
        style={{ animation: "radar-sweep 4s linear infinite" }}
      >
        <div
          className="absolute left-1/2 top-1/2 h-1/2 w-px origin-top bg-gradient-to-b from-amber to-transparent"
          style={{ transform: "translateX(-50%)" }}
        />
      </div>
      <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber" />
    </div>
  );
}
