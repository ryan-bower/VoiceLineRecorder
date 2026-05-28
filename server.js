import express from "express";
import multer from "multer";
import archiver from "archiver";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

import { parseLines } from "./src/parse-lines.js";
import {
  pad,
  lineFolder,
  takeFileName,
  roomToneFileName,
  projectDir,
} from "./src/paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4321;

const app = express();
app.use(express.json({ limit: "1mb" }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

// Serve the frontend and the browser-safe shared parser module.
app.use(express.static(path.join(__dirname, "public")));
app.use("/src", express.static(path.join(__dirname, "src")));

// ---- Active session (in-memory; survives browser reloads while server runs) ----
let session = null;

const sessionFile = (dir) => path.join(dir, "session.json");
const manifestFile = (dir) => path.join(dir, "manifest.csv");

async function persistSession() {
  if (!session) return;
  session.updatedAt = new Date().toISOString();
  await fsp.writeFile(sessionFile(session.dir), JSON.stringify(session, null, 2));
  await writeManifest();
}

function csvField(v) {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function writeManifest() {
  if (!session) return;
  const header = [
    "line_number", "line_id", "line_text", "notes",
    "take_number", "filename", "duration_sec", "peak_dbfs", "recorded_at",
  ];
  const rows = [header.join(",")];
  for (const line of session.lines) {
    const takes = session.takes[line.number] || [];
    for (const t of takes) {
      rows.push([
        pad(line.number), line.id, line.text, line.notes,
        t.takeNumber, t.filename, t.durationSec, t.peakDbfs, t.recordedAt,
      ].map(csvField).join(","));
    }
  }
  for (const t of session.roomTone) {
    rows.push([
      "room-tone", "room-tone", "", "",
      t.index, t.filename, t.durationSec, t.peakDbfs, t.recordedAt,
    ].map(csvField).join(","));
  }
  await fsp.writeFile(manifestFile(session.dir), rows.join("\n") + "\n");
}

function publicSession() {
  if (!session) return { active: false };
  return {
    active: true,
    projectName: session.projectName,
    baseDir: session.baseDir,
    dir: session.dir,
    defaultAttempts: session.defaultAttempts,
    format: session.format,
    delimiter: session.delimiter,
    lines: session.lines,
    takes: session.takes,
    roomTone: session.roomTone,
  };
}

// ---- Routes ----

app.get("/api/session", (req, res) => {
  res.json(publicSession());
});

app.post("/api/session", async (req, res) => {
  try {
    const { projectName, baseDir, defaultAttempts, linesText } = req.body || {};
    if (!projectName || !baseDir || !linesText) {
      return res.status(400).json({ error: "projectName, baseDir and linesText are required." });
    }
    const parsed = parseLines(linesText);
    if (parsed.lines.length === 0) {
      return res.status(400).json({ error: "No lines found in the provided text." });
    }
    const dir = projectDir(baseDir, projectName);

    // Reopen existing project if a session.json is already there.
    let existing = null;
    try {
      existing = JSON.parse(await fsp.readFile(sessionFile(dir), "utf8"));
    } catch { /* fresh */ }

    await fsp.mkdir(path.join(dir, "lines"), { recursive: true });
    await fsp.mkdir(path.join(dir, "room-tone"), { recursive: true });
    await fsp.writeFile(path.join(dir, "source-lines.txt"), linesText);

    session = {
      projectName,
      baseDir,
      dir,
      defaultAttempts: Number(defaultAttempts) || 3,
      format: parsed.format,
      delimiter: parsed.delimiter,
      lines: parsed.lines,
      takes: existing?.takes || {},
      roomTone: existing?.roomTone || [],
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    await persistSession();
    res.json(publicSession());
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Does a project with this name+folder already exist (i.e. would resume)?
app.get("/api/session-exists", async (req, res) => {
  try {
    const { baseDir, projectName } = req.query;
    if (!baseDir || !projectName) return res.json({ exists: false });
    const dir = projectDir(String(baseDir), String(projectName));
    const existing = JSON.parse(await fsp.readFile(sessionFile(dir), "utf8"));
    const takeCount = Object.values(existing.takes || {}).reduce((a, b) => a + b.length, 0);
    res.json({ exists: true, takeCount, roomTone: (existing.roomTone || []).length });
  } catch {
    res.json({ exists: false });
  }
});

app.post("/api/takes", upload.single("audio"), async (req, res) => {
  try {
    if (!session) return res.status(409).json({ error: "No active session." });
    const lineNumber = Number(req.body.lineNumber);
    const takeNumber = Number(req.body.takeNumber);
    const line = session.lines.find((l) => l.number === lineNumber);
    if (!line) return res.status(400).json({ error: "Unknown line." });
    if (!req.file) return res.status(400).json({ error: "No audio uploaded." });

    const filename = takeFileName(line, takeNumber);
    const folder = path.join(session.dir, "lines", lineFolder(line));
    await fsp.mkdir(folder, { recursive: true });
    await fsp.writeFile(path.join(folder, filename), req.file.buffer);

    const take = {
      takeNumber,
      filename,
      relPath: path.posix.join("lines", lineFolder(line), filename),
      durationSec: Number(req.body.durationSec) || 0,
      peakDbfs: Number(req.body.peakDbfs) || 0,
      recordedAt: new Date().toISOString(),
    };
    const list = session.takes[lineNumber] || [];
    const idx = list.findIndex((t) => t.takeNumber === takeNumber);
    if (idx >= 0) list[idx] = take; else list.push(take);
    list.sort((a, b) => a.takeNumber - b.takeNumber);
    session.takes[lineNumber] = list;
    await persistSession();
    res.json({ ok: true, take });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.delete("/api/takes", async (req, res) => {
  try {
    if (!session) return res.status(409).json({ error: "No active session." });
    const lineNumber = Number(req.body.lineNumber);
    const takeNumber = Number(req.body.takeNumber);
    const line = session.lines.find((l) => l.number === lineNumber);
    const list = session.takes[lineNumber] || [];
    const take = list.find((t) => t.takeNumber === takeNumber);
    if (line && take) {
      await fsp.rm(path.join(session.dir, "lines", lineFolder(line), take.filename), { force: true });
      session.takes[lineNumber] = list.filter((t) => t.takeNumber !== takeNumber);
      await persistSession();
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/room-tone", upload.single("audio"), async (req, res) => {
  try {
    if (!session) return res.status(409).json({ error: "No active session." });
    if (!req.file) return res.status(400).json({ error: "No audio uploaded." });
    // Use max existing index + 1 so filenames never collide after a delete.
    const index = session.roomTone.reduce((m, t) => Math.max(m, t.index), 0) + 1;
    const filename = roomToneFileName(index);
    const folder = path.join(session.dir, "room-tone");
    await fsp.mkdir(folder, { recursive: true });
    await fsp.writeFile(path.join(folder, filename), req.file.buffer);
    const take = {
      index,
      filename,
      relPath: path.posix.join("room-tone", filename),
      durationSec: Number(req.body.durationSec) || 0,
      peakDbfs: Number(req.body.peakDbfs) || 0,
      recordedAt: new Date().toISOString(),
    };
    session.roomTone.push(take);
    await persistSession();
    res.json({ ok: true, take });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.delete("/api/room-tone", async (req, res) => {
  try {
    if (!session) return res.status(409).json({ error: "No active session." });
    const index = Number(req.body.index);
    const t = session.roomTone.find((x) => x.index === index);
    if (t) {
      await fsp.rm(path.join(session.dir, "room-tone", t.filename), { force: true });
      session.roomTone = session.roomTone.filter((x) => x.index !== index);
      await persistSession();
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Clear the active session so the next setup starts fresh (does not delete files).
app.post("/api/session/reset", (req, res) => {
  session = null;
  res.json({ active: false });
});

// Stream a recorded file for in-browser playback. Guarded against traversal.
app.get("/api/file", (req, res) => {
  if (!session) return res.status(409).json({ error: "No active session." });
  const rel = String(req.query.rel || "");
  const resolved = path.resolve(session.dir, rel);
  if (resolved !== session.dir && !resolved.startsWith(session.dir + path.sep)) {
    return res.status(400).json({ error: "Invalid path." });
  }
  res.sendFile(resolved, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

app.get("/api/export", (req, res) => {
  if (!session) return res.status(409).json({ error: "No active session." });
  const zipName = `${path.basename(session.dir)}.zip`;
  res.attachment(zipName);
  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.on("error", (err) => res.status(500).end(String(err)));
  archive.pipe(res);
  archive.directory(session.dir, path.basename(session.dir));
  archive.finalize();
});

// Native OS folder picker (Windows). Opens the modern Explorer-style folder
// dialog (IFileOpenDialog, same as Save As) and returns the chosen path.
app.get("/api/pick-folder", (req, res) => {
  if (process.platform !== "win32") {
    return res.status(501).json({ error: "Native picker is Windows-only — type a path manually." });
  }
  const ps1 = path.join(__dirname, "scripts", "pick-folder.ps1");
  execFile(
    "powershell.exe",
    ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", ps1],
    { windowsHide: true },
    (err, stdout) => {
      if (err) return res.status(500).json({ error: String(err.message || err) });
      const picked = (stdout || "").trim();
      if (!picked) return res.json({ canceled: true });
      res.json({ path: picked });
    }
  );
});

app.listen(PORT, () => {
  console.log(`\n  VoiceLineRecorder running:  http://localhost:${PORT}\n`);
});
