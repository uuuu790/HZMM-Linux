// Renders the splash's liquid-formation clip (src/renderer/public/splash-liquid.webm).
// Each frame is drawn deterministically as SVG in headless Chromium (glossy goo
// droplets spiralling into a pool that settles into the logo, the logo
// spinning in; the ripple as the pool lands is index.html's full-window wave) and screenshotted with a transparent background;
// ffmpeg then encodes them as VP9 with alpha. Drawn in the logo's own orange:
// index.html themes it with the same hue-rotate as the logo.
//
// usage: node scripts/render-splash-liquid.cjs          (needs ffmpeg with libvpx-vp9 on PATH)
//        node scripts/render-splash-liquid.cjs preview  (a few frames into the temp dir, no encode)
const { chromium } = require('playwright')
const { execFileSync } = require('child_process')
const os = require('os')
const fs = require('fs')
const path = require('path')

const only = process.argv[2]
const FPS = 60
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-splash-'))
const CLIP = path.join(__dirname, '..', 'src', 'renderer', 'public', 'splash-liquid.webm')
// The clip starts from the ring of droplets index.html keeps circling while
// the app loads (same angles, radii and sizes as the table below): splash.js
// turns the clip to the ring's current angle and swaps it in on its first
// frame. It ends on the plain logo once that has spun in.
const LEAD = 0
const DURATION = 1.85
const SIZE = 480 // 2x of the 240px stage
const logo = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'assets', 'icon.png')).toString('base64')

