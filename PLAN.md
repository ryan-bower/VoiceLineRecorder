# VoiceLineRecorder — Implementation Plan

## Context

A tool to send to voice actors so they can record line lists with minimal friction. The artist loads a `.txt` of lines, records each one (easy retries, multiple takes per line), sees a live level/waveform so they don't record too quiet or clipping, captures room tone, and the recordings land on disk in an organized structure — exported as a zip at the end. The tool must be dead-simple for a non-technical recording artist.

### Decisions locked in

| Area | Decision |
| --- | --- |
| **Platform** | Node web app the artist runs locally (`npm start`, opens `http://localhost:PORT`). |
| **Storage** | WAVs written to disk **live, server-side** by Node into a folder chosen once at session start. Works in every browser; no File System Access API dependency. |
| **Input format** | Auto-detect **plain** (one line per row) vs **structured** (delimited: ID / text / notes). |
| **Ergonomics** | Keyboard shortcuts, per-take playback & delete, mic level test, `manifest.csv`. |
| **Delivery** | Out of scope to build — use a third-party transfer service (see below). |
| **Distribution** | The recording artist **clones the repo and runs it locally** themselves. Install must be trivial (`npm install && npm start`) with **few dependencies** — no build step, no global tooling, no native modules. |

> Pre-roll countdown and "preferred take" marking are intentionally left out for now — easy to add later.

---

## Architecture

A local Node server (Express) serves a vanilla-JS browser frontend. The browser captures mic audio via the Web Audio API, encodes **lossless WAV** client-side (MediaRecorder only produces compressed audio, so we capture raw PCM and encode ourselves), then POSTs each take to Node, which writes it to the chosen output folder. Session progress is persisted to `session.json` on disk for crash recovery.

```
Browser (Web Audio capture + WAV encode + waveform/meter UI)
   │  POST /api/takes  (WAV bytes + metadata)
   ▼
Node/Express (static serving + disk writes + zip export)
   │
   ▼
<OutputFolder>/<ProjectName>/   ← organized recordings on disk
```

No build step (plain ES modules served statically) so it runs with a single `npm install && npm start`. The recording artist is expected to clone this repo and run it on their own machine, so setup must stay trivial: only a handful of well-known npm dependencies, no global installs, no native/compiled modules, and a README with copy-paste clone/install/run steps.

### Tech stack

- **Backend:** Node + Express. Deps: `express`, `multer` (multipart take uploads), `archiver` (zip export). Keep dependency count low.
- **Frontend:** vanilla JS (ES modules), no framework, no bundler.
- **Audio:** `getUserMedia` + AudioContext; `AudioWorkletNode` (with `ScriptProcessorNode` fallback) to capture raw Float32 PCM; custom WAV encoder (48 kHz, 24-bit PCM default, configurable). `AnalyserNode` for live waveform + peak meter.

---

## Source layout

```
VoiceLineRecorder/
  package.json
  server.js                 # Express app, routes, disk writes, zip
  src/
    parse-lines.js          # plain/structured txt auto-detect parser (shared)
    paths.js                # naming + folder-structure helpers
  public/
    index.html
    app.js                  # main UI state machine
    recorder.js             # mic capture + WAV encode
    meter.js                # waveform + peak/clip/too-quiet meter
    styles.css
```

## Output folder structure (on the artist's disk)

```
<OutputFolder>/<ProjectName>/
  lines/
    001/  001_take1.wav  001_take2.wav  001_take3.wav
    002/  002_take1.wav  ...
  room-tone/  room-tone_001.wav  ...
  source-lines.txt          # copy of the uploaded list
  manifest.csv              # one row per take (see below)
  session.json              # progress state for resume/crash recovery
```

- **Naming:** `NNN_take{n}.wav`, where `NNN` is the zero-padded line number. If a line has a structured ID, include a slug: `NNN_<id-slug>_take{n}.wav`.
- **manifest.csv columns:** `line_number, line_id, line_text, notes, take_number, filename, duration_sec, peak_dbfs, recorded_at`.

---

## Backend endpoints (`server.js`)

