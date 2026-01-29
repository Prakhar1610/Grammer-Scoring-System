let mediaRecorder = null;
let chunks = [];
let recordedBlob = null;
let timerInterval = null;
let startTime = null;

// --------------------
// DOM refs
// --------------------
const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const btnPredict = document.getElementById("btnPredict");

const player = document.getElementById("player");
const statusText = document.getElementById("statusText");
const timerText = document.getElementById("timerText");

const scoreBox = document.getElementById("scoreBox");
const scoreNote = document.getElementById("scoreNote");
const debugBox = document.getElementById("debugBox");

const transcriptBox = document.getElementById("transcriptBox");
const asrMeta = document.getElementById("asrMeta");

const correctedBox = document.getElementById("correctedBox");

const btnTts = document.getElementById("btnTts");
const ttsPlayer = document.getElementById("ttsPlayer");

console.log("DOM check:", {
  btnStart, btnStop, btnPredict,
  player, statusText, timerText,
  scoreBox, scoreNote, debugBox,
  transcriptBox, asrMeta, correctedBox,
  btnTts, ttsPlayer
});

// --------------------
// Helpers
// --------------------
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

// Reset UI for new recording session
function resetUiForNewRecording() {
  if (scoreBox) scoreBox.textContent = "—";
  if (scoreNote) scoreNote.textContent = "";
  if (debugBox) debugBox.textContent = "{}";

  if (transcriptBox) transcriptBox.textContent = "(waiting...)";
  if (asrMeta) asrMeta.textContent = "";

  if (correctedBox) correctedBox.textContent = "—";

  if (btnTts) btnTts.disabled = true;
  if (ttsPlayer) ttsPlayer.src = "";

  if (btnPredict) btnPredict.disabled = true;
}

// --------------------
// Recording
// --------------------
async function startRecording() {
  try {
    console.log("startRecording clicked");
    resetUiForNewRecording();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("getUserMedia not supported. Use latest Chrome.");
    }
    if (!window.MediaRecorder) {
      throw new Error("MediaRecorder not supported. Use latest Chrome.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log("Mic permission granted ✅");

    chunks = [];
    recordedBlob = null;

    // Let browser pick format; usually "audio/webm"
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onerror = (e) => {
      console.error("MediaRecorder error:", e);
      setStatus("error");
      if (scoreNote) scoreNote.textContent = "Recorder error. Re-allow mic and retry.";
    };

    mediaRecorder.onstop = () => {
      stopTimer();

      recordedBlob = new Blob(chunks, {
        type: mediaRecorder.mimeType || "audio/webm"
      });
      console.log("Recorded blob size:", recordedBlob.size, "type:", recordedBlob.type);

      const url = URL.createObjectURL(recordedBlob);
      if (player) player.src = url;

      if (btnPredict) btnPredict.disabled = false;
      setStatus("recorded (ready to predict)");
    };

    mediaRecorder.start();
    setStatus("recording...");
    startTimer();

    if (btnStart) btnStart.disabled = true;
    if (btnStop) btnStop.disabled = false;
    if (btnPredict) btnPredict.disabled = true;

  } catch (err) {
    console.error("startRecording failed:", err);
    setStatus("error");
    if (scoreNote) scoreNote.textContent = err.message || "Mic permission / browser issue";
  }
}

function stopRecording() {
  try {
    console.log("stopRecording clicked");

    if (!mediaRecorder) {
      setStatus("idle");
      return;
    }

    // stop only if recording
    if (mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    }

    // stop mic tracks
    if (mediaRecorder.stream) {
      mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }

    if (btnStart) btnStart.disabled = false;
    if (btnStop) btnStop.disabled = true;

    setStatus("processing recording...");
  } catch (e) {
    console.error("stopRecording failed:", e);
    setStatus("error");
    if (scoreNote) scoreNote.textContent = e.message || "Stop failed";
  }
}

// --------------------
// Predict
// --------------------
async function predictScore() {
  if (!recordedBlob) {
    setStatus("idle");
    if (scoreNote) scoreNote.textContent = "Record audio first.";
    return;
  }

  setStatus("uploading & predicting...");
  if (btnPredict) btnPredict.disabled = true;

  const fd = new FormData();
  const filename = recordedBlob.type.includes("ogg") ? "recording.ogg" : "recording.webm";
  fd.append("audio", recordedBlob, filename);

  try {
    const res = await fetch(window.PREDICT_URL || "/predict", {
      method: "POST",
      body: fd
    });

    const data = await res.json().catch(() => ({}));
    if (debugBox) debugBox.textContent = JSON.stringify(data, null, 2);

    // Show transcript & corrected even if score fails
    if (transcriptBox) transcriptBox.textContent = data.transcript || "(no transcript returned)";
    if (asrMeta) asrMeta.textContent = data.asr_mode ? `ASR mode: ${data.asr_mode}` : "";

    if (correctedBox) {
      correctedBox.textContent = data.corrected_text || "—";
      if (data.grammar_matches && data.grammar_matches.length) {
        correctedBox.textContent += `\n\n(Detected issues: ${data.grammar_matches.length})`;
      }
    }

    if (btnTts) btnTts.disabled = !data.corrected_text;

    if (!data.ok) {
      setStatus("error");
      if (scoreBox) scoreBox.textContent = "—";
      if (scoreNote) scoreNote.textContent = data.error || "Prediction failed";
      if (btnPredict) btnPredict.disabled = false;
      return;
    }

    const score = Number(data.score);
    if (scoreBox) scoreBox.textContent = isFinite(score) ? score.toFixed(2) : "—";

    if (scoreNote) {
      if (score < 2) scoreNote.textContent = "Needs improvement: grammar/fluency likely weak.";
      else if (score < 3) scoreNote.textContent = "Average: understandable but with notable issues.";
      else if (score < 4) scoreNote.textContent = "Good: mostly correct with minor mistakes.";
      else scoreNote.textContent = "Excellent: strong grammar and clarity.";
    }

    setStatus("done ✅");

  } catch (err) {
    console.error("predictScore failed:", err);
    setStatus("error");
    if (scoreNote) scoreNote.textContent = "Network/server error. Check backend running.";
    if (btnPredict) btnPredict.disabled = false;
  }
}

// --------------------
// TTS
// --------------------
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

    if (ttsPlayer) {
      ttsPlayer.src = url;
      await ttsPlayer.play();
    }

    setStatus("done");

  } catch (e) {
    console.error("playTts failed:", e);
    setStatus("error");
    if (scoreNote) scoreNote.textContent = e.message;
  } finally {
    if (btnTts) btnTts.disabled = false;
  }
}


if (btnStart) btnStart.addEventListener("click", startRecording);
if (btnStop) btnStop.addEventListener("click", stopRecording);
if (btnPredict) btnPredict.addEventListener("click", predictScore);
if (btnTts) btnTts.addEventListener("click", playTts);
