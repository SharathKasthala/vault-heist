import { useEffect, useRef } from 'react';

const COLORS = ['#f3d47a', '#d4af37', '#fff4cf', '#f59e0b', '#72e6a1', '#ffffff'];
const GRAVITY = 0.22;
const MAX_FALL_SPEED = 5.5;

function createParticle(x, y, angle, speed) {
  return {
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    size: 6 + Math.random() * 6,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    rotation: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 0.3,
    wobble: Math.random() * Math.PI * 2,
    round: Math.random() < 0.3,
  };
}

// Canvas confetti: two side cannons, then a shower from the top.
// Skipped entirely when the player prefers reduced motion.
export default function Confetti({ delay = 0, duration = 4800 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;

    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!context) return undefined;

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
    let particles = [];
    let frameId = 0;
    let startTime = null;
    let showerLaunched = false;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * pixelRatio;
      canvas.height = height * pixelRatio;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    const cannon = (x, y, direction) => {
      for (let i = 0; i < 90; i += 1) {
        const angle = direction + (Math.random() - 0.5) * 0.7;
        const speed = 9 + Math.random() * 9;
        particles.push(createParticle(x, y, angle, speed));
      }
    };

    const shower = () => {
      for (let i = 0; i < 80; i += 1) {
        const particle = createParticle(Math.random() * width, -20 - Math.random() * 120, Math.PI / 2, 1 + Math.random() * 3);
        particles.push(particle);
      }
    };

    const draw = (particle) => {
      context.save();
      context.translate(particle.x, particle.y);
      context.rotate(particle.rotation);
      context.fillStyle = particle.color;

      if (particle.round) {
        context.beginPath();
        context.arc(0, 0, particle.size / 2.6, 0, Math.PI * 2);
        context.fill();
      } else {
        // Squashing the height makes the paper look like it is flipping.
        const flip = 0.35 + 0.65 * Math.abs(Math.sin(particle.wobble));
        context.fillRect(-particle.size / 2, (-particle.size / 4) * flip, particle.size, (particle.size / 2) * flip);
      }

      context.restore();
    };

    const tick = (time) => {
      if (startTime === null) {
        startTime = time;
        cannon(0, height * 0.8, -Math.PI / 3);
        cannon(width, height * 0.8, (-2 * Math.PI) / 3);
      }

      const elapsed = time - startTime;

      if (!showerLaunched && elapsed > 650) {
        showerLaunched = true;
        shower();
      }

      context.clearRect(0, 0, width, height);
      context.globalAlpha = elapsed > duration - 900 ? Math.max(0, (duration - elapsed) / 900) : 1;

      particles.forEach((particle) => {
        particle.vx *= 0.985;
        particle.vy = Math.min(particle.vy * 0.985 + GRAVITY, MAX_FALL_SPEED);
        particle.wobble += 0.12;
        particle.x += particle.vx + Math.sin(particle.wobble) * 0.7;
        particle.y += particle.vy;
        particle.rotation += particle.spin;
        draw(particle);
      });

      particles = particles.filter((particle) => particle.y < height + 40);

      if (elapsed < duration && particles.length > 0) {
        frameId = requestAnimationFrame(tick);
      } else {
        context.clearRect(0, 0, width, height);
      }
    };

    resize();
    window.addEventListener('resize', resize);
    const delayId = setTimeout(() => {
      frameId = requestAnimationFrame(tick);
    }, delay);

    return () => {
      clearTimeout(delayId);
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', resize);
    };
  }, [delay, duration]);

  return <canvas ref={canvasRef} className="confetti-canvas" aria-hidden="true" />;
}
