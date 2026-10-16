import { forwardRef, useCallback, useId, useLayoutEffect, useRef, useState } from 'react';

// Liquid-glass surface. The backdrop is bent at the edges by an SVG
// displacement map sized to this element (applied through backdrop-filter,
// which only Chromium honours — fine inside Electron), then lightly blurred
// and saturated. The glossy rim and the pointer-following highlight are CSS
// (.lg in appStyles.js).
//
// Refraction re-filters the backdrop every frame that something behind it
// moves, so keep `refract` for small floating pieces (menus, capsules) and
// turn it off for large panels whose backdrop is just the blurred orbs —
// there is nothing to bend there anyway.

const round = (n) => Math.max(1, Math.round(n));

// Displacement map: red encodes x, green y; 50% grey is "no shift". The two
// gradients push the backdrop inward along every edge, and a blurred neutral
// rounded rect keeps the middle optically flat — a thick-glass rim.
function lensMap(w, h, radius, edge) {
  const inner = Math.max(radius - edge, 0);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
<defs>
<linearGradient id="x" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#000"/></linearGradient>
<linearGradient id="y" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#0f0"/><stop offset="1" stop-color="#000"/></linearGradient>
<filter id="b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${edge / 2}"/></filter>
</defs>
<rect width="${w}" height="${h}" fill="#000"/>
<rect width="${w}" height="${h}" fill="url(#x)"/>
<rect width="${w}" height="${h}" fill="url(#y)" style="mix-blend-mode:screen"/>
<rect x="${edge}" y="${edge}" width="${Math.max(w - 2 * edge, 1)}" height="${Math.max(h - 2 * edge, 1)}" rx="${inner}" fill="#808000" filter="url(#b)"/>
</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const LiquidGlass = forwardRef(function LiquidGlass({
  as: Tag = 'div',
  className = '',
  style,
  children,
  radius = 24,      // corner radius the map is drawn for (match the element's)
  edge = 14,        // width of the refracting rim, px
  strength = 24,    // displacement scale, px
  blur = 6,         // backdrop blur after refraction, px
  refract = true,
  ...rest
}, forwardedRef) {
  const id = `lg${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const ref = useRef(null);
  const [size, setSize] = useState(null);
  // Callers may need the element too (click-outside checks).
  const setRefs = useCallback((el) => {
    ref.current = el;
    if (typeof forwardedRef === 'function') forwardedRef(el);
    else if (forwardedRef) forwardedRef.current = el;
  }, [forwardedRef]);

  useLayoutEffect(() => {
    if (!refract || !ref.current) return undefined;
    const el = ref.current;
    const measure = () => {
      const w = round(el.offsetWidth);
      const h = round(el.offsetHeight);
      setSize(prev => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [refract]);

  // Specular highlight follows the pointer (CSS reads --lg-x / --lg-y).
  const onPointerMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--lg-x', `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty('--lg-y', `${e.clientY - r.top}px`);
    rest.onPointerMove?.(e);
  };

  const filters = `${refract && size ? `url(#${id}) ` : ''}blur(${blur}px) saturate(var(--lg-saturate))`;

  return (
    <Tag
      ref={setRefs}
      {...rest}
      onPointerMove={onPointerMove}
      className={`lg ${className}`}
      style={{ ...style, backdropFilter: filters, WebkitBackdropFilter: filters }}
    >
      {refract && size && (
        <svg className="lg-defs" aria-hidden="true" width="0" height="0">
          <filter
            id={id}
            x="0" y="0" width={size.w} height={size.h}
            filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feImage href={lensMap(size.w, size.h, radius, edge)} x="0" y="0" width={size.w} height={size.h} preserveAspectRatio="none" result="map" />
            <feDisplacementMap in="SourceGraphic" in2="map" scale={strength} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
      )}
      {children}
    </Tag>
  );
});

export default LiquidGlass;
