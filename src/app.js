import { liveFeatures, refFeatures, thumbnail, match } from './vision.js';

const $ = id => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const DEBUG = Q.has('debug');               // desktop testing: pretend AR exists (?debug=ios | ?debug=android)
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const ROOM_MATCH = 20, CORNER_MATCH = 18, STREAK = 3, ROOM_TIMEOUT_MS = 25000, ZKEY = 'ar-statue-zone';

/* ---------------- storage: IndexedDB + localStorage, on this phone only ---------------- */
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
const zone = {
  saved() { try { return JSON.parse(localStorage.getItem(ZKEY)); } catch { return null; } },
  save(z) { localStorage.setItem(ZKEY, JSON.stringify({ lat: +z.lat, lon: +z.lon, radius: +z.radius || 75, savedAt: new Date().toISOString() })); },
  reset() { localStorage.removeItem(ZKEY); },
  // URL params ?lat=&lon=&radius= override for this visit only (not saved)
  get() {
    const s = this.saved(), lat = parseFloat(Q.get('lat')), lon = parseFloat(Q.get('lon')), r = parseFloat(Q.get('radius'));
    if (!isNaN(lat) && !isNaN(lon)) return { lat, lon, radius: !isNaN(r) ? r : (s && s.radius) || 75, override: true };
    if (s && !isNaN(r)) return { ...s, radius: r, override: true };
    return s;
  },
};

/* ---------------- GPS geofence (Gate 1) ---------------- */
const geo = { fix: null, err: null, id: null };
function startGeo() {
  if (geo.id !== null) return;
  if (!('geolocation' in navigator)) { geo.err = 'unsupported'; renderHome(); return; }
  geo.id = navigator.geolocation.watchPosition(
    p => { geo.fix = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() }; geo.err = null; onGeo(); },
    e => { geo.err = e.code === 1 ? 'denied' : e.code === 2 ? 'unavailable' : 'timeout'; onGeo(); },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
}
function distM(a, b) {
  const R = 6371000, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function zoneState() {
  const z = zone.get();
  if (!z) return { k: 'nozone' };
  if (geo.err === 'denied') return { k: 'denied' };
  if (geo.err === 'unsupported') return { k: 'unsupported' };
  if (!geo.fix) return { k: geo.err ? 'nofix' : 'waiting' };
  const d = distM(z, geo.fix), allow = z.radius + Math.min(geo.fix.acc, 50);
  return { k: d <= allow ? 'inside' : 'outside', d, acc: geo.fix.acc, allow, z };
}
let geoListeners = [];
function onGeo() { renderHome(); geoListeners.forEach(f => f()); }

/* ---------------- activation audio (once per placement) ---------------- */
const audio = new Audio(isIOS ? 'audio/activate.m4a' : 'audio/activate.mp3');
audio.preload = 'auto';
let placement = null; // {id, started, done}
function newPlacement() { placement = { id: Date.now(), started: false, done: false }; }
audio.addEventListener('ended', () => { if (placement) placement.done = true; $('playAgain').hidden = true; });
function unlockAudio() { // call inside a user tap
  if (placement && placement.started && !placement.done) return;
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
function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id)); if (id === 'home') renderHome(); }
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
function race(ids) { return new Promise(res => ids.forEach(id => { $(id).onclick = () => res(id); })); }
const fmtM = m => m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 1) + ' km' : Math.round(m) + ' m';

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

/* ---------------- device capability (silent prerequisite) ---------------- */
let platform = 'none', xr = null, arOK = null;
async function checkDevice() {
  if (arOK !== null) return arOK;
  let ar = false;
  if (isIOS) { platform = 'ios'; ar = document.createElement('a').relList.supports('ar'); }
  else { xr = await import('../xr.bundle.js').catch(() => null); if (xr && await xr.isSupported()) { platform = 'android'; ar = true; } }
  if (DEBUG && !ar) { platform = Q.get('debug') === 'android' ? 'android' : 'ios'; ar = true; }
  return (arOK = ar);
}
async function needCamera() {
  try { await cameraOn(); return true; }
  catch { $('homeMsg').textContent = 'Camera blocked. Allow camera access for this site (Settings › Safari › Camera) and try again.'; show('home'); return false; }
}

