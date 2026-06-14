// Lightweight confetti burst via the Web Animations API — no deps, self-cleaning.
// Used for celebratory moments (e.g. publishing a project). #25

export function burstConfetti(originX?: number, originY?: number) {
  if (typeof document === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const wrap = document.createElement("div");
  wrap.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:9998;overflow:hidden";
  const cx = originX ?? window.innerWidth / 2;
  const cy = originY ?? window.innerHeight / 3;
  const colors = ["#e8620e", "#ff8a3d", "#2f9e44", "#1c7ed6", "#f2c037", "#e64980"];

  for (let i = 0; i < 90; i++) {
    const p = document.createElement("i");
    const ang = Math.random() * Math.PI * 2;
    const dist = 90 + Math.random() * 240;
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist - 80;
    const size = 6 + Math.random() * 6;
    p.style.cssText = `position:absolute;left:${cx}px;top:${cy}px;width:${size}px;height:${size}px;border-radius:${
      Math.random() > 0.5 ? "50%" : "2px"
    };background:${colors[i % colors.length]};`;
    p.animate(
      [
        { transform: "translate(0,0) rotate(0)", opacity: 1 },
        {
          transform: `translate(${dx}px,${dy}px) rotate(${Math.random() * 720 - 360}deg)`,
          opacity: 0,
        },
      ],
      { duration: 900 + Math.random() * 500, easing: "cubic-bezier(.2,.6,.3,1)", fill: "forwards" }
    );
    wrap.appendChild(p);
  }

  document.body.appendChild(wrap);
  setTimeout(() => wrap.remove(), 1600);
}
