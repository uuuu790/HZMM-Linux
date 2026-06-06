import { useRef } from 'react';

const GlassCard = ({ children, className = '', isPill = true, onClick }) => {
  const cardRef = useRef(null);

  const handleMouseMove = (e) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    cardRef.current.style.setProperty('--glow-x', `${x}%`);
    cardRef.current.style.setProperty('--glow-y', `${y}%`);
  };

  const handleMouseLeave = () => {
    if (!cardRef.current) return;
    cardRef.current.style.setProperty('--glow-x', '50%');
    cardRef.current.style.setProperty('--glow-y', '50%');
  };

  return (
    <div
      ref={cardRef}
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={`
        glass-glow relative isolate transform-gpu overflow-hidden ${isPill ? 'rounded-full' : 'rounded-[1.5rem] md:rounded-[2.5rem]'}
        bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl
        border border-white/80 dark:border-white/10 shadow-[0_2px_8px_rgba(0,0,0,0.04)] dark:shadow-[0_2px_10px_rgba(0,0,0,0.15)]
        transition-all duration-500 ease-out outline-none focus:outline-none active:outline-none ring-0 focus:ring-0 [-webkit-tap-highlight-color:transparent]
        hover:bg-white/80 dark:hover:bg-slate-800/80 hover:border-white/90 dark:hover:border-white/20 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(0,0,0,0.06)] dark:hover:shadow-[0_6px_20px_rgba(0,0,0,0.25)]
        cursor-pointer
        ${className}
      `}
    >
      <div className="absolute inset-0 rounded-[inherit] bg-gradient-to-br from-white/50 dark:from-white/5 to-transparent opacity-0 transition-opacity duration-700 hover:opacity-100 pointer-events-none" />
      {children}
    </div>
  );
};

export default GlassCard;
