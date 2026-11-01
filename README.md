# AR Statue App

Live: https://newperspectivellc.github.io/ar-statue-app/

Puts a life-size stone statue (0.72 m plinth, 0.5 × 0.5 m block, 1.8 m tall) in a chosen corner of a room and keeps it locked there with the phone's own visual tracking.

## Flow
**First run (setup):** 1) capture the GPS zone (current fix = centre, radius 75 m default), 2) capture 3 room views, 3) mark the statue corner.

**Every time after:**
- **Gate 1 · GPS geofence**: `watchPosition` (high accuracy). Pass if distance ≤ radius + min(accuracy, 50 m). Outside: calm "Outside the statue zone (about N m away)", no scan button. Inside: "Potential statue placement activated" + **Scan Room**. Permission denied / no fix show a clear message.
- **Gate 2 · Camera room match**: ORB features vs the 3 saved views (RANSAC homography). No match after 25 s → "This isn't the right room" + Try Again.
- **Corner guide → Place Statue Here** (below). The device AR check runs silently.
- **Settings (⚙︎)**: view/edit lat/lon/radius, use current location, reset zone, re-mark corner, re-capture room views, skip room match (setup/debug only), forget everything. URL params `?lat=&lon=&radius=` override the zone for that visit only.

**Corner placement**
- **Android / WebXR**: corner photo + ORB fingerprint, then a hit-test reticle; tap to mark → `XRAnchor` (statue locked there). If the browser supports persistent anchors (`requestPersistentHandle` / `restorePersistentAnchor`) the handle is saved and later sessions restore it automatically. Chrome on Android does **not** support persistent anchors today, so it falls back to the corner photo guide + a new anchor each session; the fallback pose (yaw relative to the anchor, view distance/height) is saved too.
- **iOS**: AR Quick Look can't take a position from a web page. The guide shows "Aim at your saved corner" with the thumbnail and a live match meter and only enables **Place Statue Here** once the view matches; Quick Look then opens and you set the statue down in that corner (ARKit floor lock).

**Activation audio** (`audio/activate.mp3`, `audio/activate.m4a`): "You have activated the statue…" ×3, once per placement (Android: on anchor creation; iOS: started on the Place tap, resumed on return from Quick Look if interrupted). Not replayed on reloads or anchor restores.

The GPS zone (localStorage `ar-statue-zone`), rooms, photos, fingerprints and anchor handles are stored **only on the phone** (IndexedDB `ar-statue-app`). Nothing is uploaded.

## Build
- `build.py` (Blender 4.5) → `statue.glb`, `statue.usdz` (Y-up, meters, origin at base center). Texture from `tex.py`.
- `src/xr.js` → `xr.bundle.js`: `npx esbuild src/xr.js --bundle --format=esm --minify --outfile=xr.bundle.js` (three r187).
- `src/vision.js`: ORB via jsfeat (`vendor/jsfeat-min.js`). `?debug=ios` / `?debug=android` lets a desktop browser walk the camera flow.

## Shared sites (program a location once, visitors get it ready-made)

**Creator (Matt):** Settings ⚙︎ › *Create shared site* (or open `…/ar-statue-app/?admin=1`).
1. Name the site, tap **Capture site here**: GPS zone (pick radius) → 4 room views (left, centre, right, doorway) → the statue corner (2 photos from slightly different spots).
   Or tap **Use my current setup instead** to turn the personal setup on this phone into a site.
2. Enter the admin passphrase → **Publish site**. You get the share link: `https://newperspectivellc.github.io/ar-statue-app/?site=<id>`.
   Re-capturing later can update the same link.
3. **Export package (.json)** is the offline fallback: send the file, and it gets committed to `sites/<id>.json`.

**Visitor:** opens `?site=<id>`. No setup: GPS gate → *Potential statue placement activated* → Scan Room → corner guide → Place → audio.
Visitors can't edit the site; their phone stores only its own AR anchor for that site.

**Server:** `server/` = the Vercel function deployed as `ar-statue-sites.vercel.app/api/sites` (GET is public; POST needs the
`x-admin-passphrase` header to match the server-side `ADMIN_PASSPHRASE` env var). Packages are stored in Vercel Blob. No secrets are in this repo.

**Public in a published package:** site name, GPS zone centre + radius, ORB fingerprints of the room views and corner,
and small thumbnails (160 px room views, 360 px corner photo). Nothing else.
