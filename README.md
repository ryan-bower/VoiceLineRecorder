# Voice Actor Studio

A simple local web app for voice actors to record a list of lines into organized, lossless WAV files. Load a `.txt` of lines, record each one with easy retries and multiple takes, watch a live level meter so you never record too quiet or clipping, capture room tone, and export everything as a single zip.

You run it on your own computer — nothing is uploaded anywhere, and your recordings stay in a folder you choose.

## Requirements

- [Node.js](https://nodejs.org/) **18 or newer** (the installer includes `npm`). Download the "LTS" version and accept the defaults.
- A modern browser — **Chrome or Edge recommended** (the native folder picker is Windows-only; Firefox works but you'll type the output path by hand).
- A microphone.

## Install & run

**1. Get the code** — either:

- Clone it with git:
  ```bash
  git clone https://github.com/ryan-bower/VoiceLineRecorder.git
  cd VoiceLineRecorder
  ```
- …or, if you don't use git: on the GitHub page click the green **Code ▾** button → **Download ZIP**, unzip it, and open that folder.

**2. Install dependencies** (run once, from inside the project folder):

```bash
npm install
```

**3. Start the app:**

```bash
npm start
```

**4. Open it** — go to **http://localhost:4321** in your browser.

That's it. There's no build step and only three small, well-known dependencies. To stop the app, press `Ctrl+C` in the terminal; to run it again later just `npm start` from the project folder.

> **Windows tip:** open the project folder, then in the address bar type `cmd` and press Enter to get a terminal already pointed at the right folder. Or use PowerShell / Windows Terminal.

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
