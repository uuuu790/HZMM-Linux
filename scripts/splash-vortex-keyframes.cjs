// Generates the splash's vortex keyframes (sVortex / sVortexSat in
// src/renderer/index.html): droplets spiralling in from u0 ring radii to the
// ring, angular speed growing as the radius shrinks (omega = wMin + (wEnd -
// wMin) * u^-n), each drop stretched along its heading and ending tangential
// at the ring's own spin. Prints the CSS to paste over the old keyframes.
//
// usage: node scripts/splash-vortex-keyframes.cjs css sVortex 1   (defaults are the values in use;
//        override with T, U0, N, PW, WMIN, W, STEPS env vars)
//        (same with sVortexSat 1.3 for the satellites; no args prints a summary)
const T = Number(process.env.T || 1.7) // s
const U0 = Number(process.env.U0 || 9)
const N = Number(process.env.N || 1)
const W_END = Number(process.env.W || 180) // deg/s
const PW = Number(process.env.PW || 1.4) // radial easing power
const STEPS = Number(process.env.STEPS || 24)
const STRETCH_END = 1.85

const u = p => 1 + (U0 - 1) * Math.pow(1 - p, PW)
const W_MIN = Number(process.env.WMIN || 100)
const omega = p => W_MIN + (W_END - W_MIN) * Math.pow(u(p), -N) // deg/s
// integrate angle travelled from p to 1
const dt = 1 / 4000
const remaining = []
let acc = 0
for (let i = 4000; i >= 0; i--) { remaining[i] = acc; acc += omega(i / 4000) * dt * T }
const thetaBack = p => remaining[Math.round(p * 4000)] // degrees still to go at p

function sample(p) {
  const uu = u(p)
  const back = thetaBack(p)
  // velocity in the local frame: radial (outward +) and tangential
  const e = 1e-4
  const dudt = (u(Math.min(1, p + e)) - u(Math.max(0, p - e))) / (2 * e) / T // per s, in ring radii
  const vr = dudt // ring radii / s (negative = inward)
  const vt = uu * omega(p) * Math.PI / 180 // ring radii / s
  const heading = Math.atan2(vt, vr) * 180 / Math.PI // angle of velocity from the outward radial axis
  const speed = Math.hypot(vr, vt) // ring radii / s
  // Stretch with speed (ring radius ~90px), capped, easing to the clip's opening shape at the end.
  const s = Math.min(2.2, 1 + speed * 90 / 330)
  return { p, uu, back, heading, s }
}

const rows = []
for (let k = 0; k <= STEPS; k++) {
  const p = k / STEPS
  rows.push(sample(p))
}
if (process.argv[2] === 'css') {
  const name = process.argv[3] || 'sVortex'
  const mult = Number(process.argv[4] || 1)
  let css = `@keyframes ${name} {\n`
  for (const r of rows) {
    const pct = (r.p * 100).toFixed(2).replace(/\.?0+$/, '')
    const sx = r.p === 1 ? STRETCH_END : r.s
    const sy = 1 / Math.sqrt(sx)
    const op = r.p < 0.1 ? (r.p / 0.1).toFixed(2) : '1'
    css += `        ${pct}% { transform: rotate(calc(var(--a) - ${(r.back * mult).toFixed(1)}deg)) translateX(calc(var(--r) * ${r.uu.toFixed(3)})) rotate(${r.p === 1 ? 90 : r.heading.toFixed(1)}deg) scale(${sx.toFixed(3)}, ${sy.toFixed(3)}); opacity: ${op}; }\n`
  }
  css += '      }'
  console.log(css)
} else {
  console.log('total swirl', thetaBack(0).toFixed(0), 'deg')
  for (const r of rows.filter((_, i) => i % 3 === 0)) console.log(r.p.toFixed(2), 'u', r.uu.toFixed(2), 'back', r.back.toFixed(0), 'heading', r.heading.toFixed(0), 'stretch', r.s.toFixed(2))
}
