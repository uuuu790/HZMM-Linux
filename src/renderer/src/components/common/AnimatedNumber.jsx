import { useState, useEffect, useRef } from 'react';

const AnimatedNumber = ({ value, className = '' }) => {
  const [display, setDisplay] = useState(0);
  const prevValue = useRef(0);

  useEffect(() => {
    const start = prevValue.current;
    const end = value;
    if (start === end) return;
    const duration = 600;
    const startTime = performance.now();
    let cancelled = false;
    let rafId = null;
    const step = (now) => {
      if (cancelled) return;
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      setDisplay(Math.round(start + (end - start) * eased));
      if (progress < 1) rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
    prevValue.current = end;
    // Cancel in-flight animation when value changes mid-frame or
    // component unmounts. Without this, rapid value updates overlap
    // multiple step() loops that race writes to display.
    return () => { cancelled = true; if (rafId !== null) cancelAnimationFrame(rafId); };
  }, [value]);

  return <span className={`${className} ${display !== prevValue.current ? '' : 'count-pop'}`} style={{ display: 'inline-block' }}>{display}</span>;
};

export default AnimatedNumber;
