// Android / WebXR path: hit-test reticle, XRAnchor lock, optional persistent anchors.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

let proto = null;
async function loadStatue() {
  if (!proto) proto = (await new GLTFLoader().loadAsync('statue.glb')).scene;
  return proto.clone(true);
}
function yawOf(m4) { // heading of +Z axis of a pose matrix (array, column-major)
  return Math.atan2(m4[8], m4[10]);
}
function shadowBlob() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  m.position.y = 0.003; m.renderOrder = -1; return m;
}
export async function isSupported() {
  try { return !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch { return false; }
}
export function persistentSupported() {
  return typeof window.XRAnchor !== 'undefined' && typeof XRAnchor.prototype.requestPersistentHandle === 'function';
}
/**
 * opts: { mode: 'mark'|'guided'|'restore', handle, yawRel, overlay, ui:{status(t), showPlace(b), onPlace(fn), onExit(fn)},
 *         onAnchored({isNew, handle, yawRel, persistent}), onEnd() }
 */
export async function start(opts) {
  const ui = opts.ui;
  const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test', 'anchors'],
    optionalFeatures: ['dom-overlay', 'light-estimation', 'local-floor'],
    domOverlay: { root: opts.overlay },
  });
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio); renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local');
  renderer.domElement.style.display = 'none'; document.body.appendChild(renderer.domElement);
  await renderer.xr.setSession(session);

  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6b6355, 1.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(1, 3, 2); scene.add(sun);
  const reticle = new THREE.Group();
  reticle.add(new THREE.Mesh(new THREE.RingGeometry(0.16, 0.2, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xd9b56b })));
  reticle.add(new THREE.Mesh(new THREE.CircleGeometry(0.025, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff })));
  reticle.matrixAutoUpdate = false; reticle.visible = false; scene.add(reticle);
  const statue = await loadStatue(); statue.add(shadowBlob());
  statue.matrixAutoUpdate = false; statue.visible = false; scene.add(statue);

  const ref = renderer.xr.getReferenceSpace();
  const viewer = await session.requestReferenceSpace('viewer');
  const hts = await session.requestHitTestSource({ space: viewer });
  let mode = opts.mode, anchor = null, lastHit = null, want = false, creating = false, yawRel = opts.yawRel || 0, lost = false;
  const P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);

  const place = () => { if (!anchor && !creating) want = true; };
  ui.onPlace(place);
  session.addEventListener('select', place);
  ui.onExit(() => session.end());

  if (mode === 'restore') {
    ui.showPlace(false); ui.status('Restoring your saved corner…');
    try {
      if (typeof session.restorePersistentAnchor !== 'function') throw new Error('no persistent anchors');
      anchor = await session.restorePersistentAnchor(opts.handle);
      ui.status('Statue restored at your corner. Locked.');
      opts.onAnchored({ isNew: false, handle: opts.handle, yawRel, persistent: true });
    } catch (e) {
      mode = 'guided'; ui.showPlace(true);
      ui.status('Saved anchor not available. Aim the ring at your corner and tap Place Statue Here.');
    }
  } else {
    ui.showPlace(true);
    ui.status(mode === 'mark' ? 'Move the phone slowly. Put the ring on the floor in your corner, then tap Mark Corner.'
                              : 'Put the ring on the floor in your corner, then tap Place Statue Here.');
  }

  renderer.setAnimationLoop((t, frame) => {
    if (!frame) return;
    if (!anchor) {
      const hits = frame.getHitTestResults(hts);
      if (hits.length) { lastHit = hits[0]; const p = lastHit.getPose(ref); reticle.matrix.fromArray(p.transform.matrix); reticle.visible = true; }
      else reticle.visible = false;
      if (want && lastHit && !creating) {
        want = false; creating = true;
        const vp = frame.getViewerPose(ref), hp = lastHit.getPose(ref);
        const cam = vp.transform.position, hpos = hp.transform.position;
        const yawWorld = Math.atan2(cam.x - hpos.x, cam.z - hpos.z); // statue front faces you
        const viewDist = Math.hypot(cam.x - hpos.x, cam.z - hpos.z), viewHeight = cam.y - hpos.y;
        lastHit.createAnchor().then(async a => {
          anchor = a;
          let handle = null;
          if (typeof a.requestPersistentHandle === 'function') { try { handle = await a.requestPersistentHandle(); } catch {} }
          a._yawWorld = yawWorld;
          ui.showPlace(false); ui.status('Statue locked to the floor. Walk around it.');
          opts.onAnchored({ isNew: true, handle, yawRel: null, viewDist, viewHeight, persistent: !!handle });
        }).catch(() => { creating = false; ui.status('Could not lock there. Move slowly and try again.'); });
      }
    } else {
      reticle.visible = false;
      const ap = frame.getPose(anchor.anchorSpace, ref);
      if (ap) {
        const m = ap.transform.matrix, aYaw = yawOf(m);
        if (anchor._yawWorld !== undefined && opts._yawRelSet !== true) { yawRel = anchor._yawWorld - aYaw; opts._yawRelSet = true; opts.onYawRel && opts.onYawRel(yawRel); }
        P.set(m[12], m[13], m[14]); Q.setFromAxisAngle(Y, aYaw + yawRel);
        statue.matrix.compose(P, Q, S); statue.visible = true;
        if (lost) { lost = false; ui.status('Statue locked to the floor. Walk around it.'); }
      } else if (!lost) { lost = true; ui.status('Tracking lost. Point back at the corner and move slowly.'); }
    }
    renderer.render(scene, camera);
  });

  session.addEventListener('end', () => {
    renderer.setAnimationLoop(null);
    try { hts.cancel(); } catch {}
    renderer.dispose(); renderer.domElement.remove();
    opts.onEnd && opts.onEnd();
  });
  return session;
}
