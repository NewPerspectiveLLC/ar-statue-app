# AR Statue App

Places a life-size (0.72 m plinth, 0.5 × 0.5 m block, 1.8 m total) stone statue on the real ground and keeps it locked there with the phone's own visual tracking.

- **iPhone / iPad:** Apple AR Quick Look (`statue.usdz`), ARKit floor detection + world anchoring, fixed true scale.
- **Android (ARCore):** WebXR immersive-ar with hit-test floor placement via `<model-viewer>`, falling back to Google Scene Viewer.
- **Desktop:** interactive 3D preview.

Assets built with Blender 4.5 (`build.py`), stone texture from `tex.py`. Model origin is at the base center, Y-up, meters.
