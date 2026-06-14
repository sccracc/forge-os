import type { SVGProps } from "react";

/** Forge brand mark — anvil silhouette with an ember spark. */
export function ForgeMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M3 14l5-9 4 5 3-4 6 12H3z" fill="currentColor" />
      <circle cx="18" cy="5" r="2" fill="currentColor" />
    </svg>
  );
}

/** Spark glyph — used for the assistant avatar and the thinking panel. */
export function SparkGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      {...props}
    >
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3" />
    </svg>
  );
}

/** Filled spark used inside the amber AI avatar tile. */
export function SparkFilled(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M3 14l5-9 4 5 3-4 6 12H3z" fill="currentColor" />
    </svg>
  );
}