/* ---------------- home ---------------- */
let rooms = [], busy = false;
async function loadRooms() { rooms = await db.all().catch(() => []); }
function setupComplete() { return !!zone.get() && rooms.length > 0 && rooms.some(r => r.corner); }
function renderHome() {
  const card = $('zoneCard'), st = zoneState();
  const set = (cls, title, text, scan, setup) => {
    card.className = 'card ' + cls; $('zoneTitle').textContent = title; $('zoneText').textContent = text;
    $('scanBtn').hidden = !scan; $('setupBtn').hidden = !setup; if (setup) $('setupBtn').textContent = setup;
  };
  if (arOK === false) { set('warn', 'This browser can’t do AR', 'Open this page in Safari on iPhone/iPad, or Chrome on an ARCore Android phone.', false, null); return; }
  if (!setupComplete()) {
    const steps = [!zone.get() && 'GPS zone', !rooms.length && '3 room views', !rooms.some(r => r.corner) && 'statue corner'].filter(Boolean);
    set('', 'Set up your statue', `Stand in the room where the statue goes (your hotel room). Setup captures: ${steps.join(', ')}.`, false, 'Start setup');
    gate(1, zone.get() ? 'ok' : '', zone.get() ? 'Zone saved' : 'Not set up'); return;
  }
  switch (st.k) {
    case 'denied': set('warn', 'Location is off', 'The statue zone needs your location. Allow Location for this site (Settings › Privacy › Location Services › Safari Websites › While Using), then reload.', false, null); gate(1, 'bad', 'Location permission denied'); break;
    case 'unsupported': set('warn', 'No location on this browser', 'This browser has no GPS access, so the statue zone can’t be checked.', false, null); gate(1, 'bad', 'No geolocation'); break;
    case 'waiting': set('calm', 'Finding your location…', 'Waiting for a GPS fix. Near a window helps.', false, null); gate(1, 'run', 'Waiting for GPS fix'); break;
    case 'nofix': set('warn', 'No GPS fix yet', 'Still no location fix. Move near a window or outside for a moment; it keeps trying.', false, null); gate(1, 'run', 'No fix yet'); break;
    case 'outside': if (!busy) { gate(2, '', 'Scan when inside the zone'); $('homeMsg').textContent = ''; }
      set('calm', `Outside the statue zone (about ${fmtM(st.d)} away)`, 'Come back to the room to place the statue.', false, null);
      gate(1, 'bad', `Outside · ${fmtM(st.d)} away (allow ${fmtM(st.allow)}, ±${Math.round(st.acc)} m)`); break;
    case 'inside': set('active', 'Potential statue placement activated', 'You’re in the statue zone. Scan the room to confirm it’s the right one.', true, null);
      gate(1, 'ok', `Inside · ${fmtM(st.d)} from centre (±${Math.round(st.acc)} m)`); break;
  }
  if (!$('g3').classList.contains('run')) gate(3, rooms.some(r => r.corner) ? 'ok' : '', rooms.some(r => r.corner) ? 'Corner saved' : 'Not marked yet');
}

