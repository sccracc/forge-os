"use client";

import { useEffect, useState } from "react";
import { Wifi, WifiOff } from "lucide-react";

/** #62 · transient online/offline pill driven by real connectivity events. */
export function ConnectionStatus() {
  const [state, setState] = useState<null | "off" | "on">(null);

  useEffect(() => {
    let hide: ReturnType<typeof setTimeout> | null = null;
    const goOff = () => {
      if (hide) clearTimeout(hide);
      setState("off");
    };
    const goOn = () => {
      setState((prev) => (prev === "off" ? "on" : prev));
      hide = setTimeout(() => setState(null), 2400);
    };
    window.addEventListener("offline", goOff);
    window.addEventListener("online", goOn);
    return () => {
      window.removeEventListener("offline", goOff);
      window.removeEventListener("online", goOn);
      if (hide) clearTimeout(hide);
    };
  }, []);

  if (!state) return null;
  return (
    <div className={`conn-pill ${state}`} role="status">
      <span className="cdot2" />
      {state === "on" ? (
        <>
          <Wifi size={13} /> Back online
        </>
      ) : (
        <>
          <WifiOff size={13} /> You&apos;re offline — reconnecting…
        </>
      )}
    </div>
  );
}
