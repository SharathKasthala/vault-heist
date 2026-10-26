import { useEffect, useRef } from 'react';

const COLORS = ['#f3d47a', '#d4af37', '#fff4cf', '#f59e0b', '#72e6a1', '#ffffff'];
const GRAVITY = 0.22;

// Two styles. "full" is the normal celebration; "gentle" is used when the
// device asks for reduced motion: no bursts, slower fall and little spin.
// Both now cover the whole screen and keep raining for several seconds.
const MODES = {
  full: {
    duration: 9000, // total time on screen (ms)
    rainFor: 6000, // how long new pieces keep falling from the top (ms)
    rainPerSecond: 70,
    startFill: 0, // pieces scattered over the screen at the start
    maxFall: 5.5,
    spin: 1,
    flip: 0.12,
    cannons: true,
  },
  gentle: {
    duration: 10000,
    rainFor: 7000,
    rainPerSecond: 28,
    startFill: 70,
    maxFall: 2.4,
    spin: 0.2,
    flip: 0.04,
    cannons: false,
  },
};

function createParticle(x, y, angle, speed, mode) {
  return {
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    size: 6 + Math.random() * 7,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    rotation: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 0.3 * mode.spin,
    wobble: Math.random() * Math.PI * 2,
    round: Math.random() < 0.3,
  };
}

export default function Confetti({ delay = 0 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const gentle = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const mode = gentle ? MODES.gentle : MODES.full;

    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!context) return undefined;

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
    let particles = [];
    let frameId = 0;
    let startTime = null;
    let lastTime = null;
    let rainDebt = 0;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * pixelRatio;
      canvas.height = height * pixelRatio;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    const cannon = (x, y, direction) => {
      for (let i = 0; i < 110; i += 1) {
        const angle = direction + (Math.random() - 0.5) * 0.8;
        const speed = 10 + Math.random() * 12;
        particles.push(createParticle(x, y, angle, speed, mode));
      }
    };

    const dropFromTop = (count) => {
      for (let i = 0; i < count; i += 1) {
        const x = Math.random() * width;
        const y = -20 - Math.random() * 60;
        particles.push(createParticle(x, y, Math.PI / 2, 1 + Math.random() * 2, mode));
      }
    };

    // Scatter pieces over the whole screen so it is full straight away.
    const fillScreen = (count) => {
      for (let i = 0; i < count; i += 1) {
        const particle = createParticle(Math.random() * width, Math.random() * height, Math.PI / 2, 0.5 + Math.random(), mode);
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
        lastTime = time;
        if (mode.cannons) {
          cannon(0, height * 0.85, -Math.PI / 3);
          cannon(width, height * 0.85, (-2 * Math.PI) / 3);
        }
        fillScreen(mode.startFill);
      }

      const elapsed = time - startTime;
      const frameMs = Math.min(time - lastTime, 50);
      lastTime = time;

      // Keep raining from the top for a while, spread evenly over time.
      if (elapsed < mode.rainFor) {
        rainDebt += (mode.rainPerSecond * frameMs) / 1000;
        const count = Math.floor(rainDebt);
        rainDebt -= count;
        dropFromTop(count);
      }

      context.clearRect(0, 0, width, height);
      context.globalAlpha = elapsed > mode.duration - 1000 ? Math.max(0, (mode.duration - elapsed) / 1000) : 1;

      particles.forEach((particle) => {
        particle.vx *= 0.985;
        particle.vy = Math.min(particle.vy * 0.985 + GRAVITY, mode.maxFall);
        particle.wobble += mode.flip;
        particle.x += particle.vx + Math.sin(particle.wobble) * 0.7;
        particle.y += particle.vy;
        particle.rotation += particle.spin;
        draw(particle);
      });

      particles = particles.filter((particle) => particle.y < height + 40);

      if (elapsed < mode.duration) {
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
  }, [delay]);

  return <canvas ref={canvasRef} className="confetti-canvas" aria-hidden="true" />;
}