/* ---------------- setup ---------------- */
async function captureZone(stepText) {
  show('gpsStep'); $('gpsStepSub').textContent = stepText;
  const z = zone.saved(); $('gpsRadius').value = (z && z.radius) || 75;
  startGeo();
  const upd = () => {
    const f = geo.fix;
    if (geo.err === 'denied') { $('gpsReadout').textContent = 'Location permission denied.\nAllow Location for this site and reload.'; $('gpsUse').disabled = true; return; }
    if (!f) { $('gpsReadout').textContent = geo.err ? 'No GPS fix yet, still trying…' : 'Waiting for GPS…'; $('gpsUse').disabled = true; return; }
    $('gpsReadout').textContent = `lat ${f.lat.toFixed(6)}\nlon ${f.lon.toFixed(6)}\naccuracy ±${Math.round(f.acc)} m${f.acc > 50 ? '  (wait for it to tighten if you can)' : ''}`;
    $('gpsUse').disabled = false;
  };
  geoListeners.push(upd); upd();
  const r = await race(['gpsUse', 'gpsBack']);
  geoListeners = geoListeners.filter(f => f !== upd);
  if (r === 'gpsBack' || !geo.fix) return false;
  zone.save({ lat: geo.fix.lat, lon: geo.fix.lon, radius: parseFloat($('gpsRadius').value) || 75 });
  gate(1, 'ok', 'Zone saved'); return true;
}
async function captureRoomViews(stepText, existing) {
  show('cam'); if (!(await needCamera())) return null;
  const views = [];
  cam({ title: 'Capture 3 room views', text: `${stepText}: from where you usually stand, capture left, center and right. Aim at things that don't move (walls, windows, furniture).`,
        nameInput: true, primary: 'Capture view 1 of 3' });
  $('roomName').value = existing ? existing.name : 'Hotel room';
  while (views.length < 3) {
    const r = await race(['camPrimary', 'camBack']);
    if (r === 'camBack') return null;
    const fp = refFeatures($('video'));
    if (!fp || fp.n < 40) { $('camText').textContent = 'Not enough detail in that view. Aim at something with more texture and try again.'; continue; }
    views.push({ fp, photo: thumbnail($('video'), 320, 0.7) });
    $('camPrimary').textContent = views.length < 3 ? `Capture view ${views.length + 1} of 3` : 'Saving…';
  }
  const room = existing || { id: 'room-' + Date.now(), corner: null, created: new Date().toISOString() };
  room.name = ($('roomName').value || 'Hotel room').trim(); room.views = views;
  await db.put(room); await loadRooms();
  return room;
}
async function runSetup() {
  if (!(await checkDevice())) { renderHome(); return; }
  const need = [!zone.get() && 'zone', !rooms.length && 'room', !rooms.some(r => r.corner) && 'corner'].filter(Boolean);
  const label = i => `Setup step ${i + 1} of ${need.length}`;
  let room = rooms[0];
  for (let i = 0; i < need.length; i++) {
    if (need[i] === 'zone' && !(await captureZone(label(i)))) return;
    if (need[i] === 'room') { room = await captureRoomViews(label(i)); if (!room) return; gate(2, 'ok', 'Room views saved: ' + room.name); }
    if (need[i] === 'corner') { if (!(await markCorner(room, label(i)))) return; }
  }
  cameraOff();
  $('homeMsg').textContent = 'Setup done. When you’re in the zone, tap Scan Room to place the statue.';
}

/* ---------------- Gate 2: room match ---------------- */
async function scanRoom() {
  show('cam'); if (!(await needCamera())) return null;
  gate(2, 'run', 'Scanning…');
  for (;;) {
    cam({ title: 'Scan Room', text: 'Slowly aim around the room the way you did at setup.', meter: true });
    const res = await new Promise(resolve => {
      const views = rooms.flatMap(r => (r.views || []).map(v => ({ room: r, fp: v.fp })));
      const scores = new Map(); let i = 0, streak = 0; const t0 = Date.now();
      startLoop(() => {
        const live = liveFeatures($('video')); if (!live) return;
        for (let k = 0; k < Math.min(2, views.length); k++) { const v = views[i++ % views.length]; scores.set(v, match(live, v.fp).inliers); }
        let best = null, bs = 0; for (const [v, s] of scores) if (s > bs) { bs = s; best = v; }
        const left = Math.max(0, Math.ceil((ROOM_TIMEOUT_MS - (Date.now() - t0)) / 1000));
        setMeter(bs / ROOM_MATCH, bs >= ROOM_MATCH ? 'Room matched ✓' : `matching ${bs}/${ROOM_MATCH} · ${left}s`);
        streak = bs >= ROOM_MATCH ? streak + 1 : 0;
        if (streak >= STREAK) { stopLoop(); resolve(best.room); }
        else if (Date.now() - t0 > ROOM_TIMEOUT_MS) { stopLoop(); resolve('timeout'); }
      });
      $('camBack').onclick = () => { stopLoop(); resolve(null); };
    });
    if (res && res !== 'timeout') { gate(2, 'ok', 'Matched: ' + res.name); return res; }
    if (res === null) { gate(2, '', 'Scan when inside the zone'); return null; }
    gate(2, 'bad', 'No match');
    cam({ title: 'This isn’t the right room', text: 'The camera view doesn’t match the room you set up. Stand where you captured the room views and try again.', primary: 'Try Again' });
    const r = await race(['camPrimary', 'camBack']);
    if (r === 'camBack') return null;
  }
}

