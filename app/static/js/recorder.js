let mediaRecorder;
let chunks = [];
let recordedBlob = null;
let timerInterval = null;
let startTime = null;

const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const btnPredict = document.getElementById("btnPredict");
const player = document.getElementById("player");
const statusText = document.getElementById("statusText");
const timerText = document.getElementById("timerText");
const scoreBox = document.getElementById("scoreBox");
const scoreNote = document.getElementById("scoreNote");
const debugBox = document.getElementById("debugBox");

// Transcript UI refs
const transcriptBox = document.getElementById("transcriptBox");
const asrMeta = document.getElementById("asrMeta");

function setStatus(msg) {
  statusText.textContent = "Status: " + msg;
}

function formatTime(ms) {
  const sec = Math.floor(ms / 1000);
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function startTimer() {
  startTime = Date.now();
  timerText.textContent = "00:00";
  timerInterval = setInterval(() => {
    timerText.textContent = formatTime(Date.now() - startTime);
  }, 250);
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

async function startRecording() {
  // Reset UI
  scoreBox.textContent = "—";
  scoreNote.textContent = "";
  debugBox.textContent = "{}";

  // reset transcript area
  transcriptBox.textContent = "(waiting...)";
  asrMeta.textContent = "";

  recordedBlob = null;
  chunks = [];

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  // Browser chooses best supported mimeType
  mediaRecorder = new MediaRecorder(stream);

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    stopTimer();

    // Use recorder mimeType (often webm/ogg)
    recordedBlob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });

    const url = URL.createObjectURL(recordedBlob);
    player.src = url;

    btnPredict.disabled = false;
    setStatus("recorded (ready to predict)");
  };

  mediaRecorder.start();
  setStatus("recording...");
  startTimer();

  btnStart.disabled = true;
  btnStop.disabled = false;
  btnPredict.disabled = true;
}

function stopRecording() {
  if (!mediaRecorder) return;
  mediaRecorder.stop();

  // stop mic tracks
  mediaRecorder.stream.getTracks().forEach(t => t.stop());

  btnStart.disabled = false;
  btnStop.disabled = true;
  setStatus("processing recording...");
}

async function predictScore() {
  if (!recordedBlob) return;

  setStatus("uploading & predicting...");
  btnPredict.disabled = true;

  const fd = new FormData();

  // Use a filename with extension. Browser recordings are often webm/ogg.
  const filename = (recordedBlob.type.includes("ogg")) ? "recording.ogg" : "recording.webm";
  fd.append("audio", recordedBlob, filename);

  try {
    const res = await fetch(window.PREDICT_URL, {
      method: "POST",
      body: fd
    });

    const data = await res.json();
    debugBox.textContent = JSON.stringify(data, null, 2);

    // show transcript + ASR mode if backend returns them
    transcriptBox.textContent = data.transcript
      ? data.transcript
      : "(no transcript returned)";
    asrMeta.textContent = data.asr_mode
      ? `ASR mode: ${data.asr_mode}`
      : "";

    if (!data.ok) {
      setStatus("error");
      scoreBox.textContent = "—";
      scoreNote.textContent = data.error || "Prediction failed";
      btnPredict.disabled = false;
      return;
    }

    const score = Number(data.score);
    scoreBox.textContent = score.toFixed(2);

    // Friendly message
    if (score < 2) scoreNote.textContent = "Needs improvement: grammar/fluency likely weak.";
    else if (score < 3) scoreNote.textContent = "Average: understandable but with notable issues.";
    else if (score < 4) scoreNote.textContent = "Good: mostly correct with minor mistakes.";
    else scoreNote.textContent = "Excellent: strong grammar and clarity.";

    setStatus("done ✅");
  } catch (err) {
    setStatus("error");
    scoreNote.textContent = "Network/server error. Check backend running.";
    btnPredict.disabled = false;
  }
}

btnStart.addEventListener("click", () => startRecording());
btnStop.addEventListener("click", () => stopRecording());
btnPredict.addEventListener("click", () => predictScore());
