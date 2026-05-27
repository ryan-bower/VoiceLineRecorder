import { parseLines } from "/src/parse-lines.js";
import { Recorder } from "/recorder.js";
import { Meter } from "/meter.js";

const $ = (id) => document.getElementById(id);
const api = async (url, opts) => {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
};

const state = {
  chosenFolder: null,
  browsePath: null,
  linesText: null,
  session: null,        // { lines, takes, roomTone, defaultAttempts, ... }
  takes: {},            // lineNumber -> [take]
  roomTone: [],
  lineIndex: 0,
  recorder: null,
  meter: null,
  isRecording: false,
  rtTimerId: null,
};

// ---------- screen routing ----------
function show(screen) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(`screen-${screen}`).classList.add("active");
  state.current = screen;
}

// ---------- setup: folder browser ----------
async function loadFolder(p) {
  try {
    const data = await api(`/api/browse?path=${encodeURIComponent(p || "")}`);
    state.browsePath = data.path;
    $("folderCurrent").textContent = data.path;
    const list = $("folderList");
    list.innerHTML = "";
    data.dirs.forEach((d) => {
      const li = document.createElement("li");
      li.textContent = "📁 " + d.name;
      li.onclick = () => loadFolder(d.path);
      list.appendChild(li);
    });
    $("folderUp").dataset.parent = data.parent;
  } catch (e) {
    $("setupError").textContent = e.message;
  }
}

$("folderUp").onclick = () => loadFolder($("folderUp").dataset.parent);
$("folderUse").onclick = () => {
  state.chosenFolder = state.browsePath;
  $("folderChosen").textContent = "✓ Saving to: " + state.chosenFolder;
  validateSetup();
};

$("txtFile").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  state.linesText = text;
  const parsed = parseLines(text);
  $("linesPreview").innerHTML =
    `<strong>${parsed.lines.length}</strong> lines detected ` +
    `(<em>${parsed.format}</em> format)` +
    `<ol>${parsed.lines.slice(0, 5).map((l) => `<li>${escapeHtml(l.text)}</li>`).join("")}` +
    (parsed.lines.length > 5 ? "<li>…</li>" : "") + "</ol>";
  validateSetup();
};

$("projectName").oninput = validateSetup;

function validateSetup() {
  const ok = $("projectName").value.trim() && state.chosenFolder && state.linesText;
  $("toMicCheck").disabled = !ok;
}

$("toMicCheck").onclick = async () => {
  $("setupError").textContent = "";
  try {
    const data = await api("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectName: $("projectName").value.trim(),
        baseDir: state.chosenFolder,
        defaultAttempts: Number($("attempts").value) || 3,
        linesText: state.linesText,
      }),
    });
    applySession(data);
    enterMicCheck();
  } catch (e) {
    $("setupError").textContent = e.message;
  }
};

function applySession(data) {
  state.session = data;
  state.takes = {};
  for (const [k, v] of Object.entries(data.takes || {})) state.takes[Number(k)] = v;
  state.roomTone = data.roomTone || [];
  $("projectLabel").textContent = `${data.projectName} · ${data.lines.length} lines`;
}

// ---------- mic check ----------
async function enterMicCheck() {
  show("miccheck");
  try {
    if (!state.recorder) state.recorder = new Recorder();
    await state.recorder.init();
    await populateDevices();
    startMeter("micCanvas", "micBar", "micStatus");
  } catch (e) {
    $("micError").textContent = "Could not access microphone: " + e.message;
  }
}

async function populateDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const sel = $("deviceSelect");
  sel.innerHTML = "";
  devices.filter((d) => d.kind === "audioinput").forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d.deviceId;
    opt.textContent = d.label || `Microphone ${sel.length + 1}`;
    sel.appendChild(opt);
  });
}

$("deviceSelect").onchange = async () => {
  state.meter?.stop();
  state.recorder.dispose();
  state.recorder = new Recorder();
  await state.recorder.init($("deviceSelect").value);
  startMeter("micCanvas", "micBar", "micStatus");
};

$("testRecord").onclick = async () => {
  const btn = $("testRecord");
  if (!state.isRecording) {
    await state.recorder.resume();
    state.recorder.start();
    state.isRecording = true;
    btn.textContent = "■ Stop test";
    btn.classList.add("active");
  } else {
    const { blob } = state.recorder.stop();
    state.isRecording = false;
    btn.textContent = "● Test record";
    btn.classList.remove("active");
    $("testPlayback").src = URL.createObjectURL(blob);
    $("testPlayback").play();
  }
};

