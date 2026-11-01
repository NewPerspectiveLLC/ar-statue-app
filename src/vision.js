// ORB visual fingerprints (jsfeat) for room recognition and corner matching.
// Everything stays on the phone (IndexedDB). Nothing is uploaded.
const J = window.jsfeat;
export const PW = 320;              // processing width
const MAX_LIVE = 300, MAX_REF = 500;
const u_max = new Int32Array([15,15,15,15,14,14,14,13,13,12,11,10,9,8,6,3,0]);
let gray = null, blur = null, corners = [];
const cvs = document.createElement('canvas');
const ctx = cvs.getContext('2d', { willReadFrequently: true });

function ensure(w, h) {
  if (gray && gray.cols === w && gray.rows === h) return;
  gray = new J.matrix_t(w, h, J.U8_t | J.C1_t);
  blur = new J.matrix_t(w, h, J.U8_t | J.C1_t);
  if (corners.length < w * h) { corners = []; for (let i = 0; i < w * h; i++) corners.push(new J.keypoint_t(0, 0, 0, 0, -1)); }
}
function icAngle(img, px, py) {
  const half = 15, src = img.data, step = img.cols, c = (py * step + px) | 0;
  let m01 = 0, m10 = 0;
  for (let u = -half; u <= half; ++u) m10 += u * src[c + u];
  for (let v = 1; v <= half; ++v) {
    let vs = 0; const d = u_max[v];
    for (let u = -d; u <= d; ++u) { const p = src[c + u + v * step], m = src[c + u - v * step]; vs += p - m; m10 += u * (p + m); }
    m01 += v * vs;
  }
  return Math.atan2(m01, m10);
}
function featuresFromImageData(id, w, h, maxN, scaleBack = 1) {
  ensure(w, h);
  J.imgproc.grayscale(id.data, w, h, gray);
  J.imgproc.gaussian_blur(gray, blur, 5, 0);
  J.yape06.laplacian_threshold = 14;
  J.yape06.min_eigen_value_threshold = 12;
  let n = J.yape06.detect(blur, corners, 17);
  if (n > maxN) { J.math.qsort(corners, 0, n - 1, (a, b) => b.score < a.score); n = maxN; }
  for (let i = 0; i < n; i++) corners[i].angle = icAngle(blur, corners[i].x, corners[i].y);
  const d = new J.matrix_t(32, Math.max(n, 1), J.U8_t | J.C1_t);
  if (n) J.orb.describe(blur, corners, n, d);
  const desc = new Uint8Array(n * 32); desc.set(d.data.subarray(0, n * 32));
  const kp = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { kp[2 * i] = corners[i].x * scaleBack; kp[2 * i + 1] = corners[i].y * scaleBack; }
  return { n, kp, desc };
}
function draw(src, w, h) {
  cvs.width = w; cvs.height = h; ctx.drawImage(src, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}
export function srcSize(src) {
  return src.videoWidth ? [src.videoWidth, src.videoHeight] : [src.naturalWidth || src.width, src.naturalHeight || src.height];
}
// Live frame: single scale.
export function liveFeatures(src) {
  const [sw, sh] = srcSize(src); if (!sw) return null;
  const w = PW, h = Math.round(PW * sh / sw);
  return { w, h, ...featuresFromImageData(draw(src, w, h), w, h, MAX_LIVE) };
}
// Reference: 3 scales merged (so it still matches when you stand a bit closer/further).
export function refFeatures(src) {
  const [sw, sh] = srcSize(src); if (!sw) return null;
  const W0 = PW, H0 = Math.round(PW * sh / sw);
  const parts = [];
  for (const s of [1.33, 1, 0.75]) {
    const w = Math.round(W0 * s), h = Math.round(H0 * s);
    parts.push(featuresFromImageData(draw(src, w, h), w, h, Math.round(MAX_REF * (s === 1 ? 0.5 : 0.25)), 1 / s));
  }
  const n = parts.reduce((a, p) => a + p.n, 0);
  const kp = new Float32Array(n * 2), desc = new Uint8Array(n * 32);
  let o = 0; for (const p of parts) { kp.set(p.kp, o * 2); desc.set(p.desc, o * 32); o += p.n; }
  return { w: W0, h: H0, n, kp, desc };
}
export function thumbnail(src, width = 480, q = 0.8) {
  const [sw, sh] = srcSize(src);
  const c = document.createElement('canvas'); c.width = width; c.height = Math.round(width * sh / sw);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}
function pop(n) { n -= (n >> 1) & 0x55555555; n = (n & 0x33333333) + ((n >> 2) & 0x33333333); return (((n + (n >> 4)) & 0xF0F0F0F) * 0x1010101) >> 24; }
// Returns {inliers, matches}. Inliers = matches consistent with one homography (same view of the same place).
export function match(live, ref) {
  if (!live || !ref || live.n < 8 || ref.n < 8) return { inliers: 0, matches: 0 };
  const a = new Int32Array(live.desc.slice().buffer), b = new Int32Array(new Uint8Array(ref.desc).buffer);
  const from = [], to = [];
  for (let i = 0; i < live.n; i++) {
    let best = 1e9, second = 1e9, bj = -1; const ai = i * 8;
    for (let j = 0; j < ref.n; j++) {
      const bjo = j * 8; let d = 0;
      for (let k = 0; k < 8; k++) { d += pop(a[ai + k] ^ b[bjo + k]); if (d >= second) break; }
      if (d < best) { second = best; best = d; bj = j; } else if (d < second) second = d;
    }
    if (best <= 64 && best < 0.8 * second) {
      from.push({ x: ref.kp[2 * bj], y: ref.kp[2 * bj + 1] });
      to.push({ x: live.kp[2 * i], y: live.kp[2 * i + 1] });
    }
  }
  const cnt = from.length;
  if (cnt < 8) return { inliers: 0, matches: cnt };
  const kernel = new J.motion_model.homography2d();
  const model = new J.matrix_t(3, 3, J.F32_t | J.C1_t);
  const mask = new J.matrix_t(cnt, 1, J.U8_t | J.C1_t);
  const params = new J.ransac_params_t(4, 4, 0.5, 0.99);
  const ok = J.motion_estimator.ransac(params, kernel, from, to, cnt, model, mask, 600);
  let inl = 0; if (ok) for (let i = 0; i < cnt; i++) inl += mask.data[i];
  return { inliers: inl, matches: cnt };
}
