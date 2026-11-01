import { liveFeatures, refFeatures, thumbnail, match } from './vision.js';

const $ = id => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const DEBUG = Q.has('debug');               // desktop testing: pretend AR exists
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const ROOM_MATCH = 20, CORNER_MATCH = 18, STREAK = 3;

/* ---------------- storage: IndexedDB, on this phone only ---------------- */
const db = (() => {
  let p;
  const open = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open('ar-statue-app', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('rooms', { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => { const d = await open(); return new Promise((res, rej) => {
    const t = d.transaction('rooms', mode), s = t.objectStore('rooms'), r = fn(s);
    t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); };
  return { all: () => tx('readonly', s => s.getAll()), put: v => tx('readwrite', s => s.put(v)), clear: () => tx('readwrite', s => s.clear()) };
})();

/* ---------------- activation audio (once per placement) ---------------- */
const audio = new Audio(isIOS ? 'audio/activate.m4a' : 'audio/activate.mp3');
audio.preload = 'auto';
let placement = null; // {id, started, done}
function newPlacement() { placement = { id: Date.now(), started: false, done: false }; }
audio.addEventListener('ended', () => { if (placement) placement.done = true; $('playAgain').hidden = true; });
function unlockAudio() { // call inside a user tap
  if (placement && placement.started) return;
  audio.muted = true;
  audio.play().then(() => { audio.pause(); audio.currentTime = 0; audio.muted = false; }).catch(() => { audio.muted = false; });
}
function playActivation() {
  if (!placement || placement.done) return;
  if (!placement.started) { audio.currentTime = 0; placement.started = true; }
  audio.muted = false;
  audio.play().catch(() => { $('playAgain').hidden = false; });
}
$('playAgain').onclick = () => { $('playAgain').hidden = true; playActivation(); };
function resumeIfInterrupted() { // iOS: Quick Look may pause page audio; finish it on return
  if (document.visibilityState === 'visible' && placement && placement.started && !placement.done && audio.paused) playActivation();
}
document.addEventListener('visibilitychange', resumeIfInterrupted);
window.addEventListener('focus', resumeIfInterrupted);
window.addEventListener('pageshow', resumeIfInterrupted);

/* ---------------- UI helpers ---------------- */
function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id)); }
function gate(n, state, text) { const li = $('g' + n); li.className = state || ''; if (text) $('g' + n + 't').textContent = text; }
function cam(opts) {
  $('camTitle').textContent = opts.title; $('camText').textContent = opts.text || '';
  $('roomName').hidden = !opts.nameInput;
  $('meterWrap').hidden = !opts.meter;
  const p = $('camPrimary'); p.textContent = opts.primary || ''; p.hidden = !opts.primary; p.disabled = !!opts.primaryDisabled;
  for (const [id, v] of [['camAlt', opts.alt], ['camAlt2', opts.alt2]]) { $(id).hidden = !v; $(id).textContent = v || ''; }
  $('thumb').hidden = !opts.thumb; if (opts.thumb) $('thumb').src = opts.thumb;
  setMeter(0, '');
}
function setMeter(v, t) { $('meter').style.width = Math.round(Math.min(1, v) * 100) + '%'; $('meterTxt').textContent = t; }
const once = (id) => new Promise(res => { $(id).onclick = e => res(e); });
function race(ids) { return new Promise(res => ids.forEach(id => { $(id).onclick = () => res(id); })); }

/* ---------------- camera ---------------- */
let stream = null, loop = 0;
async function cameraOn() {
  if (stream) return;
  stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
  const v = $('video'); v.srcObject = stream; await v.play().catch(() => {});
  await new Promise(r => v.videoWidth ? r() : v.addEventListener('loadedmetadata', r, { once: true }));
}
function cameraOff() { stopLoop(); if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; $('video').srcObject = null; } }
function startLoop(fn, ms = 140) { stopLoop(); let busy = false; loop = setInterval(() => { if (busy) return; busy = true; try { fn(); } finally { busy = false; } }, ms); }
function stopLoop() { clearInterval(loop); loop = 0; }

/* ---------------- gates ---------------- */
let platform = 'none', xr = null;
async function gateDevice() {
  gate(1, 'run', 'Checking AR and camera…');
  let ar = false;
  if (isIOS) { platform = 'ios'; ar = document.createElement('a').relList.supports('ar'); }
  else { xr = await import('../xr.bundle.js').catch(() => null); if (xr && await xr.isSupported()) { platform = 'android'; ar = true; } }
  if (DEBUG && !ar) { platform = Q.get('debug') === 'android' ? 'android' : 'ios'; ar = true; }
  if (!ar) { gate(1, 'bad', 'This browser has no AR. Use iPhone Safari or Chrome on an ARCore Android phone.'); return false; }
  try { await cameraOn(); } catch (e) { gate(1, 'bad', 'Camera blocked. Allow camera access for this site and try again.'); return false; }
  gate(1, 'ok', (platform === 'ios' ? 'iPhone · AR Quick Look' : 'Android · WebXR + anchors') + ' · camera on');
  return true;
}

