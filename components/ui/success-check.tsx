/** #20 · self-drawing success checkmark (SVG stroke animation). */
export function SuccessCheck({ size = 56 }: { size?: number }) {
  return (
    <svg className="success-draw" width={size} height={size} viewBox="0 0 52 52" aria-hidden>
      <circle cx="26" cy="26" r="24" />
      <path d="M14 27l8 8 16-18" />
    </svg>
  );
}