const page = `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>
<svg id="s" width="${SIZE}" height="${SIZE}" viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Logo disc colours, laid over the logo box so the pool ends up matching it. -->
    <linearGradient id="fill" gradientUnits="userSpaceOnUse" x1="72" y1="72" x2="168" y2="168">
      <stop offset="0" stop-color="#f66b18"/><stop offset="1" stop-color="#df3025"/>
    </linearGradient>
    <filter id="goo" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation="5.5" result="blur"/>
      <feColorMatrix in="blur" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -11" result="shape"/>
      <!-- Gloss: light the blurred shape as a height map; keep it inside the shape. -->
      <feGaussianBlur in="shape" stdDeviation="3.2" result="bump"/>
      <feSpecularLighting in="bump" surfaceScale="5" specularConstant="0.9" specularExponent="26" lighting-color="#ffffff" result="spec">
        <fePointLight x="70" y="40" z="140"/>
      </feSpecularLighting>
      <feComposite in="spec" in2="shape" operator="in" result="specIn"/>
      <!-- Soft rim shade on the lower right. -->
      <feOffset in="bump" dx="-2.5" dy="-2.5" result="off"/>
      <feComposite in="shape" in2="off" operator="out" result="rim"/>
      <feColorMatrix in="rim" values="0 0 0 0 0.35  0 0 0 0 0.05  0 0 0 0 0.02  0 0 0 0.35 0" result="rimShade"/>
      <feMerge><feMergeNode in="shape"/><feMergeNode in="rimShade"/></feMerge>
      <feComposite operator="arithmetic" in2="specIn" k2="1" k3="0.45" result="final"/>
    </filter>

  </defs>
  <g id="liquid" filter="url(#goo)" fill="url(#fill)"></g>
  <image id="logo" href="${logo}" x="72" y="72" width="96" height="96"/>
</svg>
<script>
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const prog = (t, start, dur) => clamp((t - start) / dur);
const easeInOutCubic = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const easeInQuad = x => x * x;
const easeInCubic = x => x * x * x;
const easeOutCubic = x => 1 - Math.pow(1 - x, 3);
const easeOutBack = (x, s = 1.7) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
const D = Math.PI / 180;
const C = 120;

// Droplets: base angle, start radius, size, start, travel time, wobble phase.
// Angle, radius and size must match the .drip elements in index.html.
const drops = [
  { a: 8, R: 92, s: 13.5, d: 0.00, T: 1.02, w: 0.0 },
  { a: 62, R: 78, s: 9.0, d: 0.06, T: 0.92, w: 1.3 },
  { a: 118, R: 96, s: 12.0, d: 0.03, T: 1.06, w: 2.1 },
  { a: 176, R: 74, s: 8.0, d: 0.10, T: 0.88, w: 0.7 },
  { a: 228, R: 90, s: 14.0, d: 0.02, T: 1.00, w: 2.8 },
  { a: 286, R: 82, s: 10.0, d: 0.08, T: 0.95, w: 1.9 },
  { a: 330, R: 100, s: 6.5, d: 0.12, T: 1.08, w: 0.4 },
];
const SWIRL = 430; // degrees of global rotation over the formation
// Starts already turning at the ring's spin (~180 deg/s, the speed the CSS
// droplets circle at) and winds up faster as the drops spiral in.
const swirl = t => { const x = prog(t, 0, 1.2); return SWIRL * (0.5 * x + 0.5 * easeInOutCubic(x)); };
const swirlSpeed = t => (swirl(t + 0.005) - swirl(t - 0.005)) / 0.01; // deg/s

function el(tag, attrs) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

// Pool radius: grows from the merges, overshoots, rings down to the logo's 48.
function poolRadius(t) {
  if (t < 0.28) return 0;
  const g = easeOutCubic(prog(t, 0.28, 0.82)) * 48;
  if (t < 1.1) return g;
  const k = t - 1.1;
  return 48 + 4.2 * Math.exp(-k * 7) * Math.cos(k * 26 + 1.2);
}
function poolPath(t) {
  const r = poolRadius(t);
  if (r <= 0.2) return '';
  const k = Math.max(0, t - 0.75);
  const A = 0.07 * Math.exp(-k * 4.5) * (t < 0.75 ? t / 0.75 : 1);
  const B = 0.035 * Math.exp(-k * 5.5);
  const pts = [];
  for (let i = 0; i <= 96; i++) {
    const p = (i / 96) * Math.PI * 2;
    const rr = r * (1 + A * Math.sin(3 * p + t * 9) + B * Math.sin(5 * p - t * 13));
    pts.push((C + rr * Math.cos(p)).toFixed(2) + ' ' + (C + rr * Math.sin(p)).toFixed(2));
  }
  return 'M' + pts.join('L') + 'Z';
}

function render(t) {
  const g = document.getElementById('liquid');
  g.textContent = '';
  if (t < 0) {
    for (const id of ['logo']) document.getElementById(id).setAttribute('opacity', '0');
    return;
  }
  const rot = swirl(t);
  const speed = swirlSpeed(t) * D; // rad/s
  for (const dr of drops) {
    const p = prog(t, dr.d, dr.T);
    const radius = dr.R * (1 - easeInQuad(p)) + 2.5 * (Math.sin(t * 7 + dr.w) - Math.sin(dr.w)) * (1 - p);
    const grow = 1; // already full size when the CSS droplets hand over
    const size = dr.s * grow * (0.55 + 0.45 * (1 - p));
    if (size <= 0.1 || p >= 1) continue;
    const ang = (dr.a + rot) * D;
    const x = C + radius * Math.cos(ang);
    const y = C + radius * Math.sin(ang);
    // Stretch along the direction of travel (tangent plus the inward pull).
    const vt = radius * speed;
    const stretch = 1 + Math.min(0.9, vt / 260);
    const heading = ang * 180 / Math.PI + 90 - 18 * p;
    g.appendChild(el('ellipse', { cx: x.toFixed(2), cy: y.toFixed(2), rx: (size * stretch).toFixed(2), ry: (size / Math.sqrt(stretch)).toFixed(2), transform: 'rotate(' + heading.toFixed(2) + ' ' + x.toFixed(2) + ' ' + y.toFixed(2) + ')' }));
    // Trailing beads that the goo filter pulls into a tail.
    for (let j = 1; j <= 7; j++) {
      const lag = j * 0.024;
      const pj = prog(t - lag, dr.d, dr.T);
      const rj = dr.R * (1 - easeInQuad(pj));
      const aj = (dr.a + swirl(t - lag)) * D;
      const sj = size * (0.82 - j * 0.1);
      if (sj <= 0.3 || pj >= 1 || t - lag < dr.d + 0.08) continue;
      g.appendChild(el('circle', { cx: (C + rj * Math.cos(aj)).toFixed(2), cy: (C + rj * Math.sin(aj)).toFixed(2), r: sj.toFixed(2) }));
    }
  }
  const d = poolPath(t);
  if (d) g.appendChild(el('path', { d }));
  // Liquid gives way to the logo once it has spun in.
  g.setAttribute('opacity', (1 - prog(t, 1.62, 0.18)).toFixed(3));


  // Logo spins in on top of the settled pool.
  const lp = prog(t, 1.18, 0.5);
  const logo = document.getElementById('logo');
  const lr = -110 * (1 - easeOutBack(lp, 1.3));
  const ls = 0.9 + 0.1 * easeOutCubic(lp);
  logo.setAttribute('opacity', easeOutCubic(prog(t, 1.18, 0.32)).toFixed(3));
  logo.setAttribute('transform', 'rotate(' + lr.toFixed(2) + ' 120 120) translate(120 120) scale(' + ls.toFixed(4) + ') translate(-120 -120)');

}
window.render = render;
</script></body></html>`

;(async () => {
  const b = await chromium.launch()
  const p = await b.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 })
  await p.setContent(page)
  const frames = Math.round(DURATION * FPS) + 1
  const list = only === 'preview' ? [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.05, 1.2, 1.35, 1.5, 1.65, 1.75, 1.85].map(t => Math.round((t + LEAD) * FPS))
    : [...Array(frames).keys()]
  for (const i of list) {
    await p.evaluate(t => window.render(t), i / FPS - LEAD)
    await p.screenshot({ path: path.join(outDir, `f${String(i).padStart(4, '0')}.png`), omitBackground: true })
  }
  await b.close()
  if (only === 'preview') { console.log('preview frames in', outDir); return }
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', path.join(outDir, 'f%04d.png'),
    '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '28', '-row-mt', '1', '-deadline', 'good', '-an', CLIP], { stdio: 'inherit' })
  fs.rmSync(outDir, { recursive: true, force: true })
  console.log('wrote', CLIP, fs.statSync(CLIP).size, 'bytes from', list.length, 'frames')
})()
