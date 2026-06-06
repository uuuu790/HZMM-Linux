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
    const step = (now) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      setDisplay(Math.round(start + (end - start) * eased));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    prevValue.current = end;
  }, [value]);

  return <span className={`${className} ${display !== prevValue.current ? '' : 'count-pop'}`} style={{ display: 'inline-block' }}>{display}</span>;
};

export default AnimatedNumber;