/* ---------------- corner: mark ---------------- */
async function markCorner(room, stepText) {
  gate(3, 'run', 'Mark your statue corner');
  show('cam'); if (!(await needCamera())) return false;
  cam({ title: 'Mark your statue corner', text: (stepText ? stepText + ': ' : '') + 'Aim at the corner where the statue should stand. Get the floor and both walls in view, then tap Capture Corner.', primary: 'Capture Corner' });
  for (;;) {
    const r = await race(['camPrimary', 'camBack']); if (r === 'camBack') return false;
    const fp = refFeatures($('video'));
    if (!fp || fp.n < 40) { $('camText').textContent = 'Not enough detail. Step back a little so more of the corner shows, then try again.'; continue; }
    room.corner = { fp, photo: thumbnail($('video'), 480, 0.8), markedAt: new Date().toISOString(), handle: null, fallback: null };
    break;
  }
  await db.put(room); await loadRooms();
  if (platform === 'ios') { gate(3, 'ok', 'Corner photo saved'); return true; }
  cam({ title: 'Now tap the floor in the corner', text: 'AR will open. Put the ring on the floor in your corner and tap Mark Corner. The statue appears there, locked.', primary: 'Open AR', thumb: room.corner.photo });
  const r = await race(['camPrimary', 'camBack']); if (r === 'camBack') return true;
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
        onEnd: () => { ov.hidden = true; show('home'); resolve(); } });
    } catch (e) { ov.hidden = true; $('homeMsg').textContent = 'Could not start AR: ' + e.message; show('home'); resolve(); }
  });
}

/* ---------------- corner: guide + place ---------------- */
async function placeAtCorner(room) {
  if (platform === 'android' && room.corner.handle && xr.persistentSupported()) {
    show('cam'); cam({ title: 'Restore statue', text: 'Your corner has a saved anchor. Open AR and look toward the corner.', primary: 'Open AR', thumb: room.corner.photo, alt: 'Re-mark corner' });
    const r = await race(['camPrimary', 'camAlt', 'camBack']);
    if (r === 'camBack') return; if (r === 'camAlt') { await markCorner(room); return; }
    cameraOff(); await runXR(room, 'restore'); return;
  }
  show('cam'); if (!(await needCamera())) return;
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
  if (r === 'camAlt') { const ok = await markCorner(room); if (ok && platform === 'ios') return placeAtCorner(room); return; }
  if (platform === 'ios') {
    newPlacement(); playActivation();          // same tap: start the audio, then Quick Look
    cameraOff(); openQuickLook();
    $('homeMsg').textContent = 'Quick Look: move the phone slowly, then set the statue on the floor in your corner.';
    show('home');
  } else {
    unlockAudio(); cameraOff(); await runXR(room, 'guided');
  }
}
function openQuickLook() {
  const a = document.createElement('a'); a.rel = 'ar';
  a.href = new URL('statue.usdz#allowsContentScaling=0', location.href).href;
  a.appendChild(document.createElement('img')); document.body.appendChild(a); a.click(); a.remove();
}

