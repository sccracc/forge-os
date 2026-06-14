"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { FileStore } from "@/lib/files/filestore";
import type { FileDoc } from "@/lib/data/types";

export function BinaryViewer({ file }: { file: FileDoc }) {
  const { user } = useAuth();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoke: string | null = null;
    // Inline SVG content can render directly.
    if (file.category === "image" && file.content && file.name.endsWith(".svg")) {
      const u = URL.createObjectURL(new Blob([file.content], { type: "image/svg+xml" }));
      revoke = u;
      setUrl(u);
    } else if (user && (file.storagePath || file.chunked)) {
      FileStore.getUrl(user.uid, file.id, { storagePath: file.storagePath, chunked: file.chunked }, file.mime).then(
        (u) => {
          if (u) {
            setUrl(u);
            if (u.startsWith("blob:")) revoke = u;
          }
        }
      );
    }
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [file, user]);

  return (
    <div className="binary-viewer">
      {file.category === "image" && url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={file.name} className="bv-image" />
      ) : file.category === "pdf" && url ? (
        <iframe src={url} title={file.name} className="bv-pdf" />
      ) : (
        <div className="bv-fallback">
          <p>{file.name}</p>
          {url ? (
            <a className="btn-ghost" href={url} download={file.name}>
              <Download size={14} /> Download
            </a>
          ) : (
            <p style={{ color: "var(--text-faint)", fontSize: 13 }}>
              Preview not available for this file type.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
