import { useEffect, useRef } from 'react';

/** Live microphone level bars. Pure DOM updates per frame, so it never re-renders React. */
export default function LevelMeter({ stream, bars = 32, active = true }) {
  const els = useRef([]);

  useEffect(() => {
    if (!stream || !active) {
      els.current.forEach((el) => el && (el.style.transform = 'scaleY(0.08)'));
      return undefined;
    }
    let raf = 0;
    let ctx;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.75;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const usable = Math.floor(data.length * 0.6); // speech lives in the lower part of the spectrum
      const tick = () => {
        analyser.getByteFrequencyData(data);
        for (let i = 0; i < bars; i++) {
          const v = data[Math.floor((i * usable) / bars)] / 255;
          const el = els.current[i];
          if (el) el.style.transform = `scaleY(${Math.max(0.08, Math.min(1, v * 1.25))})`;
        }
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      /* the meter is cosmetic: recording works without it */
    }
    return () => {
      cancelAnimationFrame(raf);
      ctx?.close().catch(() => {});
    };
  }, [stream, active, bars]);

  return (
    <div className="flex h-14 items-center justify-center gap-[3px]" aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          ref={(el) => (els.current[i] = el)}
          className="h-full w-1 origin-center rounded-full bg-gradient-to-t from-blue-500 to-violet-400 transition-transform duration-75"
          style={{ transform: 'scaleY(0.08)' }}
        />
      ))}
    </div>
  );
}
