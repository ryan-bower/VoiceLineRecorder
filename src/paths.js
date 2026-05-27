// Naming + folder-structure helpers, shared by server and client.
import path from "node:path";

export function pad(n, width = 3) {
  return String(n).padStart(width, "0");
}

export function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// Folder for a line's takes, e.g. "001".
export function lineFolder(line) {
  return pad(line.number);
}

// Take filename, e.g. "001_take1.wav" or "001_greeting_take1.wav".
export function takeFileName(line, takeNumber) {
  const slug = line.id ? `_${slugify(line.id)}` : "";
  return `${pad(line.number)}${slug}_take${takeNumber}.wav`;
}

export function roomToneFileName(index) {
  return `room-tone_${pad(index)}.wav`;
}

// Sanitize a project name for use as a folder.
export function projectFolderName(name) {
  const cleaned = String(name).trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
  return cleaned || "VoiceLines";
}

// Resolve the absolute project directory under a chosen base output folder.
export function projectDir(baseDir, projectName) {
  return path.join(baseDir, projectFolderName(projectName));
}
