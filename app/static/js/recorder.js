let mediaRecorder;
let chunks = [];
let recordedBlob = null;
let timerInterval = null;
let startTime = null;

// --- Buttons / UI ---
const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const btnPredict = document.getElementById("btnPredict");
const btnReset = document.getElementById("btnReset");

const player = document.getElementById("player");
const statusText = document.getElementById("statusText");
const timerText = document.getElementById("timerText");
const scoreBox = document.getElementById("scoreBox");
const scoreNote = document.getElementById("scoreNote");
const debugBox = document.getElementById("debugBox"); // may not exist; guarded below

// Transcript UI refs
const transcriptBox = document.getElementById("transcriptBox");
const asrMeta = document.getElementById("asrMeta");

// Corrected + Issues UI
const correctedBox = document.getElementById("correctedBox");
const issuesBox = document.getElementById("issuesBox");

// TTS UI
const btnTts = document.getElementById("btnTts");
const ttsPlayer = document.getElementById("ttsPlayer");

// Upload UI
const fileInput = document.getElementById("fileInput");
const btnClearFile = document.getElementById("btnClearFile");

// -----------------------
// Small utilities
// -----------------------
function setStatus(msg) {
  if (statusText) statusText.textContent = "Status: " + msg;
}

function formatTime(ms) {
  const sec = Math.floor(ms / 1000);
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function startTimer() {
  startTime = Date.now();
  if (timerText) timerText.textContent = "00:00";
  timerInterval = setInterval(() => {
    if (timerText) timerText.textContent = formatTime(Date.now() - startTime);
  }, 250);
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

// escape HTML so we can safely inject spans
function escapeHtml(s) {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Highlight error spans in a text using LanguageTool offsets
function highlightText(text, matches) {
  if (!text) return "—";
  if (!Array.isArray(matches) || matches.length === 0) return escapeHtml(text);

  const sorted = [...matches].sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0));

  let out = "";
  let cursor = 0;

  for (const m of sorted) {
    const off = m.offset ?? 0;
    const len = m.length ?? 0;
    if (len <= 0) continue;
    if (off < cursor) continue; // skip overlapping

    out += escapeHtml(text.slice(cursor, off));

    const bad = text.slice(off, off + len);
    const tooltip = escapeHtml(m.message || "Issue");
    out += `<span class="hl-bad" title="${tooltip}">${escapeHtml(bad)}</span>`;

    cursor = off + len;
  }

  out += escapeHtml(text.slice(cursor));
  return out;
}

// ✅ Issues renderer (Rule removed)
function renderIssues(matches) {
  if (!Array.isArray(matches) || matches.length === 0) {
    return "No issues detected ✅";
  }

  const items = matches.slice(0, 15).map((m, i) => {
    const msg = m.message || "Issue";
    const rep = (m.replacements && m.replacements.length) ? m.replacements[0].value : "";
    const ctx = (m.context && m.context.text) ? m.context.text : "";

    return `
      <div class="issue-item">
        <div class="issue-title">${i + 1}. ${escapeHtml(msg)}</div>
        <div class="issue-meta">
          ${rep ? `<div><b>Suggestion:</b> ${escapeHtml(rep)}</div>` : ""}
          ${ctx ? `<div><b>Context:</b> ${escapeHtml(ctx)}</div>` : ""}
        </div>
      </div>
    `;
  }).join("");

  const more = matches.length > 15 ? `<div class="note">(+${matches.length - 15} more)</div>` : "";
  return items + more;
}

// -----------------------
// Helpers (UI state)
// -----------------------
function resetOutputs() {
  if (scoreBox) scoreBox.textContent = "—";
  if (scoreNote) scoreNote.textContent = "";
  if (debugBox) debugBox.textContent = "{}";
  if (transcriptBox) transcriptBox.textContent = "(waiting...)";
  if (asrMeta) asrMeta.textContent = "";
  if (correctedBox) correctedBox.textContent = "—";
  if (issuesBox) issuesBox.textContent = "—";
  if (btnTts) btnTts.disabled = true;
  if (ttsPlayer) ttsPlayer.src = "";
}

function setPredictEnabled(enabled) {
  if (btnPredict) btnPredict.disabled = !enabled;
}

function isUsingUpload() {
  return fileInput && fileInput.files && fileInput.files.length > 0;
}

function updateModeUI() {
  const usingUpload = isUsingUpload();
  if (btnClearFile) btnClearFile.disabled = !usingUpload;

  // Disable recording if a file is chosen
  if (btnStart) btnStart.disabled = usingUpload;
  if (btnStop) btnStop.disabled = true;

  const canPredict = usingUpload || !!recordedBlob;
  setPredictEnabled(canPredict);
}

// -----------------------
// Reset everything
// -----------------------
function resetAll() {
  try {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    if (mediaRecorder && mediaRecorder.stream) {
      mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
  } catch (e) {}

  stopTimer();
  chunks = [];
  recordedBlob = null;

  if (fileInput) fileInput.value = "";
  if (player) player.src = "";
  if (ttsPlayer) ttsPlayer.src = "";

  resetOutputs();

  if (btnStart) btnStart.disabled = false;
  if (btnStop) btnStop.disabled = true;
  if (btnPredict) btnPredict.disabled = true;
  if (btnTts) btnTts.disabled = true;
  if (btnClearFile) btnClearFile.disabled = true;

  setStatus("idle");
  updateModeUI();
}

// -----------------------
// Recording
// -----------------------
async function startRecording() {
  try {
    resetOutputs();

    recordedBlob = null;
    chunks = [];

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    if (!window.MediaRecorder) {
      throw new Error("MediaRecorder not supported in this browser. Use Chrome.");
    }

    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onerror = () => {
      setStatus("error");
      if (scoreNote) scoreNote.textContent = "MediaRecorder error. Try Chrome / allow mic.";
    };

    mediaRecorder.onstop = () => {
      stopTimer();

      recordedBlob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
      const url = URL.createObjectURL(recordedBlob);
      if (player) player.src = url;

      setStatus("recorded (ready to predict)");
      updateModeUI();
    };

    mediaRecorder.start();
    setStatus("recording...");
    startTimer();

    if (btnStart) btnStart.disabled = true;
    if (btnStop) btnStop.disabled = false;
    setPredictEnabled(false);

  } catch (err) {
    setStatus("error");
    if (scoreNote) scoreNote.textContent = err.message || "Mic permission / browser issue";
    updateModeUI();
  }
}

function stopRecording() {
  try {
    if (!mediaRecorder) return;

    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(t => t.stop());

    if (btnStart) btnStart.disabled = false;
    if (btnStop) btnStop.disabled = true;
    setStatus("processing recording...");
  } catch (e) {}
}

// -----------------------
// Predict
// -----------------------
async function predictScore() {
  resetOutputs();
  setStatus("uploading & predicting...");
  setPredictEnabled(false);

  const fd = new FormData();

  if (isUsingUpload()) {
    const file = fileInput.files[0];
    fd.append("audio", file, file.name);
  } else if (recordedBlob) {
    const filename = (recordedBlob.type.includes("ogg")) ? "recording.ogg" : "recording.webm";
    fd.append("audio", recordedBlob, filename);
  } else {
    setStatus("idle");
    if (scoreNote) scoreNote.textContent = "No audio found. Record or upload a file.";
    updateModeUI();
    return;
  }

  try {
    const res = await fetch(window.PREDICT_URL || "/predict", {
      method: "POST",
      body: fd
    });

    const data = await res.json().catch(() => ({}));
    if (debugBox) debugBox.textContent = JSON.stringify(data, null, 2);

    if (!data.ok) {
      setStatus("error");
      if (scoreNote) scoreNote.textContent = data.error || "Prediction failed";
      updateModeUI();
      return;
    }

    // Transcript
    if (transcriptBox) transcriptBox.textContent = data.transcript ? data.transcript : "(no transcript returned)";
    if (asrMeta) asrMeta.textContent = data.asr_mode ? `ASR mode: ${data.asr_mode}` : "";

    // Corrected + Highlighted Issues
    const corrected = data.corrected_text || "";
    const matches = data.grammar_matches || [];

    if (correctedBox) correctedBox.innerHTML = highlightText(corrected, matches);
    if (issuesBox) issuesBox.innerHTML = renderIssues(matches);

    // Enable TTS if corrected exists
    if (btnTts) btnTts.disabled = !corrected;

    // Score
    const score = Number(data.score);
    if (scoreBox) scoreBox.textContent = Number.isFinite(score) ? score.toFixed(2) : "—";

    if (scoreNote) {
      if (score < 2) scoreNote.textContent = "Needs improvement: grammar/fluency likely weak.";
      else if (score < 3) scoreNote.textContent = "Average: understandable but with notable issues.";
      else if (score < 4) scoreNote.textContent = "Good: mostly correct with minor mistakes.";
      else scoreNote.textContent = "Excellent: strong grammar and clarity.";
    }

    setStatus("done ✅");
    updateModeUI();

  } catch (err) {
    setStatus("error");
    if (scoreNote) scoreNote.textContent = "Network/server error. Check backend running.";
    updateModeUI();
  }
}

// -----------------------
// TTS
// -----------------------
async function playTts() {
  const text = correctedBox ? correctedBox.textContent.trim() : "";
  if (!text || text === "—") return;

  if (btnTts) btnTts.disabled = true;
  setStatus("generating corrected voice...");

  try {
    const res = await fetch("/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "TTS failed");
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    if (ttsPlayer) ttsPlayer.src = url;
    if (ttsPlayer) await ttsPlayer.play();

    setStatus("done ✅");
  } catch (e) {
    setStatus("error");
    if (scoreNote) scoreNote.textContent = e.message;
  } finally {
    if (btnTts) btnTts.disabled = false;
  }
}

// -----------------------
// Upload handlers
// -----------------------
function onFileSelected() {
  resetOutputs();
  recordedBlob = null;
  chunks = [];

  if (player && isUsingUpload()) {
    const file = fileInput.files[0];
    const url = URL.createObjectURL(file);
    player.src = url;
  }

  setStatus("file selected (ready to predict)");
  updateModeUI();
}

function clearFile() {
  if (!fileInput) return;
  fileInput.value = "";

  if (player) player.src = "";
  setStatus("idle");
  updateModeUI();
}

// -----------------------
// Listeners
// -----------------------
if (btnStart) btnStart.addEventListener("click", startRecording);
if (btnStop) btnStop.addEventListener("click", stopRecording);
if (btnPredict) btnPredict.addEventListener("click", predictScore);
if (btnReset) btnReset.addEventListener("click", resetAll);

if (btnTts) btnTts.addEventListener("click", playTts);

if (fileInput) fileInput.addEventListener("change", onFileSelected);
if (btnClearFile) btnClearFile.addEventListener("click", clearFile);

// Initial state
updateModeUI();



// let mediaRecorder;
// let chunks = [];
// let recordedBlob = null;
// let timerInterval = null;
// let startTime = null;

// // --- Buttons / UI ---
// const btnStart = document.getElementById("btnStart");
// const btnStop = document.getElementById("btnStop");
// const btnPredict = document.getElementById("btnPredict");
// const btnReset = document.getElementById("btnReset");

// const player = document.getElementById("player");
// const statusText = document.getElementById("statusText");
// const timerText = document.getElementById("timerText");
// const scoreBox = document.getElementById("scoreBox");
// const scoreNote = document.getElementById("scoreNote");
// const debugBox = document.getElementById("debugBox"); // may not exist; guarded below

// // Transcript UI refs
// const transcriptBox = document.getElementById("transcriptBox");
// const asrMeta = document.getElementById("asrMeta");

// // Corrected + Issues UI
// const correctedBox = document.getElementById("correctedBox");
// const issuesBox = document.getElementById("issuesBox");

// // TTS UI
// const btnTts = document.getElementById("btnTts");
// const ttsPlayer = document.getElementById("ttsPlayer");

// // Upload UI
// const fileInput = document.getElementById("fileInput");
// const btnClearFile = document.getElementById("btnClearFile");

// // -----------------------
// // Small utilities
// // -----------------------
// function setStatus(msg) {
//   if (statusText) statusText.textContent = "Status: " + msg;
// }

// function formatTime(ms) {
//   const sec = Math.floor(ms / 1000);
//   const m = String(Math.floor(sec / 60)).padStart(2, "0");
//   const s = String(sec % 60).padStart(2, "0");
//   return `${m}:${s}`;
// }

// function startTimer() {
//   startTime = Date.now();
//   if (timerText) timerText.textContent = "00:00";
//   timerInterval = setInterval(() => {
//     if (timerText) timerText.textContent = formatTime(Date.now() - startTime);
//   }, 250);
// }

// function stopTimer() {
//   if (timerInterval) clearInterval(timerInterval);
//   timerInterval = null;
// }

// // escape HTML so we can safely inject spans
// function escapeHtml(s) {
//   return (s || "")
//     .replaceAll("&", "&amp;")
//     .replaceAll("<", "&lt;")
//     .replaceAll(">", "&gt;")
//     .replaceAll('"', "&quot;")
//     .replaceAll("'", "&#039;");
// }

// // Highlight error spans in a text using LanguageTool offsets
// function highlightText(text, matches) {
//   if (!text) return "—";
//   if (!Array.isArray(matches) || matches.length === 0) return escapeHtml(text);

//   const sorted = [...matches].sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0));

//   let out = "";
//   let cursor = 0;

//   for (const m of sorted) {
//     const off = m.offset ?? 0;
//     const len = m.length ?? 0;
//     if (len <= 0) continue;
//     if (off < cursor) continue; // skip overlapping

//     out += escapeHtml(text.slice(cursor, off));

//     const bad = text.slice(off, off + len);
//     const tooltip = escapeHtml(m.message || "Issue");
//     out += `<span class="hl-bad" title="${tooltip}">${escapeHtml(bad)}</span>`;

//     cursor = off + len;
//   }

//   out += escapeHtml(text.slice(cursor));
//   return out;
// }

// function renderIssues(matches) {
//   if (!Array.isArray(matches) || matches.length === 0) {
//     return "No issues detected ✅";
//   }

//   const items = matches.slice(0, 15).map((m, i) => {
//     const msg = m.message || "Issue";
//     const rule = (m.rule && m.rule.id) ? m.rule.id : "rule";
//     const rep = (m.replacements && m.replacements.length) ? m.replacements[0].value : "";
//     const ctx = (m.context && m.context.text) ? m.context.text : "";

//     return `
//       <div class="issue-item">
//         <div class="issue-title">${i + 1}. ${escapeHtml(msg)}</div>
//         <div class="issue-meta">
//           <div><b>Rule:</b> ${escapeHtml(rule)}</div>
//           ${rep ? `<div><b>Suggestion:</b> ${escapeHtml(rep)}</div>` : ""}
//           ${ctx ? `<div><b>Context:</b> ${escapeHtml(ctx)}</div>` : ""}
//         </div>
//       </div>
//     `;
//   }).join("");

//   const more = matches.length > 15 ? `<div class="note">(+${matches.length - 15} more)</div>` : "";
//   return items + more;
// }

// // -----------------------
// // Helpers (UI state)
// // -----------------------
// function resetOutputs() {
//   if (scoreBox) scoreBox.textContent = "—";
//   if (scoreNote) scoreNote.textContent = "";
//   if (debugBox) debugBox.textContent = "{}";
//   if (transcriptBox) transcriptBox.textContent = "(waiting...)";
//   if (asrMeta) asrMeta.textContent = "";
//   if (correctedBox) correctedBox.textContent = "—";
//   if (issuesBox) issuesBox.textContent = "—";
//   if (btnTts) btnTts.disabled = true;
//   if (ttsPlayer) ttsPlayer.src = "";
// }

// function setPredictEnabled(enabled) {
//   if (btnPredict) btnPredict.disabled = !enabled;
// }

// function isUsingUpload() {
//   return fileInput && fileInput.files && fileInput.files.length > 0;
// }

// function updateModeUI() {
//   const usingUpload = isUsingUpload();
//   if (btnClearFile) btnClearFile.disabled = !usingUpload;

//   // Disable recording if a file is chosen
//   if (btnStart) btnStart.disabled = usingUpload;
//   if (btnStop) btnStop.disabled = true;

//   const canPredict = usingUpload || !!recordedBlob;
//   setPredictEnabled(canPredict);
// }

// // -----------------------
// // Reset everything
// // -----------------------
// function resetAll() {
//   try {
//     if (mediaRecorder && mediaRecorder.state !== "inactive") {
//       mediaRecorder.stop();
//     }
//     if (mediaRecorder && mediaRecorder.stream) {
//       mediaRecorder.stream.getTracks().forEach(t => t.stop());
//     }
//   } catch (e) {}

//   stopTimer();
//   chunks = [];
//   recordedBlob = null;

//   if (fileInput) fileInput.value = "";
//   if (player) player.src = "";
//   if (ttsPlayer) ttsPlayer.src = "";

//   resetOutputs();

//   if (btnStart) btnStart.disabled = false;
//   if (btnStop) btnStop.disabled = true;
//   if (btnPredict) btnPredict.disabled = true;
//   if (btnTts) btnTts.disabled = true;
//   if (btnClearFile) btnClearFile.disabled = true;

//   setStatus("idle");
//   updateModeUI();
// }

// // -----------------------
// // Recording
// // -----------------------
// async function startRecording() {
//   try {
//     resetOutputs();

//     recordedBlob = null;
//     chunks = [];

//     const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

//     if (!window.MediaRecorder) {
//       throw new Error("MediaRecorder not supported in this browser. Use Chrome.");
//     }

//     mediaRecorder = new MediaRecorder(stream);

//     mediaRecorder.ondataavailable = (e) => {
//       if (e.data && e.data.size > 0) chunks.push(e.data);
//     };

//     mediaRecorder.onerror = () => {
//       setStatus("error");
//       if (scoreNote) scoreNote.textContent = "MediaRecorder error. Try Chrome / allow mic.";
//     };

//     mediaRecorder.onstop = () => {
//       stopTimer();

//       recordedBlob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
//       const url = URL.createObjectURL(recordedBlob);
//       if (player) player.src = url;

//       setStatus("recorded (ready to predict)");
//       updateModeUI();
//     };

//     mediaRecorder.start();
//     setStatus("recording...");
//     startTimer();

//     if (btnStart) btnStart.disabled = true;
//     if (btnStop) btnStop.disabled = false;
//     setPredictEnabled(false);

//   } catch (err) {
//     setStatus("error");
//     if (scoreNote) scoreNote.textContent = err.message || "Mic permission / browser issue";
//     updateModeUI();
//   }
// }

// function stopRecording() {
//   try {
//     if (!mediaRecorder) return;

//     mediaRecorder.stop();
//     mediaRecorder.stream.getTracks().forEach(t => t.stop());

//     if (btnStart) btnStart.disabled = false;
//     if (btnStop) btnStop.disabled = true;
//     setStatus("processing recording...");
//   } catch (e) {}
// }

// // -----------------------
// // Predict
// // -----------------------
// async function predictScore() {
//   resetOutputs();
//   setStatus("uploading & predicting...");
//   setPredictEnabled(false);

//   const fd = new FormData();

//   if (isUsingUpload()) {
//     const file = fileInput.files[0];
//     fd.append("audio", file, file.name);
//   } else if (recordedBlob) {
//     const filename = (recordedBlob.type.includes("ogg")) ? "recording.ogg" : "recording.webm";
//     fd.append("audio", recordedBlob, filename);
//   } else {
//     setStatus("idle");
//     if (scoreNote) scoreNote.textContent = "No audio found. Record or upload a file.";
//     updateModeUI();
//     return;
//   }

//   try {
//     const res = await fetch(window.PREDICT_URL || "/predict", {
//       method: "POST",
//       body: fd
//     });

//     const data = await res.json().catch(() => ({}));
//     if (debugBox) debugBox.textContent = JSON.stringify(data, null, 2);

//     if (!data.ok) {
//       setStatus("error");
//       if (scoreNote) scoreNote.textContent = data.error || "Prediction failed";
//       updateModeUI();
//       return;
//     }

//     // Transcript
//     if (transcriptBox) transcriptBox.textContent = data.transcript ? data.transcript : "(no transcript returned)";
//     if (asrMeta) asrMeta.textContent = data.asr_mode ? `ASR mode: ${data.asr_mode}` : "";

//     // Corrected + Highlighted Issues
//     const corrected = data.corrected_text || "";
//     const matches = data.grammar_matches || [];

//     if (correctedBox) correctedBox.innerHTML = highlightText(corrected, matches);
//     if (issuesBox) issuesBox.innerHTML = renderIssues(matches);

//     // Enable TTS if corrected exists
//     if (btnTts) btnTts.disabled = !corrected;

//     // Score
//     const score = Number(data.score);
//     if (scoreBox) scoreBox.textContent = Number.isFinite(score) ? score.toFixed(2) : "—";

//     if (scoreNote) {
//       if (score < 2) scoreNote.textContent = "Needs improvement: grammar/fluency likely weak.";
//       else if (score < 3) scoreNote.textContent = "Average: understandable but with notable issues.";
//       else if (score < 4) scoreNote.textContent = "Good: mostly correct with minor mistakes.";
//       else scoreNote.textContent = "Excellent: strong grammar and clarity.";
//     }

//     setStatus("done ✅");
//     updateModeUI();

//   } catch (err) {
//     setStatus("error");
//     if (scoreNote) scoreNote.textContent = "Network/server error. Check backend running.";
//     updateModeUI();
//   }
// }

// // -----------------------
// // TTS
// // -----------------------
// async function playTts() {
//   const text = correctedBox ? correctedBox.textContent.trim() : "";
//   if (!text || text === "—") return;

//   if (btnTts) btnTts.disabled = true;
//   setStatus("generating corrected voice...");

//   try {
//     const res = await fetch("/tts", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({ text })
//     });

//     if (!res.ok) {
//       const err = await res.json().catch(() => ({}));
//       throw new Error(err.error || "TTS failed");
//     }

//     const blob = await res.blob();
//     const url = URL.createObjectURL(blob);
//     if (ttsPlayer) ttsPlayer.src = url;
//     if (ttsPlayer) await ttsPlayer.play();

//     setStatus("done ✅");
//   } catch (e) {
//     setStatus("error");
//     if (scoreNote) scoreNote.textContent = e.message;
//   } finally {
//     if (btnTts) btnTts.disabled = false;
//   }
// }

// // -----------------------
// // Upload handlers
// // -----------------------
// function onFileSelected() {
//   resetOutputs();
//   recordedBlob = null;
//   chunks = [];

//   if (player && isUsingUpload()) {
//     const file = fileInput.files[0];
//     const url = URL.createObjectURL(file);
//     player.src = url;
//   }

//   setStatus("file selected (ready to predict)");
//   updateModeUI();
// }

// function clearFile() {
//   if (!fileInput) return;
//   fileInput.value = "";

//   if (player) player.src = "";
//   setStatus("idle");
//   updateModeUI();
// }

// // -----------------------
// // Listeners
// // -----------------------
// if (btnStart) btnStart.addEventListener("click", startRecording);
// if (btnStop) btnStop.addEventListener("click", stopRecording);
// if (btnPredict) btnPredict.addEventListener("click", predictScore);
// if (btnReset) btnReset.addEventListener("click", resetAll);

// if (btnTts) btnTts.addEventListener("click", playTts);

// if (fileInput) fileInput.addEventListener("change", onFileSelected);
// if (btnClearFile) btnClearFile.addEventListener("click", clearFile);

// // Initial state
// updateModeUI();




// // let mediaRecorder;
// // let chunks = [];
// // let recordedBlob = null;
// // let timerInterval = null;
// // let startTime = null;

// // // --- Buttons / UI ---
// // const btnStart = document.getElementById("btnStart");
// // const btnStop = document.getElementById("btnStop");
// // const btnPredict = document.getElementById("btnPredict");
// // const btnReset = document.getElementById("btnReset");        // ✅ Reset button

// // const player = document.getElementById("player");
// // const statusText = document.getElementById("statusText");
// // const timerText = document.getElementById("timerText");
// // const scoreBox = document.getElementById("scoreBox");
// // const scoreNote = document.getElementById("scoreNote");
// // const debugBox = document.getElementById("debugBox");

// // // Transcript UI refs
// // const transcriptBox = document.getElementById("transcriptBox");
// // const asrMeta = document.getElementById("asrMeta");

// // // Corrected text UI
// // const correctedBox = document.getElementById("correctedBox");

// // // TTS UI refs
// // const btnTts = document.getElementById("btnTts");
// // const ttsPlayer = document.getElementById("ttsPlayer");

// // // Upload UI refs
// // const fileInput = document.getElementById("fileInput");
// // const btnClearFile = document.getElementById("btnClearFile");

// // function setStatus(msg) {
// //   if (statusText) statusText.textContent = "Status: " + msg;
// // }

// // function formatTime(ms) {
// //   const sec = Math.floor(ms / 1000);
// //   const m = String(Math.floor(sec / 60)).padStart(2, "0");
// //   const s = String(sec % 60).padStart(2, "0");
// //   return `${m}:${s}`;
// // }

// // function startTimer() {
// //   startTime = Date.now();
// //   if (timerText) timerText.textContent = "00:00";
// //   timerInterval = setInterval(() => {
// //     if (timerText) timerText.textContent = formatTime(Date.now() - startTime);
// //   }, 250);
// // }

// // function stopTimer() {
// //   if (timerInterval) clearInterval(timerInterval);
// //   timerInterval = null;
// // }

// // // -----------------------
// // // Helpers
// // // -----------------------
// // function resetOutputs() {
// //   if (scoreBox) scoreBox.textContent = "—";
// //   if (scoreNote) scoreNote.textContent = "";
// //   if (debugBox) debugBox.textContent = "{}";
// //   if (transcriptBox) transcriptBox.textContent = "(waiting...)";
// //   if (asrMeta) asrMeta.textContent = "";
// //   if (correctedBox) correctedBox.textContent = "—";
// //   if (btnTts) btnTts.disabled = true;
// //   if (ttsPlayer) ttsPlayer.src = "";
// // }

// // function setPredictEnabled(enabled) {
// //   if (btnPredict) btnPredict.disabled = !enabled;
// // }

// // function isUsingUpload() {
// //   return fileInput && fileInput.files && fileInput.files.length > 0;
// // }

// // function updateModeUI() {
// //   const usingUpload = isUsingUpload();

// //   if (btnClearFile) btnClearFile.disabled = !usingUpload;

// //   // Disable recording when file selected (avoid confusion)
// //   if (btnStart) btnStart.disabled = usingUpload;
// //   if (btnStop) btnStop.disabled = true; // only enabled during actual recording

// //   // Predict enabled if either we have a file or a recorded blob
// //   const canPredict = usingUpload || !!recordedBlob;
// //   setPredictEnabled(canPredict);
// // }

// // // -----------------------
// // // Reset (Record + Upload + Outputs)
// // // -----------------------
// // function resetAll() {
// //   try {
// //     // Stop recording safely
// //     if (mediaRecorder && mediaRecorder.state !== "inactive") {
// //       mediaRecorder.stop();
// //     }
// //     if (mediaRecorder && mediaRecorder.stream) {
// //       mediaRecorder.stream.getTracks().forEach(t => t.stop());
// //     }
// //   } catch (e) {
// //     console.warn("Recorder already stopped");
// //   }

// //   stopTimer();

// //   // Clear audio data
// //   chunks = [];
// //   recordedBlob = null;

// //   // Clear upload
// //   if (fileInput) fileInput.value = "";

// //   // Clear players
// //   if (player) player.src = "";
// //   if (ttsPlayer) ttsPlayer.src = "";

// //   // Reset text outputs
// //   if (scoreBox) scoreBox.textContent = "—";
// //   if (scoreNote) scoreNote.textContent = "";
// //   if (debugBox) debugBox.textContent = "{}";
// //   if (transcriptBox) transcriptBox.textContent = "(waiting...)";
// //   if (asrMeta) asrMeta.textContent = "";
// //   if (correctedBox) correctedBox.textContent = "—";

// //   // Reset buttons
// //   if (btnStart) btnStart.disabled = false;
// //   if (btnStop) btnStop.disabled = true;
// //   if (btnPredict) btnPredict.disabled = true;
// //   if (btnTts) btnTts.disabled = true;
// //   if (btnClearFile) btnClearFile.disabled = true;

// //   setStatus("idle");
// //   updateModeUI();
// // }

// // // -----------------------
// // // Recording
// // // -----------------------
// // async function startRecording() {
// //   try {
// //     resetOutputs();

// //     recordedBlob = null;
// //     chunks = [];

// //     const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

// //     if (!window.MediaRecorder) {
// //       throw new Error("MediaRecorder not supported in this browser. Use Chrome.");
// //     }

// //     mediaRecorder = new MediaRecorder(stream);

// //     mediaRecorder.ondataavailable = (e) => {
// //       if (e.data && e.data.size > 0) chunks.push(e.data);
// //     };

// //     mediaRecorder.onerror = (e) => {
// //       console.error("MediaRecorder error:", e);
// //       setStatus("error");
// //       if (scoreNote) scoreNote.textContent = "MediaRecorder error. Try Chrome / allow mic.";
// //     };

// //     mediaRecorder.onstop = () => {
// //       stopTimer();

// //       recordedBlob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
// //       const url = URL.createObjectURL(recordedBlob);
// //       if (player) player.src = url;

// //       setStatus("recorded (ready to predict)");
// //       updateModeUI();
// //     };

// //     mediaRecorder.start();
// //     setStatus("recording...");
// //     startTimer();

// //     if (btnStart) btnStart.disabled = true;
// //     if (btnStop) btnStop.disabled = false;
// //     setPredictEnabled(false);

// //   } catch (err) {
// //     console.error("startRecording failed:", err);
// //     setStatus("error");
// //     if (scoreNote) scoreNote.textContent = err.message || "Mic permission / browser issue";
// //     updateModeUI();
// //   }
// // }

// // function stopRecording() {
// //   try {
// //     if (!mediaRecorder) return;

// //     mediaRecorder.stop();
// //     mediaRecorder.stream.getTracks().forEach(t => t.stop());

// //     if (btnStart) btnStart.disabled = false;
// //     if (btnStop) btnStop.disabled = true;
// //     setStatus("processing recording...");
// //   } catch (e) {
// //     console.error("stopRecording error:", e);
// //   }
// // }

// // // -----------------------
// // // Predict
// // // -----------------------
// // async function predictScore() {
// //   resetOutputs();
// //   setStatus("uploading & predicting...");
// //   setPredictEnabled(false);

// //   const fd = new FormData();

// //   // 1) If user uploaded a file, use it
// //   if (isUsingUpload()) {
// //     const file = fileInput.files[0];
// //     fd.append("audio", file, file.name);
// //   }
// //   // 2) Else use recorded blob
// //   else if (recordedBlob) {
// //     const filename = (recordedBlob.type.includes("ogg")) ? "recording.ogg" : "recording.webm";
// //     fd.append("audio", recordedBlob, filename);
// //   } else {
// //     setStatus("idle");
// //     if (scoreNote) scoreNote.textContent = "No audio found. Record or upload a file.";
// //     updateModeUI();
// //     return;
// //   }

// //   try {
// //     const res = await fetch(window.PREDICT_URL || "/predict", {
// //       method: "POST",
// //       body: fd
// //     });

// //     const data = await res.json().catch(() => ({}));
// //     if (debugBox) debugBox.textContent = JSON.stringify(data, null, 2);

// //     if (!data.ok) {
// //       setStatus("error");
// //       if (scoreNote) scoreNote.textContent = data.error || "Prediction failed";
// //       updateModeUI();
// //       return;
// //     }

// //     // Transcript
// //     if (transcriptBox) transcriptBox.textContent = data.transcript ? data.transcript : "(no transcript returned)";
// //     if (asrMeta) asrMeta.textContent = data.asr_mode ? `ASR mode: ${data.asr_mode}` : "";

// //     // Corrected
// //     if (correctedBox) {
// //       correctedBox.textContent = data.corrected_text ? data.corrected_text : "—";
// //       if (data.grammar_matches && data.grammar_matches.length) {
// //         correctedBox.textContent += `\n\n(Detected issues: ${data.grammar_matches.length})`;
// //       }
// //     }

// //     // Enable TTS if corrected text exists
// //     if (btnTts) btnTts.disabled = !data.corrected_text;

// //     // Score
// //     const score = Number(data.score);
// //     if (scoreBox) scoreBox.textContent = Number.isFinite(score) ? score.toFixed(2) : "—";

// //     if (scoreNote) {
// //       if (score < 2) scoreNote.textContent = "Needs improvement: grammar/fluency likely weak.";
// //       else if (score < 3) scoreNote.textContent = "Average: understandable but with notable issues.";
// //       else if (score < 4) scoreNote.textContent = "Good: mostly correct with minor mistakes.";
// //       else scoreNote.textContent = "Excellent: strong grammar and clarity.";
// //     }

// //     setStatus("done ✅");
// //     updateModeUI();

// //   } catch (err) {
// //     console.error(err);
// //     setStatus("error");
// //     if (scoreNote) scoreNote.textContent = "Network/server error. Check backend running.";
// //     updateModeUI();
// //   }
// // }

// // // -----------------------
// // // TTS
// // // -----------------------
// // async function playTts() {
// //   const text = correctedBox ? correctedBox.textContent.trim() : "";
// //   if (!text || text === "—") return;

// //   if (btnTts) btnTts.disabled = true;
// //   setStatus("generating corrected voice...");

// //   try {
// //     const res = await fetch("/tts", {
// //       method: "POST",
// //       headers: { "Content-Type": "application/json" },
// //       body: JSON.stringify({ text })
// //     });

// //     if (!res.ok) {
// //       const err = await res.json().catch(() => ({}));
// //       throw new Error(err.error || "TTS failed");
// //     }

// //     const blob = await res.blob();
// //     const url = URL.createObjectURL(blob);
// //     if (ttsPlayer) ttsPlayer.src = url;
// //     if (ttsPlayer) await ttsPlayer.play();

// //     setStatus("done ✅");
// //   } catch (e) {
// //     setStatus("error");
// //     if (scoreNote) scoreNote.textContent = e.message;
// //   } finally {
// //     if (btnTts) btnTts.disabled = false;
// //   }
// // }

// // // -----------------------
// // // Upload handlers
// // // -----------------------
// // function onFileSelected() {
// //   resetOutputs();

// //   // Clear recorded blob when a file is chosen (avoid confusion)
// //   recordedBlob = null;
// //   chunks = [];

// //   // Preview uploaded file in the player
// //   if (player && isUsingUpload()) {
// //     const file = fileInput.files[0];
// //     const url = URL.createObjectURL(file);
// //     player.src = url;
// //   }

// //   setStatus("file selected (ready to predict)");
// //   updateModeUI();
// // }

// // function clearFile() {
// //   if (!fileInput) return;
// //   fileInput.value = "";

// //   if (player) player.src = "";
// //   setStatus("idle");

// //   updateModeUI();
// // }

// // // -----------------------
// // // Listeners
// // // -----------------------
// // if (btnStart) btnStart.addEventListener("click", startRecording);
// // if (btnStop) btnStop.addEventListener("click", stopRecording);
// // if (btnPredict) btnPredict.addEventListener("click", predictScore);
// // if (btnTts) btnTts.addEventListener("click", playTts);

// // if (fileInput) fileInput.addEventListener("change", onFileSelected);
// // if (btnClearFile) btnClearFile.addEventListener("click", clearFile);
// // if (btnReset) btnReset.addEventListener("click", resetAll);

// // // Initial state
// // updateModeUI();
