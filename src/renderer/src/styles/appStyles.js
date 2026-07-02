export const APP_STYLES = `
  ::selection { background: rgba(var(--accent-rgb), 0.3); }
  ::view-transition-old(root),
  ::view-transition-new(root) {
    animation: none;
    mix-blend-mode: normal;
  }
  ::view-transition-old(root) { z-index: 1; }
  ::view-transition-new(root) { z-index: 9999; }
  @keyframes slideUpFade {
    0% { opacity: 0; transform: translateY(20px); }
    100% { opacity: 1; transform: translateY(0); }
  }
  @keyframes slideDownFade {
    0% { opacity: 0; transform: translateY(-20px); }
    100% { opacity: 1; transform: translateY(0); }
  }
  @keyframes zoomInFade {
    0% { opacity: 0; transform: scale(0.96); }
    100% { opacity: 1; transform: scale(1); }
  }
  @keyframes toastSlideIn {
    0% { opacity: 0; transform: translateX(100%) scale(0.9); }
    100% { opacity: 1; transform: translateX(0) scale(1); }
  }
  @keyframes modalSpring {
    0% { opacity: 0; transform: scale(0.85) translateY(10px); }
    50% { transform: scale(1.02) translateY(-2px); }
    100% { opacity: 1; transform: scale(1) translateY(0); }
  }
  @keyframes orbFloat1 {
    0%, 100% { transform: translate(0, 0) scale(1); }
    25% { transform: translate(3vw, -2vh) scale(1.05); }
    50% { transform: translate(-1vw, 3vh) scale(0.95); }
    75% { transform: translate(-3vw, -1vh) scale(1.03); }
  }
  @keyframes orbFloat2 {
    0%, 100% { transform: translate(0, 0) scale(1); }
    33% { transform: translate(-4vw, 2vh) scale(1.04); }
    66% { transform: translate(2vw, -3vh) scale(0.97); }
  }
  @keyframes orbFloat3 {
    0%, 100% { transform: translate(0, 0) scale(1); }
    20% { transform: translate(2vw, 3vh) scale(1.06); }
    60% { transform: translate(-3vw, -2vh) scale(0.96); }
    80% { transform: translate(1vw, 1vh) scale(1.02); }
  }
  @keyframes shimmerSweep {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(200%); }
  }
  @keyframes tabFadeIn {
    0% { opacity: 0; transform: translateY(8px) scale(0.995); }
    100% { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes tabSlideLeft {
    0% { opacity: 0; transform: translateX(30px); }
    100% { opacity: 1; transform: translateX(0); }
  }
  @keyframes tabSlideRight {
    0% { opacity: 0; transform: translateX(-30px); }
    100% { opacity: 1; transform: translateX(0); }
  }
  @keyframes logoBreath {
    0%, 100% { box-shadow: 0 0 15px rgba(249,115,22,0.3), 0 0 30px rgba(249,115,22,0.1); transform: scale(1); }
    50% { box-shadow: 0 0 25px rgba(249,115,22,0.5), 0 0 50px rgba(249,115,22,0.2); transform: scale(1.05); }
  }
  @keyframes toggleBounce {
    0% { transform: scale(1); }
    20% { transform: scale(1.25); }
    40% { transform: scale(0.92); }
    60% { transform: scale(1.08); }
    80% { transform: scale(0.98); }
    100% { transform: scale(1); }
  }
  @keyframes ripplePulse {
    0% { transform: scale(1); opacity: 0.4; }
    100% { transform: scale(2.5); opacity: 0; }
  }
  @keyframes countPop {
    0% { transform: scale(1); }
    50% { transform: scale(1.2); }
    100% { transform: scale(1); }
  }
  @keyframes langItemIn {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes emptyBreath {
    0%, 100% { transform: scale(1); opacity: 0.4; }
    50% { transform: scale(1.08); opacity: 0.6; }
  }
  @keyframes newModPulse {
    0% { box-shadow: 0 0 0 0 rgba(var(--accent-rgb), 0.5); }
    70% { box-shadow: 0 0 0 12px rgba(var(--accent-rgb), 0); }
    100% { box-shadow: 0 0 0 0 rgba(var(--accent-rgb), 0); }
  }
  @keyframes slideFromBottom {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes circularReveal {
    from { clip-path: circle(0% at var(--cx, 50%) var(--cy, 50%)); }
    to { clip-path: circle(150% at var(--cx, 50%) var(--cy, 50%)); }
  }
  .animate-slide-up { opacity: 0; animation: slideUpFade 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  @keyframes pureFadeIn { from { opacity: 0; } to { opacity: 1; } }
  .animate-fade-in { opacity: 0; animation: pureFadeIn 0.4s ease-out forwards; }

  /* Auto-hiding scrollbar — thumb is transparent by default and only appears
     while the user is actively scrolling (or hovering the track). A small
     JS handler toggles the .is-scrolling class on an idle timer. */
  .scroll-fade-thumb::-webkit-scrollbar { width: 8px; height: 8px; }
  .scroll-fade-thumb::-webkit-scrollbar-track { background: transparent; }
  .scroll-fade-thumb::-webkit-scrollbar-thumb {
    background-color: transparent;
    border-radius: 9999px;
    transition: background-color 1200ms ease-out;
  }
  /* Only "actively scrolling" triggers visibility — hovering the container
     does NOT (user explicitly wanted the bar hidden unless scrolling).
     The thumb's own :hover rule stays so if the user does manage to grab
     the thumb while it's visible, it darkens as a drag-affordance. */
  .scroll-fade-thumb.is-scrolling::-webkit-scrollbar-thumb {
    background-color: rgba(148, 163, 184, 0.55);
    transition: background-color 120ms ease-out;
  }
  .dark .scroll-fade-thumb.is-scrolling::-webkit-scrollbar-thumb {
    background-color: rgba(100, 116, 139, 0.55);
  }
  .scroll-fade-thumb.is-scrolling::-webkit-scrollbar-thumb:hover {
    background-color: rgba(148, 163, 184, 0.85);
  }
  .dark .scroll-fade-thumb.is-scrolling::-webkit-scrollbar-thumb:hover {
    background-color: rgba(71, 85, 105, 0.85);
  }
  .animate-slide-down { opacity: 0; animation: slideDownFade 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  .animate-zoom-in { opacity: 0; animation: zoomInFade 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  .animate-toast-in { animation: toastSlideIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
  .animate-modal-spring { animation: modalSpring 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
  .animate-tab-enter { animation: tabFadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  .animate-tab-left { animation: tabSlideLeft 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  .animate-tab-right { animation: tabSlideRight 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  .orb-float-1 { animation: orbFloat1 25s ease-in-out infinite; }
  .orb-float-2 { animation: orbFloat2 30s ease-in-out infinite; }
  .orb-float-3 { animation: orbFloat3 22s ease-in-out infinite; }
  .orb-float-4 { animation: orbFloat2 28s ease-in-out infinite reverse; }
  .shimmer-sweep::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent);
    animation: shimmerSweep 1.2s ease-in-out infinite;
  }
  .logo-breath { animation: logoBreath 3s ease-in-out infinite; }
  .toggle-bounce { animation: toggleBounce 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
  .count-pop { animation: countPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
  @keyframes fly-1 {
    from { transform: translateY(1px); }
    to { transform: translateY(-1px); }
  }
  .launch-hover .icon-mover {
    transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .launch-hover .icon-mover svg {
    transform-origin: center center;
    transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .launch-hover .launch-text,
  .launch-hover .launch-badge {
    transition: transform 0.3s ease-in-out, opacity 0.3s ease-in-out;
  }
  .launch-hover:hover .icon-mover .svg-wrapper {
    animation: fly-1 0.6s ease-in-out infinite alternate;
  }
  .launch-hover .launch-content {
    transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  /* The icon/content centering math (--icon-center / --content-center) only
     applies above lg, where the sidebar shows both the Play icon and the
     launch-text. Below lg the text is display:none, the button is
     justify-center, and the icon is already centered — applying the
     translateX (which gets computed from a display:none rect) would shove
     the icon off to one side. */
  @media (min-width: 1024px) {
    .launch-hover:hover .icon-mover {
      transform: var(--icon-center, translateX(0));
    }
    .launch-hover:hover .launch-content {
      transform: var(--content-center, translateX(0));
    }
    .launch-hover:hover .icon-mover svg {
      transform: rotate(360deg) scale(1.1);
    }
  }
  .launch-hover:hover .launch-text {
    overflow: visible !important;
    text-overflow: clip !important;
  }
  .launch-hover:hover .launch-badge {
    transform: translateX(3em) !important;
    opacity: 0 !important;
  }
  /* YouTube-style spinner */
  .yt-spinner {
    animation: yt-rotate 1.4s linear infinite;
  }
  .yt-spinner-arc {
    stroke-dasharray: 59.7;
    stroke-dashoffset: 59.7;
    animation: yt-dash 1.4s ease-in-out infinite;
    transform-origin: center;
  }
  @keyframes yt-rotate {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  @keyframes yt-dash {
    0% { stroke-dashoffset: 59.7; transform: rotate(0deg); }
    50% { stroke-dashoffset: 15; transform: rotate(90deg); }
    100% { stroke-dashoffset: 59.7; transform: rotate(360deg); }
  }

  /* Keep icon at center while launching/confirmed (lg+ only — see media
     query above for why the centering is gated). */
  @media (min-width: 1024px) {
    .launch-hover.launch-active .icon-mover {
      transform: var(--icon-center, translateX(0));
    }
    .launch-hover.launch-active .launch-content {
      transform: var(--content-center, translateX(0));
    }
  }
  .launch-hover.launch-active .launch-badge {
    transform: translateX(3em) !important;
    opacity: 0 !important;
  }
  .glass-glow {
    transition: background 0.4s ease;
    background: transparent;
  }
  .glass-glow:hover {
    background: radial-gradient(circle at var(--glow-x, 50%) var(--glow-y, 50%), rgba(var(--accent-rgb),0.06) 0%, transparent 60%);
  }
  .dark .glass-glow {
    background: transparent;
  }
  .dark .glass-glow:hover {
    background: radial-gradient(circle at var(--glow-x, 50%) var(--glow-y, 50%), rgba(var(--accent-rgb),0.08) 0%, transparent 60%);
  }

  /* Sidebar Radio Nav */
  .sidebar-nav {
    --total-radio: 5;
    display: flex;
    flex-direction: column;
    position: relative;
    padding-left: 0.5rem;
  }
  .sidebar-nav input[type="radio"] {
    appearance: none;
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
    pointer-events: none;
  }
  .sidebar-nav label {
    cursor: pointer;
    padding: 0.875rem 1rem;
    position: relative;
    display: flex;
    align-items: center;
    gap: 1rem;
    transition: all 0.3s ease-in-out;
    color: rgb(100, 116, 139);
  }
  .dark .sidebar-nav label {
    color: rgb(148, 163, 184);
  }
  .sidebar-nav label:hover {
    color: rgb(30, 41, 59);
  }
  .dark .sidebar-nav label:hover {
    color: rgb(241, 245, 249);
  }
  .sidebar-nav input:checked + label {
    color: var(--accent-600);
  }
  .dark .sidebar-nav input:checked + label {
    color: var(--accent-400);
  }
  .sidebar-nav input:checked + label svg {
    transform: scale(1.1);
  }
  .sidebar-nav .glider-container {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    background: linear-gradient(0deg, rgba(0,0,0,0) 0%, rgba(var(--accent-rgb), 0.12) 50%, rgba(0,0,0,0) 100%);
    width: 2px;
    border-radius: 1px;
    pointer-events: none;
  }
  .sidebar-nav .glider-container .glider {
    position: relative;
    height: calc(100% / var(--total-radio));
    width: 100%;
    background: linear-gradient(0deg, rgba(0,0,0,0) 0%, var(--accent-500) 50%, rgba(0,0,0,0) 100%);
    transition: transform 0.5s cubic-bezier(0.37, 1.95, 0.66, 0.56);
  }
  .sidebar-nav .glider-container .glider::before {
    content: "";
    position: absolute;
    height: 60%;
    width: 300%;
    top: 50%;
    transform: translateY(-50%);
    background: var(--accent-500);
    filter: blur(10px);
    opacity: 0.5;
  }
  .sidebar-nav .glider-container .glider::after {
    content: "";
    position: absolute;
    left: 0;
    height: 100%;
    width: 48px;
    background: linear-gradient(90deg, rgba(var(--accent-rgb), 0.07) 0%, rgba(0,0,0,0) 100%);
  }
  .sidebar-nav input:nth-of-type(1):checked ~ .glider-container .glider { transform: translateY(0); }
  .sidebar-nav input:nth-of-type(2):checked ~ .glider-container .glider { transform: translateY(100%); }
  .sidebar-nav input:nth-of-type(3):checked ~ .glider-container .glider { transform: translateY(200%); }
  .sidebar-nav input:nth-of-type(4):checked ~ .glider-container .glider { transform: translateY(300%); }
  .sidebar-nav input:nth-of-type(5):checked ~ .glider-container .glider { transform: translateY(400%); }
  .sidebar-nav input:nth-of-type(6):checked ~ .glider-container .glider { transform: translateY(500%); }

  /* Tab container max-width spring. Only animate when viewport is wide enough
     for the 1600px Nexus width to actually differ from the 1152px (max-w-6xl)
     other tabs — below xl the two widths collapse to the viewport, and the
     transition is a perceived flicker without any visual width change. */
  .tab-width-spring { contain: layout style; }
  @media (min-width: 1280px) {
    .tab-width-spring { transition: max-width 500ms cubic-bezier(0.34, 1.56, 0.64, 1); }
  }
`;