/* ---------------- flows ---------------- */
async function guarded(fn) {
  if (busy) return; busy = true; $('homeMsg').textContent = '';
  try { await fn(); } catch (e) { $('homeMsg').textContent = 'Something went wrong: ' + e.message; }
  finally { cameraOff(); busy = false; if ($('xr-overlay').hidden) show('home'); }
}
async function scanFlow() {
  if (zoneState().k !== 'inside') { renderHome(); return; }     // Gate 1
  if (!(await checkDevice())) return;
  const room = await scanRoom(); if (!room) return;            // Gate 2
  if (!room.corner) { const ok = await markCorner(room); if (!ok || platform === 'android') return; }
  await placeAtCorner(room);
}
$('setupBtn').onclick = () => { unlockAudio(); guarded(runSetup); };
$('scanBtn').onclick = () => { unlockAudio(); guarded(scanFlow); };

/* ---------------- settings ---------------- */
function renderSettings() {
  const z = zone.get(), st = zoneState(), f = geo.fix;
  $('setLat').value = z ? z.lat : ''; $('setLon').value = z ? z.lon : ''; $('setRad').value = z ? z.radius : 75;
  $('setReadout').textContent = (z ? `centre ${z.lat.toFixed(6)}, ${z.lon.toFixed(6)} · radius ${z.radius} m${z.override ? ' (URL override)' : ''}` : 'No zone saved') +
    '\n' + (f ? `you    ${f.lat.toFixed(6)}, ${f.lon.toFixed(6)} ±${Math.round(f.acc)} m` : `you    ${geo.err || 'waiting for GPS'}`) +
    (st.d !== undefined ? `\n${st.k.toUpperCase()} · ${fmtM(st.d)} from centre (pass ≤ ${fmtM(st.allow)})` : '');
  $('setRooms').textContent = rooms.length ? rooms.map(r => `${r.name}: ${(r.views || []).length} views · corner ${r.corner ? 'saved' : 'not marked'}`).join('\n') : 'No room saved yet.';
}
$('gear').onclick = () => { renderSettings(); show('settings'); };
$('setBack').onclick = () => show('home');
$('setSave').onclick = () => {
  const lat = parseFloat($('setLat').value), lon = parseFloat($('setLon').value), radius = parseFloat($('setRad').value) || 75;
  if (isNaN(lat) || isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { alert('Enter a valid latitude and longitude.'); return; }
  zone.save({ lat, lon, radius }); renderSettings();
};
$('setHere').onclick = () => { if (!geo.fix) { alert('No GPS fix yet.'); return; } zone.save({ lat: geo.fix.lat, lon: geo.fix.lon, radius: parseFloat($('setRad').value) || 75 }); renderSettings(); };
$('setReset').onclick = () => { if (confirm('Reset the statue zone? You’ll capture it again in setup.')) { zone.reset(); renderSettings(); } };
$('setRemark').onclick = () => { unlockAudio(); guarded(async () => {
  if (!rooms.length) { $('homeMsg').textContent = 'Set up a room first.'; return; }
  if (!(await checkDevice())) return;
  const ok = await markCorner(rooms[0]); if (ok && platform === 'ios') await placeAtCorner(rooms[0]);
}); };
$('setRoomSetup').onclick = () => { guarded(async () => { if (!(await checkDevice())) return; await captureRoomViews('Room views', rooms[0]); }); };
$('setManual').onclick = () => { unlockAudio(); guarded(async () => {   // debug/setup only: bypass Gate 2
  if (!rooms.length) { $('homeMsg').textContent = 'Set up a room first.'; return; }
  if (!(await checkDevice())) return;
  const room = rooms[0]; gate(2, 'ok', 'Skipped (settings): ' + room.name);
  if (!room.corner) { const ok = await markCorner(room); if (!ok || platform === 'android') return; }
  await placeAtCorner(room);
}); };
$('setForget').onclick = async () => { if (confirm('Forget the zone, rooms and corner on this phone?')) { zone.reset(); await db.clear(); await loadRooms(); renderSettings(); } };

/* ---------------- boot ---------------- */
(async () => {
  await loadRooms();
  await checkDevice();
  if (zone.get()) startGeo();
  renderHome();
})();
window.__statue = { db, match, liveFeatures, refFeatures, zoneState, get placement() { return placement; }, get geo() { return geo; } };
