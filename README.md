# AR Statue App

Live: https://newperspectivellc.github.io/ar-statue-app/

Puts a life-size stone statue (0.72 m plinth, 0.5 × 0.5 m block, 1.8 m tall) in a chosen corner of a room and keeps it locked there with the phone's own visual tracking.

## Flow
1. **Gate 1 · Device**: AR support (iOS AR Quick Look, or WebXR `immersive-ar` on Android) and camera access.
2. **Gate 2 · Room**: the room is recognized from a visual fingerprint (ORB features from 3 reference views, matched with RANSAC homography). First time: "Set up this room".
3. **Corner**: if no corner is saved for this room you get "Mark your statue corner".
   - **Android / WebXR**: corner photo + ORB fingerprint, then a hit-test reticle; tap to mark → `XRAnchor` (statue locked there). If the browser supports persistent anchors (`requestPersistentHandle` / `restorePersistentAnchor`) the handle is saved and later sessions restore it automatically. Chrome on Android does **not** support persistent anchors today, so it falls back to the saved corner photo guide + a new anchor each session; the fallback pose (statue yaw relative to the anchor, view distance and height) is saved too.
   - **iOS**: AR Quick Look can't take a position from a web page. Setup saves a corner reference photo + ORB features; at placement the app shows "Aim at your saved corner" with the thumbnail and a live match meter, and only enables **Place Statue Here** once the view matches. Quick Look then opens and you set the statue down in that corner (ARKit floor lock).
   - **Re-mark corner** is on the home screen and the guide screen.
4. **Activation audio** (`audio/activate.mp3`, `audio/activate.m4a`): "You have activated the statue…" ×3, played once per placement (Android: when the anchor is created; iOS: started on the Place tap, resumed on return from Quick Look if it was interrupted). Not replayed on reloads or anchor restores.

All rooms, photos, fingerprints and anchor handles are stored **only on the phone** (IndexedDB `ar-statue-app`). Nothing is uploaded.

## Build
- `build.py` (Blender 4.5) → `statue.glb`, `statue.usdz` (Y-up, meters, origin at base center). Texture from `tex.py`.
- `src/xr.js` → `xr.bundle.js`: `npx esbuild src/xr.js --bundle --format=esm --minify --outfile=xr.bundle.js` (three r187).
- `src/vision.js`: ORB via jsfeat (`vendor/jsfeat-min.js`). `?debug=ios` / `?debug=android` lets a desktop browser walk the camera flow.
