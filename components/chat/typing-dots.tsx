/** Three-dot "preparing a response" indicator (inherits text color). */
export function TypingDots() {
  return (
    <span className="typing-dots" aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}
