"use client";

import { assembleWeb, bundleApp } from "@/lib/code/preview";
import { injectReporterShim, smokeData } from "./reporter-shim";
import type { ProbeError, DomSummary, SmokeResult } from "./types";
import type { SmokeTest } from "./checklist";
import type { FileDoc } from "@/lib/data/types";

export interface ProbeResult {
  errors: ProbeError[];
  dom: DomSummary | null;
  smoke: SmokeResult[];
}

/**
 * Actually run the project in a hidden, sandboxed (opaque-origin) iframe and
 * collect runtime errors + a DOM summary + smoke-test results via the reporter
 * shim's postMessage.
 */
export async function runtimeProbe(
  files: FileDoc[],
  mode: "web" | "react" | "vue",
  smoke: SmokeTest[] = []
): Promise<ProbeResult> {
  if (typeof document === "undefined") return { errors: [], dom: null, smoke: [] };

  let doc =
    mode === "web" ? assembleWeb(files, undefined, false) : await bundleApp(files, mode);
  doc = injectReporterShim(doc, smokeData(smoke));

  return new Promise<ProbeResult>((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-modals");
    iframe.style.cssText =
      "position:fixed;left:-9999px;top:-9999px;width:1024px;height:768px;border:0;visibility:hidden;pointer-events:none;";

    let done = false;
    let latest: ProbeResult = { errors: [], dom: null, smoke: [] };

    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMsg);
      clearTimeout(timer);
      try {
        iframe.remove();
      } catch {
        /* already gone */
      }
      resolve(latest);
    };

    const onMsg = (e: MessageEvent) => {
      const d = e.data as
        | { __forgeVerify?: boolean; phase?: string; errors?: ProbeError[]; dom?: DomSummary; smoke?: SmokeResult[] }
        | null;
      if (!d || d.__forgeVerify !== true) return;
      if (e.source && iframe.contentWindow && e.source !== iframe.contentWindow) return;
      latest = { errors: d.errors ?? [], dom: d.dom ?? null, smoke: d.smoke ?? [] };
      if (d.phase === "final") finish();
    };

    const timer = setTimeout(finish, 4000);
    window.addEventListener("message", onMsg);
    iframe.srcdoc = doc;
    document.body.appendChild(iframe);
  });
}
