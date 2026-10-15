# Mole Counter

Mole Counter counts and measures the moles on one body segment at two visits and shows which grew, shrank, appeared or went. It runs in the browser as an installable web app on a phone, an iPad or a computer. No file uploaded.

## Using it

Do these four steps on the Last visit tab, then again on the This visit tab.

1. **Photo.** Choose the photo. On a phone or iPad the same button can take one with the camera.
2. **Scale.** Pick Ruler and tap two marks on a ruler lying on the skin, then type the distance between them. Or pick Landmarks and type the distance between landmarks 1 and 2. This visit takes that distance from the last visit unless you type your own.
3. **Landmarks.** A face photo gets 6 landmarks as soon as it loads: both inner eye corners, both outer eye corners, between the eyes and under the nose. Other segments need none since Compare lines the photos up on the moles themselves when a photo has no landmarks. To add your own, tap fixed points with the Landmark tool, such as ink dots, the nipples or a scar, in the same order on both photos. A third landmark lets the program check the alignment.
4. **Moles.** Press Find moles. Remove freckles, hairs and shadows with Remove mole and tap missed moles with Add mole. A spot under a landmark is skipped.

The Compare tab lines this visit up on the last one through the landmarks, or through the moles when there are none, and pairs each mole with the nearest one within the match distance. Every mole is listed as Same, Grown, Shrunk, New, Gone or Not in frame, with its longest diameter at both visits. Any mole over 6 mm is flagged. Tap a row to zoom to that mole.

Export CSV saves the table. Save marked photos saves both photos with the numbered marks.

## Getting good numbers

- Keep a ruler or a 1 cm calibration sticker on the skin in every photo since it sets millimetres more accurately than landmarks do. A landmark distance changes when the patient gains weight or grows, and every mole then reads as larger.
- Shoot straight at the skin under the same light each visit. A lighting change moves the edge of a mole and changes its measured size.
- Before trusting the Growth flag, take two photos of the same segment a few minutes apart and compare them. Set the Growth flag above the change those two give.

## Controls

- Drag to move the photo. Pinch or scroll to zoom.
- Drag a ruler mark or a landmark to move it while its tool is on.
- Undo steps back one change on the photo you are on.

## Running it

There is nothing to build. Serve the folder over HTTPS (GitHub Pages works) and open `index.html`. For local testing, run `python -m http.server` in the folder and open `http://localhost:8000`.

## Files

- `index.html`, `styles.css`, `app.js`: the app
- `moles.js`: finding, measuring and matching moles, shared with the tests
- `sw.js`, `manifest.json`: offline use and installing it to the home screen. The face detector (MediaPipe 0.10.18, the build Cygnus Measure uses) downloads from jsDelivr and Google the first time and is kept for offline use after that.
- `icons/`: Cygnus Solutions icons from Camera Overlay
- `tests/`: `node tests/core.test.js` checks the detector on made-up skin with moles of known size. `tests/sample` holds two made-up photos to try the app with, made by `python tests/make_photos.py tests/sample`. `node tests/flow.test.js` runs both visits through the app in Chromium with a server on port 8765.
- `PLAN.md`: the build order up to full body

Cygnus Solutions
