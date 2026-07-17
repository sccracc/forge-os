"use client";

import { useEffect, useState } from "react";

/**
 * Viewport classification for layout switching. Returns `null` before the
 * first client measurement (callers can hold rendering to avoid mounting a
 * heavy desktop layout on a phone), then a live boolean that tracks resizes.
 * 860px matches the app shell's mobile-drawer breakpoint.
 */
export function useIsMobile(maxWidth = 860): boolean | null {
  const [mobile, setMobile] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [maxWidth]);
  return mobile;
}
