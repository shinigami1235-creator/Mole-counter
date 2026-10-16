# Mole Counter

Mole Counter counts and measures the moles on one body segment at two visits and shows which grew, shrank, appeared or went. It runs in the browser as an installable web app on a phone, an iPad or a computer. No file uploaded.

## Using it

Do these steps on the Last visit tab, then again on the This visit tab.

1. **Photo.** Choose the photo. On a phone or iPad the same button can take one with the camera. The view zooms in on the face or the skin as soon as it is found.
2. **Area.** Moles are only looked for inside the area and everything outside its outer edge is dimmed. A face photo uses the face from the face map, carried up the forehead to the hairline, and the eyes, brows, lips and nostrils inside it are skipped without being drawn. Other photos use the skin, from MediaPipe's person finder, or from skin colour when the person finder sees no one. To fix the area, drag over the photo with the Area tool: Add paints skin in and Erase takes it out. Whole photo turns the area off.
3. **Scale.** Estimate is the default. A face is measured against the iris, which is 11.7 mm wide in adults. Without a face the photo is taken as 300 mm across, which is rough. Pick Ruler for true sizes and drag the two marks onto a ruler on the skin, or pick Landmarks and type the distance between landmarks 1 and 2. On this visit Compare replaces an estimate with the last visit's scale, carried across by the alignment.
4. **Landmarks.** A face photo gets 6 landmarks as soon as it loads: both inner eye corners, both outer eye corners, between the eyes and under the nose. Other segments need none since Compare lines the photos up on the moles themselves when a photo has no landmarks. To add your own, tap fixed points with the Landmark tool, such as ink dots, the nipples or a scar, in the same order on both photos. A third landmark lets the program check the alignment.
5. **Moles.** Moles are found as soon as the area and scale are set, and Find moles runs it again. Each photo is searched twice, once against the skin over about 15 mm for larger moles and once against the skin within 3 mm for small faint spots. On this visit every spot where the last visit had a mole is searched again, so a faint mole added by hand last time is found where it was. Spots on the edge of the area are skipped since they are usually shadow along the jaw, hairline or body outline. Previous and Next zoom in on each mole in turn and Remove drops the one on screen. Tap missed moles with Add mole.

The Compare tab lines this visit up on the last one through the landmarks, or through the moles when there are none, and pairs each mole with the nearest one within the match distance. On a face, each mole is carried between the photos by the 12 nearest face-map points, which follows a turned head or a smile. Every mole is listed as Same, Grown, Shrunk, New, Gone, Faint or Not in frame, with its longest diameter at both visits. Faint is a spot on one photo only that is less than 18% darker than the skin: on two photos of one face taken 90 minutes apart, every unpaired spot under that was a fold, a pore or a hair edge, and every real mole paired up. Any mole over 6 mm is flagged. Tap a row to zoom to that mole.

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
- `sw.js`, `manifest.json`: offline use and installing it to the home screen. The face map and the person finder (MediaPipe 0.10.18, the build Cygnus Measure uses) download from jsDelivr and Google the first time and are kept for offline use after that.
- `icons/`: Cygnus Solutions icons from Camera Overlay
- `tests/`: `node tests/core.test.js` checks the detector on made-up skin with moles of known size. `tests/sample` holds two made-up photos to try the app with, made by `python tests/make_photos.py tests/sample`. `node tests/flow.test.js` runs both visits through the app in Chromium with a server on port 8765.
- `PLAN.md`: the build order up to full body

Cygnus Solutions
