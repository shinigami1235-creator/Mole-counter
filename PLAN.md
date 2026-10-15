# Mole Counter

Mole Counter counts and measures the moles on a patient's skin and compares each visit with the one before. It reports which moles grew or shrank, which are new and which are gone. My teacher recommended it as a dermatology tool. It starts with one body segment at a time and works up to the full body.

## Why segments first

A phone photo is about 4000 pixels across. A photo of the whole upper back (about 50 cm wide) gives 8 pixels per millimetre, so a 2 mm mole is 16 pixels wide and a 0.5 mm change is 4 pixels. A full-body photo spreads the same 4000 pixels over 180 cm, which is about 2 pixels per millimetre, so a 2 mm mole is 4 pixels wide. Four pixels is enough to count a mole and too little to measure it.

Full-body photos will be the overview map for counting and finding new moles while the segment photos carry the size measurements.

## Measuring size

There are two ways to set the scale on a photo.

1. **Ruler in the frame.** Stick a paper ruler or a 1 cm calibration sticker on the skin next to the moles and click two marks on it. The program works out millimetres per pixel from that. It is the more accurate method since the ruler lies on the skin itself.
2. **Two fixed points.** Measure the distance between two landmarks with a tape (two ink dots, the two nipples, the C7 spine to the tip of a shoulder blade) and type it in.

Without a ruler, the next visit uses the same two landmarks to scale the new photo to the old one, correcting for the camera standing closer or further away. It assumes the landmarks stayed the same distance apart. Weight gain or a growing child stretches the skin and reads as every mole growing, so a ruler in the frame is the method for millimetres while the landmark ratio is enough for counting and matching.

## Finding moles

The program marks every spot darker than the skin around it and numbers each one. The doctor removes false marks (freckles, hair, scars, shadows) and adds any it missed. Hair is the usual false mark, so shave or part it before the photo where possible.

## Matching moles between visits

The doctor clicks the same landmarks on both photos. Two landmarks line the photos up for size, rotation and position. A third gives a check on how well they agree, and four or more also correct the skew from a slightly tilted camera.

After lining up, each mole on the new photo is paired with the nearest mole from the last visit within 3 mm.

- A mole with no partner from the last visit is **new**.
- A mole from the last visit with no partner is **gone** if its spot is inside the new photo, and **not in frame** if it is outside.

## Readings per mole

- Longest diameter in mm
- Area in mm²
- Change since the last visit in mm and per cent
- A flag when the diameter is over 6 mm, the D in ABCDE
- A flag when growth is over a threshold the doctor sets

Before trusting the growth flag, take two photos of the same segment a few minutes apart and compare them. The difference between those two is the measurement error, and any growth smaller than it means nothing.

## Camera Overlay

The follow-up photo uses the Camera Overlay ghost. The segment's photo from the last visit shows over the live camera, and the photo is taken once the outline lines up. The Tilt and Lighting badges matter here since a lighting change moves the edge of a mole and changes its measured size.

Mole Counter stays its own app with the Camera Overlay ghost as a feature the doctor turns on. With it on, one visit runs in one app: pick the patient, pick the segment, line up the ghost, take the photo, check the marks, read the comparison. Camera Overlay stays its own app as well.

## Segments

Face, neck front, neck back, chest, abdomen, upper back, lower back, left and right upper arm (front and back), left and right forearm (front and back), left and right hand, left and right thigh (front and back), left and right lower leg (front and back), left and right foot. The doctor picks a segment from a body map.

## Build order

1. **Test run on one segment.** Built. Two photos picked from the gallery or taken with the phone's own camera. Set the scale, find the moles, edit the marks, line up the photos by landmarks and read the comparison.
2. **Visits.** The Camera Overlay ghost camera as a setting, patients and visits saved on the device, and the body map with segments.
3. **Automatic lining up.** Face landmarks and lining up on the moles are built. ABCDE flags and a PDF report per visit are still to come.
4. **Full body.** A standard set of poses covering the whole body, with each segment photo placed on the body map.

## Stack

An installable browser app like Camera Overlay, hosted on GitHub Pages. Patient photos are saved in the browser on the device. OpenCV.js does the automatic lining up in step 3.

Next step is testing step 1 on real photos with a ruler sticker before building step 2.
