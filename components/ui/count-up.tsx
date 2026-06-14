"use client";

import { useEffect, useRef, useState } from "react";

/** Eased count-up number (#12 diff totals, #24 stats). */
export function CountUp({
  to,
  durationMs = 1100,
  prefix = "",
  suffix = "",
  compact = false,
}: {
  to: number;
  durationMs?: number;
  prefix?: string;
  suffix?: string;
  compact?: boolean;
}) {
  const [val, setVal] = useState(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(to * eased);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [to, durationMs]);

  const fmt = (v: number) => {
    if (compact) {
      if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
      if (v >= 1e3) return Math.round(v / 1e3) + "K";
    }
    return Math.round(v).toLocaleString();
  };

  return (
    <>
      {prefix}
      {fmt(val)}
      {suffix}
    </>
  );
}