| Method & path | Purpose |
| --- | --- |
| `POST /api/session` | Set ProjectName, output folder path, default attempts (3); create folder structure, write `source-lines.txt`, return parsed lines + any existing progress. |
| `GET /api/session` | Return current session + progress (for reload/resume). |
| `POST /api/takes` | Multipart: WAV blob + `{lineNumber, takeNumber, peakDbfs, durationSec}`. Write file, update `manifest.csv` + `session.json`. |
| `DELETE /api/takes` | `{lineNumber, takeNumber}` — delete a take file, update manifest/session. |
| `POST /api/room-tone` | Same as takes but into `room-tone/`. |
| `POST /api/export` | Build zip of `<ProjectName>/` with `archiver`, stream as download. |
| `GET /api/browse?path=` | List subdirectories so the artist can click-navigate to an output folder. |

Output-folder choice is made **once** on the setup screen (default `./recordings`) and reused for the whole session.

---

## Frontend flow (`public/app.js`)

1. **Setup screen** — project name, pick output folder, drop/upload `.txt`, set default attempts (3). Parser auto-detects plain vs structured and previews the parsed lines.
2. **Mic check screen** — choose input device (`enumerateDevices`), live meter + waveform, a test record/playback. "Start session" when happy.
3. **Recording screen**
   - **Left:** scrollable line queue with status (not started / N takes done / complete ✓).
   - **Center:** current line text (+ notes if structured), large Record/Stop button, live waveform + peak meter (green/amber/red; warns on clipping near 0 dBFS and on too-quiet below ~−40 dBFS).
   - **Takes list:** each take has play & delete; shows "take 2 of 3".
   - **Keyboard shortcuts:** `Space` = record/stop, `↑/↓` = move between lines, `Enter` = next line, `Backspace` = delete last take.
   - Optional auto-advance after reaching the attempt count.
4. **Room tone screen** — record N seconds of ambient silence (one or more samples) into `room-tone/`.
5. **Finish screen** — summary (lines done, total takes), Export zip button, and a delivery step (below).

## Lossless WAV capture (`public/recorder.js`)

- `getUserMedia({audio:{deviceId, echoCancellation:false, noiseSuppression:false, autoGainControl:false}})` — disable browser DSP to get the raw mic signal.
- AudioWorklet collects Float32 PCM frames; on stop, concatenate and encode to a WAV (RIFF header + 24-bit PCM, 48 kHz). Compute peak dBFS for the manifest and the too-quiet/clip warnings.
- ScriptProcessorNode fallback for browsers without AudioWorklet.

## Line parsing (`src/parse-lines.js`)

- If lines contain a consistent delimiter (tab or `|`), treat as **structured**: `[id?]<delim>text<delim>[notes?]`. Otherwise **plain**: each non-empty row is auto-numbered `001…`.
- Skip blank lines and `#` comments. Same module used to preview client-side and validate server-side.

---

## Delivery / file transfer (not built — uses an existing service)

The app produces a single zip; getting it back to you is handled by a third-party service, not custom code.

- **Dropbox File Request** *(best for recurring)* — artist uploads the zip straight into your Dropbox with no account; you control the destination.
- **Google Drive shared folder** — similar, if you're already in Google (artist needs a Google account).
- **WeTransfer / Smash** *(zero-setup one-offs)* — artist drops the zip, emails a link. WeTransfer free = 2 GB; Smash = no hard cap.
- **MASV** — pay-per-GB, industry standard for multi-GB media.

Lossless sessions can run hundreds of MB to a few GB, so free 2 GB tiers may not suffice — Dropbox/Drive scale better. The finish screen shows a configurable "Send it to me" instruction/link pointing at whichever service you pick. No upload logic in the app.

---

## Implementation order

1. `package.json` + Express skeleton serving `public/`, `npm start`.
2. `parse-lines.js` + setup screen (upload, parse, preview, folder pick, session create on disk).
3. `recorder.js` WAV capture + `meter.js` waveform/peak meter; mic-check screen.
4. Recording screen: queue, takes, record/stop, `POST /api/takes`, delete, keyboard shortcuts.
5. Room tone screen.
6. `manifest.csv` + `session.json` writing and resume-on-reload.
7. Zip export (`archiver`).
8. Styling pass for a clean, friction-free artist UX.

## Verification

- `npm install && npm start`, open the app; load a sample plain `.txt` and a structured one — confirm both parse/preview correctly.
- Mic check: confirm device list, live meter moves, clip warning triggers when loud, too-quiet warning when silent.
- Record several lines × multiple takes; confirm WAVs appear under `lines/NNN/` with correct names, are valid 48 kHz/24-bit (open in Audacity), and play back losslessly.
- Delete a take → file removed and manifest updated. Reload mid-session → progress restored from `session.json`.
- Record room tone → lands in `room-tone/`. Export zip → contains full structure + `manifest.csv`.
