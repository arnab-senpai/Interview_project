import React, { useEffect, useRef } from "react";

interface AmbientNebulaMistProps {
  theme: "light" | "dark";
}

export const AmbientNebulaMist: React.FC<AmbientNebulaMistProps> = ({ theme }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const particles = Array.from({ length: 58 }, (_, i) => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.16,
      vy: (Math.random() - 0.5) * 0.14 - 0.04,
      r: 0.7 + (i % 3) * 0.55,
      color:
        i % 3 === 0 ? "56, 189, 248" : i % 3 === 1 ? "129, 140, 248" : "192, 132, 252",
      phase: Math.random() * Math.PI * 2,
    }));

    let rafId = 0;
    const tick = (now: number) => {
      rafId = requestAnimationFrame(tick);
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);

      const t = now * 0.001;
      for (const p of particles) {
        p.x = (p.x + p.vx + w) % w;
        p.y = (p.y + p.vy + h) % h;
        const twinkle = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(t * 1.4 + p.phase));
        const alpha = theme === "dark" ? twinkle * 0.55 : twinkle * 0.25;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color}, ${alpha.toFixed(3)})`;
        ctx.fill();
      }
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, [theme]);

  return (
    <div className="nebula-backdrop" aria-hidden="true">
      <div className="nebula-glow nebula-glow-a" />
      <div className="nebula-glow nebula-glow-b" />
      <canvas ref={canvasRef} className="nebula-starfield" />
    </div>
  );
};
