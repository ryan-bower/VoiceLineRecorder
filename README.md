# VoiceLineRecorder

A simple local web app for voice actors to record a list of lines into organized, lossless WAV files. Load a `.txt` of lines, record each one with easy retries and multiple takes, watch a live level meter so you never record too quiet or clipping, capture room tone, and export everything as a single zip.

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer (includes `npm`)
- A modern browser (Chrome, Edge, or Firefox)
- A microphone

## Setup

```bash
git clone <repo-url>
cd VoiceLineRecorder
npm install
npm start
```

Then open **http://localhost:4321** in your browser.

There is no build step and only three well-known dependencies — `npm install` is all that's needed.

## How to use

1. **Setup** — give the project a name, choose an output folder, drop in your line-list `.txt`, and set how many takes per line (default 3).
2. **Mic check** — pick your input device and confirm the level meter responds before you start.
3. **Record** — for each line, press Record (or Spacebar), deliver the line, press Stop. Re-record or delete bad takes. Move between lines with the arrow keys.
4. **Room tone** — record a few seconds of silence so the ambient room noise is captured.
5. **Finish** — export a zip of all recordings and send it back using the agreed delivery method.

## Line-list format

Plain — one line of dialogue per row:

```
Hello there, traveler.
Watch your step.
```

Or structured (tab- or pipe-separated): `id | text | notes`

```
GREETING | Hello there, traveler. | warm, welcoming
WARNING  | Watch your step.        | urgent
```

Blank lines and lines starting with `#` are ignored. Lines are auto-numbered either way.

## Output

```
<OutputFolder>/<ProjectName>/
  lines/001/001_take1.wav ...
  room-tone/room-tone_001.wav ...
  source-lines.txt
  manifest.csv
  session.json
```

Recordings are 48 kHz / 24-bit PCM WAV. `manifest.csv` maps every file to its line text, take number, duration, and peak level.
