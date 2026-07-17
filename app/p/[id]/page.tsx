"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { injectStorageShim } from "@/lib/code/sandbox-shim";
import { ForgeMark } from "@/components/icons";

export default function PublishedPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [state, setState] = useState<"loading" | "ok" | "missing">("loading");
  const [html, setHtml] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    fetch(`/api/published/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d: { html?: string; name?: string } | null) => {
        if (d && typeof d.html === "string") {
          setHtml(d.html);
          setName(d.name ?? "");
          setState("ok");
        } else {
          setState("missing");
        }
      })
      .catch(() => setState("missing"));
  }, [id]);

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", zIndex: 5, background: "var(--bg)" }}>
      <div
        className="glass"
        style={{
          height: 46,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 16px",
          border: "none",
          borderBottom: "1px solid var(--glass-border)",
        }}
      >
        <div className="logo-mark" style={{ width: 26, height: 26, borderRadius: 7 }}>
          <ForgeMark style={{ width: 15, height: 15, color: "var(--on-accent)" }} />
        </div>
        <span
          style={{
            fontWeight: 600,
            fontSize: 14,
            minWidth: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {name || "Forge OS"}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-faint)", flexShrink: 0 }}>
          Published with Forge OS
        </span>
      </div>
      {/* Container follows the app theme (loading/missing states); the iframe
          itself stays white so published pages that assume a light default
          body remain readable regardless of the viewer's theme. */}
      <div style={{ flex: 1, minHeight: 0, background: "var(--bg)" }}>
        {state === "loading" && (
          <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--text-faint)" }}>
            Loading…
          </div>
        )}
        {state === "missing" && (
          <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--text-dim)", padding: 24, textAlign: "center" }}>
            This published project doesn&apos;t exist or was unpublished.
          </div>
        )}
        {state === "ok" && (
          <iframe
            title={name}
            srcDoc={injectStorageShim(html)}
            sandbox="allow-scripts allow-modals allow-forms allow-popups allow-pointer-lock"
            style={{ width: "100%", height: "100%", border: "none", background: "#fff" }}
          />
        )}
      </div>
    </div>
  );
}