$("toRecord").onclick = () => enterRecord();

function startMeter(canvasId, barId, statusId) {
  state.meter?.stop();
  state.meter = new Meter({ canvas: $(canvasId), bar: $(barId), status: $(statusId) });
  state.meter.start(state.recorder.getAnalyser());
}

// ---------- record ----------
function enterRecord() {
  show("record");
  $("autoAdvance").checked = true;
  renderQueue();
  loadLine(state.lineIndex);
  startMeter("recCanvas", "recBar", "recStatus");
}

const lines = () => state.session.lines;
const attempts = () => state.session.defaultAttempts;

function renderQueue() {
  const list = $("queueList");
  list.innerHTML = "";
  let done = 0;
  lines().forEach((l, i) => {
    const takes = state.takes[l.number] || [];
    const complete = takes.length >= attempts();
    if (takes.length > 0) done++;
    const li = document.createElement("li");
    li.className = "queue-item" + (i === state.lineIndex ? " current" : "") + (complete ? " complete" : "");
    li.innerHTML =
      `<span class="q-num">${String(l.number).padStart(3, "0")}</span>` +
      `<span class="q-text">${escapeHtml(l.text)}</span>` +
      `<span class="q-status">${complete ? "✓" : takes.length ? takes.length + "/" + attempts() : ""}</span>`;
    li.onclick = () => loadLine(i);
    list.appendChild(li);
  });
  $("queueProgress").textContent = `${done}/${lines().length} started`;
}

function loadLine(i) {
  state.lineIndex = Math.max(0, Math.min(lines().length - 1, i));
  const l = lines()[state.lineIndex];
  $("lineNum").textContent = String(l.number).padStart(3, "0");
  $("lineId").textContent = l.id || "";
  $("lineText").textContent = l.text;
  $("lineNotes").textContent = l.notes || "";
  renderTakes();
  renderQueue();
}

function renderTakes() {
  const l = lines()[state.lineIndex];
  const takes = state.takes[l.number] || [];
  $("takeCounter").textContent = `Take ${takes.length + 1} of ${attempts()}`;
  const list = $("takesList");
  list.innerHTML = "";
  takes.forEach((t) => {
    const li = document.createElement("li");
    const audio = `<audio controls src="/api/file?rel=${encodeURIComponent(t.relPath)}"></audio>`;
    li.innerHTML =
      `<span class="take-name">Take ${t.takeNumber}</span>` +
      `<span class="take-peak ${t.peakDbfs >= -1 ? "hot" : t.peakDbfs < -40 ? "low" : ""}">${t.peakDbfs} dBFS</span>` +
      audio +
      `<button class="btn tiny danger" data-take="${t.takeNumber}">Delete</button>`;
    li.querySelector("button").onclick = () => deleteTake(l.number, t.takeNumber);
    list.appendChild(li);
  });
}

async function toggleRecord() {
  const btn = $("recordBtn");
  if (!state.isRecording) {
    await state.recorder.resume();
    state.recorder.start();
    state.isRecording = true;
    btn.classList.add("active");
    btn.innerHTML = "■ Stop <kbd>Space</kbd>";
  } else {
    const { blob, durationSec, peakDbfs } = state.recorder.stop();
    state.isRecording = false;
    btn.classList.remove("active");
    btn.innerHTML = "● Record <kbd>Space</kbd>";
    await uploadTake(blob, durationSec, peakDbfs);
  }
}

async function uploadTake(blob, durationSec, peakDbfs) {
  const l = lines()[state.lineIndex];
  const takeNumber = (state.takes[l.number]?.length || 0) + 1;
  const fd = new FormData();
  fd.append("audio", blob, "take.wav");
  fd.append("lineNumber", l.number);
  fd.append("takeNumber", takeNumber);
  fd.append("durationSec", durationSec.toFixed(3));
  fd.append("peakDbfs", peakDbfs);
  try {
    const data = await api("/api/takes", { method: "POST", body: fd });
    const arr = state.takes[l.number] || [];
    arr.push(data.take);
    state.takes[l.number] = arr;
    renderTakes();
    renderQueue();
    if ($("autoAdvance").checked && arr.length >= attempts() && state.lineIndex < lines().length - 1) {
      loadLine(state.lineIndex + 1);
    }
  } catch (e) {
    $("recStatus").textContent = "Save failed: " + e.message;
  }
}

