"use client";

// Client-side PDF parsing with pdf.js. Text PDFs are extracted to plain text
// (free, ungated); scanned PDFs (no text layer) are rasterized to page images
// so the server can OCR/analyze them through the vision model (counted as a
// gated document). pdf.js is imported lazily so it never runs during SSR and is
// only downloaded when the user actually attaches a PDF.

import type { ImageMimeType } from "@/lib/data/types";

export interface ParsedPdf {
  text: string;
  pageCount: number;
  /** True when the PDF has a real text layer (extractable without OCR). */
  hasTextLayer: boolean;
}

export interface RenderedPage {
  base64: string;
  mimeType: ImageMimeType;
}

/** Min non-whitespace chars per page to consider a PDF "text", not scanned. */
const MIN_CHARS_PER_PAGE = 16;
/** Cap rasterized pages so a huge scanned PDF can't balloon the request. */
const MAX_RASTER_PAGES = 10;

async function getPdfjs() {
  // Legacy build + lazy import keeps it out of the server bundle.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  return pdfjs;
}

export async function parsePdf(file: File): Promise<ParsedPdf> {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  try {
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => (typeof item === "object" && item && "str" in item ? (item as { str: string }).str : ""))
        .join(" ");
      text += pageText + "\n\n";
    }
    text = text.replace(/[ \t]+\n/g, "\n").trim();
    const dense = text.replace(/\s/g, "").length;
    const hasTextLayer = dense >= pdf.numPages * MIN_CHARS_PER_PAGE;
    return { text, pageCount: pdf.numPages, hasTextLayer };
  } finally {
    await (pdf as unknown as { destroy(): Promise<void> }).destroy();
  }
}

/** Render the first pages of a (scanned) PDF to PNGs for AI analysis. */
export async function rasterizePdf(
  file: File,
  maxPages = MAX_RASTER_PAGES
): Promise<RenderedPage[]> {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  try {
    const pages: RenderedPage[] = [];
    const count = Math.min(pdf.numPages, maxPages);
    for (let i = 1; i <= count; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      const dataUrl = canvas.toDataURL("image/png");
      const comma = dataUrl.indexOf(",");
      if (comma >= 0) pages.push({ base64: dataUrl.slice(comma + 1), mimeType: "image/png" });
    }
    return pages;
  } finally {
    await (pdf as unknown as { destroy(): Promise<void> }).destroy();
  }
}