async function setupRoom(rooms) {
  const views = [];
  cam({ title: 'Set up this room', text: 'Name the room, then capture 3 views of it from where you will usually stand: left, center, right. Aim at things that don\'t move (walls, windows, furniture).',
        nameInput: true, primary: 'Capture view 1 of 3' });
  $('roomName').value = rooms.length ? '' : 'My room';
  while (views.length < 3) {
    const r = await race(['camPrimary', 'camBack']);
    if (r === 'camBack') return null;
    const fp = refFeatures($('video'));
    if (!fp || fp.n < 40) { $('camText').textContent = 'Not enough detail in that view. Aim at something with more texture and try again.'; continue; }
    views.push({ fp, photo: thumbnail($('video'), 320, 0.7) });
    $('camPrimary').textContent = views.length < 3 ? `Capture view ${views.length + 1} of 3` : 'Saving…';
  }
  const room = { id: 'room-' + Date.now(), name: ($('roomName').value || 'My room').trim(), views, corner: null, created: new Date().toISOString() };
  await db.put(room);
  return room;
}

async function gateRoom() {
  gate(2, 'run', 'Recognizing room…'); show('cam');
  let rooms = await db.all();
  if (!rooms.length) { const r = await setupRoom(rooms); if (!r) return null; gate(2, 'ok', 'New room saved: ' + r.name); return r; }
  cam({ title: 'Which room is this?', text: 'Aim at the room the way you did when you set it up.', meter: true, alt: 'This is a new room', alt2: null });
  const scores = new Map(); let i = 0, streak = 0, t0 = Date.now(), manualShown = false;
  const views = rooms.flatMap(r => r.views.map(v => ({ room: r, fp: v.fp })));
  return new Promise(resolve => {
    const done = (room) => { stopLoop(); resolve(room); };
    startLoop(() => {
      const live = liveFeatures($('video')); if (!live) return;
      // test two views per tick (round-robin)
      for (let k = 0; k < Math.min(2, views.length); k++) { const v = views[i++ % views.length]; scores.set(v, match(live, v.fp).inliers); }
      let best = null, bs = 0; for (const [v, s] of scores) if (s > bs) { bs = s; best = v; }
      setMeter(bs / ROOM_MATCH, best ? `${best.room.name}: ${bs}/${ROOM_MATCH}` : 'looking…');
      streak = bs >= ROOM_MATCH ? streak + 1 : 0;
      if (streak >= STREAK) { gate(2, 'ok', 'Recognized: ' + best.room.name); setTimeout(() => done(best.room), 400); stopLoop(); }
      if (!manualShown && Date.now() - t0 > 20000 && rooms.length) {
        manualShown = true; $('camAlt2').hidden = false; $('camAlt2').textContent = 'Choose ' + rooms[0].name + ' manually';
        $('camText').textContent = 'Still looking. Try standing where you set the room up, or pick it manually.';
      }
    });
    $('camAlt').onclick = async () => { stopLoop(); const r = await setupRoom(rooms); if (r) { gate(2, 'ok', 'New room saved: ' + r.name); resolve(r); } else resolve(null); };
    $('camAlt2').onclick = () => { gate(2, 'ok', 'Chosen manually: ' + rooms[0].name); done(rooms[0]); };
    $('camBack').onclick = () => done(null);
  });
}

/* ---------------- corner: mark ---------------- */
async function markCorner(room) {
  gate(3, 'run', 'Mark your statue corner');
  show('cam'); await cameraOn();
  cam({ title: 'Mark your statue corner', text: 'Aim at the corner where the statue should stand. Get the floor and both walls in view, then tap Capture Corner.', primary: 'Capture Corner' });
  for (;;) {
    const r = await race(['camPrimary', 'camBack']); if (r === 'camBack') return false;
    const fp = refFeatures($('video'));
    if (!fp || fp.n < 40) { $('camText').textContent = 'Not enough detail. Step back a little so more of the corner shows, then try again.'; continue; }
    room.corner = { fp, photo: thumbnail($('video'), 480, 0.8), markedAt: new Date().toISOString(), handle: null, fallback: null };
    break;
  }
  await db.put(room);
  if (platform === 'ios') { gate(3, 'ok', 'Corner photo saved'); return true; }
  // Android: lock it with a real anchor
  cam({ title: 'Now tap the floor in the corner', text: 'AR will open. Put the ring on the floor in your corner and tap Mark Corner. The statue appears there, locked.', primary: 'Open AR', thumb: room.corner.photo });
  const r = await race(['camPrimary', 'camBack']); if (r === 'camBack') return false;
  unlockAudio(); cameraOff();
  await runXR(room, 'mark');
  return true;
}