async function deleteTake(lineNumber, takeNumber) {
  await api("/api/takes", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lineNumber, takeNumber }),
  });
  // Renumber remaining locally to stay in sync with server? Server keeps numbers; just drop.
  state.takes[lineNumber] = (state.takes[lineNumber] || []).filter((t) => t.takeNumber !== takeNumber);
  renderTakes();
  renderQueue();
}

$("recordBtn").onclick = toggleRecord;
$("prevLine").onclick = () => loadLine(state.lineIndex - 1);
$("nextLine").onclick = () => loadLine(state.lineIndex + 1);
$("toRoomTone").onclick = () => enterRoomTone();

// keyboard shortcuts (record screen only)
document.addEventListener("keydown", (e) => {
  if (state.current !== "record") return;
  if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
  if (e.code === "Space") { e.preventDefault(); toggleRecord(); }
  else if (e.code === "ArrowDown") { e.preventDefault(); loadLine(state.lineIndex + 1); }
  else if (e.code === "ArrowUp") { e.preventDefault(); loadLine(state.lineIndex - 1); }
  else if (e.code === "Enter") { e.preventDefault(); loadLine(state.lineIndex + 1); }
  else if (e.code === "Backspace") {
    e.preventDefault();
    const l = lines()[state.lineIndex];
    const arr = state.takes[l.number] || [];
    if (arr.length) deleteTake(l.number, arr[arr.length - 1].takeNumber);
  }
});

// ---------- room tone ----------
function enterRoomTone() {
  show("roomtone");
  renderRoomTone();
  startMeter("rtCanvas", "rtBar", "rtStatus");
}

$("rtRecordBtn").onclick = async () => {
  const btn = $("rtRecordBtn");
  if (!state.isRecording) {
    await state.recorder.resume();
    state.recorder.start();
    state.isRecording = true;
    btn.classList.add("active");
    btn.textContent = "■ Stop";
    let secs = 0;
    $("rtTimer").textContent = "0s";
    state.rtTimerId = setInterval(() => { $("rtTimer").textContent = ++secs + "s"; }, 1000);
  } else {
    clearInterval(state.rtTimerId);
    const { blob, durationSec, peakDbfs } = state.recorder.stop();
    state.isRecording = false;
    btn.classList.remove("active");
    btn.textContent = "● Record room tone";
    const fd = new FormData();
    fd.append("audio", blob, "roomtone.wav");
    fd.append("durationSec", durationSec.toFixed(3));
    fd.append("peakDbfs", peakDbfs);
    const data = await api("/api/room-tone", { method: "POST", body: fd });
    state.roomTone.push(data.take);
    renderRoomTone();
  }
};

function renderRoomTone() {
  const list = $("rtList");
  list.innerHTML = "";
  state.roomTone.forEach((t) => {
    const li = document.createElement("li");
    li.innerHTML =
      `<span class="take-name">${t.filename}</span>` +
      `<span class="muted">${t.durationSec.toFixed(1)}s</span>` +
      `<audio controls src="/api/file?rel=${encodeURIComponent(t.relPath)}"></audio>`;
    list.appendChild(li);
  });
}

$("backToRecord").onclick = () => enterRecord();
$("backToRecord2").onclick = () => enterRecord();
$("toFinish").onclick = () => enterFinish();

// ---------- finish ----------
function enterFinish() {
  show("finish");
  state.meter?.stop();
  const started = lines().filter((l) => (state.takes[l.number] || []).length).length;
  const totalTakes = Object.values(state.takes).reduce((a, b) => a + b.length, 0);
  $("summary").innerHTML =
    `<div><strong>${started}</strong> / ${lines().length} lines recorded</div>` +
    `<div><strong>${totalTakes}</strong> total takes</div>` +
    `<div><strong>${state.roomTone.length}</strong> room tone samples</div>`;
}

$("exportBtn").onclick = () => { window.location = "/api/export"; };

// ---------- boot: resume if a session is already active ----------
(async function boot() {
  try {
    const data = await api("/api/session");
    if (data.active) {
      applySession(data);
      // Need a fresh mic init after reload, so route through mic check.
      enterMicCheck();
      return;
    }
  } catch { /* ignore */ }
  loadFolder();
})();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
