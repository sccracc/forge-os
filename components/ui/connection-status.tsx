"use client";

import { useEffect, useState } from "react";
import { Wifi, WifiOff } from "lucide-react";

/** #62 · transient online/offline pill driven by real connectivity events.
 *  Family 29 "Reconnect story": on offline→online the pill holds a `.reconnect`
 *  phase (~1.4s — dot pops green with a ripple, text crossfades to "Back
 *  online", capsule re-morphs) before the existing hide path runs. */
export function ConnectionStatus() {
  const [state, setState] = useState<null | "off" | "on">(null);
  // animation phase: the pill plays connPillOut (.hide) before unmounting
  const [hiding, setHiding] = useState(false);
  // presentational reconnect beat; held from the heal until unmount
  const [reconnect, setReconnect] = useState(false);

  useEffect(() => {
    let hide: ReturnType<typeof setTimeout> | null = null;
    let wasOff = false;
    const goOff = () => {
      if (hide) clearTimeout(hide);
      wasOff = true;
      setHiding(false);
      setReconnect(false);
      setState("off");
    };
    const goOn = () => {
      if (!wasOff) return;
      wasOff = false;
      setReconnect(true);
      setState("on");
      // hold the reconnect story ~1.4s, then start the normal hide path
      hide = setTimeout(() => setHiding(true), 1400);
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
    <div
      className={`conn-pill ${state}${reconnect ? " reconnect" : ""}${hiding ? " hide" : ""}`}
      role="status"
      onAnimationEnd={(e) => {
        if (e.animationName === "connPillOut") {
          setHiding(false);
          setReconnect(false);
          setState(null);
        }
      }}
    >
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