/* ---------------- Android XR session ---------------- */
function runXR(room, mode) {
  return new Promise(async resolve => {
    const ov = $('xr-overlay'); ov.hidden = false;
    $('xrPlace').textContent = mode === 'mark' ? 'Mark Corner' : 'Place Statue Here';
    const ui = { status: t => $('xrStatus').textContent = t, showPlace: b => $('xrPlace').hidden = !b,
                 onPlace: fn => $('xrPlace').onclick = fn, onExit: fn => $('xrExit').onclick = fn };
    try {
      await xr.start({ mode, handle: room.corner && room.corner.handle, yawRel: room.corner && room.corner.fallback && room.corner.fallback.yawRel,
        overlay: ov, ui,
        onAnchored: async info => {
          if (info.isNew) {
            newPlacement(); playActivation();
            room.corner.handle = info.handle || null;
            room.corner.fallback = Object.assign(room.corner.fallback || {}, { viewDist: info.viewDist, viewHeight: info.viewHeight, savedAt: new Date().toISOString() });
            await db.put(room);
            gate(3, 'ok', info.handle ? 'Corner anchored (persistent)' : 'Corner anchored (this session) + photo guide saved');
          }
        },
        onYawRel: async y => { room.corner.fallback = Object.assign(room.corner.fallback || {}, { yawRel: y }); await db.put(room); },
        onEnd: () => { ov.hidden = true; show('home'); refreshHome(); resolve(); } });
    } catch (e) { ov.hidden = true; $('homeMsg').textContent = 'Could not start AR: ' + e.message; show('home'); resolve(); }
  });
}

/* ---------------- corner: guide + place ---------------- */
async function placeAtCorner(room) {
  // Android with a persistent handle: restore directly.
  if (platform === 'android' && room.corner.handle && xr.persistentSupported()) {
    show('cam'); cam({ title: 'Restore statue', text: 'Your corner has a saved anchor. Open AR and look toward the corner.', primary: 'Open AR', thumb: room.corner.photo, alt: 'Re-mark corner' });
    const r = await race(['camPrimary', 'camAlt', 'camBack']);
    if (r === 'camBack') return; if (r === 'camAlt') { await markCorner(room); return; }
    cameraOff(); await runXR(room, 'restore'); return;
  }
  show('cam'); await cameraOn();
  cam({ title: 'Aim at your saved corner', text: 'Match the photo in the corner of the screen. Place Statue Here unlocks when the view matches.',
        meter: true, primary: 'Place Statue Here', primaryDisabled: true, thumb: room.corner.photo, alt: 'Re-mark corner' });
  let streak = 0;
  startLoop(() => {
    const live = liveFeatures($('video')); if (!live) return;
    const s = match(live, room.corner.fp).inliers;
    streak = s >= CORNER_MATCH ? streak + 1 : Math.max(0, streak - 1);
    const ok = streak >= STREAK;
    setMeter(s / CORNER_MATCH, ok ? 'Corner matched ✓' : `match ${s}/${CORNER_MATCH}`);
    $('camPrimary').disabled = !ok;
  });
  const r = await race(['camPrimary', 'camAlt', 'camBack']);
  stopLoop();
  if (r === 'camBack') return;
  if (r === 'camAlt') { await markCorner(room); return; }
  if (platform === 'ios') {
    newPlacement(); playActivation();          // same tap: start the audio, then Quick Look
    cameraOff(); openQuickLook();
    $('homeMsg').textContent = 'Quick Look: move the phone slowly, then put the statue on the floor in your corner. Tap the statue and drag to adjust.';
    show('home'); refreshHome();
  } else {
    unlockAudio(); cameraOff(); await runXR(room, 'guided');
  }
}
function openQuickLook() {
  const a = document.createElement('a'); a.rel = 'ar';
  a.href = new URL('statue.usdz#allowsContentScaling=0', location.href).href;
  a.appendChild(document.createElement('img')); document.body.appendChild(a); a.click(); a.remove();
}

/* ---------------- main ---------------- */
let busy = false;
async function run(forceRemark) {
  if (busy) return; busy = true; $('homeMsg').textContent = '';
  try {
    if (!(await gateDevice())) { cameraOff(); return; }
    const room = await gateRoom();
    if (!room) { gate(2, 'bad', 'Room not confirmed'); return; }
    if (!room.corner || forceRemark) { const ok = await markCorner(room); if (!ok || platform === 'android') return; }
    gate(3, 'ok', 'Corner saved');
    await placeAtCorner(room);
  } catch (e) { $('homeMsg').textContent = 'Something went wrong: ' + e.message; }
  finally { cameraOff(); busy = false; if (!document.querySelector('#xr-overlay:not([hidden])')) { show('home'); refreshHome(); } }
}
async function refreshHome() {
  const rooms = await db.all().catch(() => []);
  const withCorner = rooms.filter(r => r.corner);
  $('remarkBtn').hidden = !withCorner.length; $('forgetBtn').hidden = !rooms.length;
  if (!$('g3').classList.contains('ok')) gate(3, '', withCorner.length ? `Saved for: ${withCorner.map(r => r.name).join(', ')}` : 'Not marked yet');
  $('startBtn').textContent = withCorner.length ? 'Start · Place Statue' : 'Start';
}
$('startBtn').onclick = () => { unlockAudio(); run(false); };
$('remarkBtn').onclick = () => { unlockAudio(); run(true); };
$('forgetBtn').onclick = async () => { if (confirm('Forget all saved rooms and corners on this phone?')) { await db.clear(); gate(2, ''); gate(3, ''); refreshHome(); } };
refreshHome();
window.__statue = { db, match, liveFeatures, refFeatures, get placement() { return placement; } };
