const APPLY_URL =
  "https://kibjbsigxbqpfhqqarbo.supabase.co/functions/v1/apply";
const PROXY_URL = "/api/apply";
const MAX_RESUME_BYTES = 5 * 1024 * 1024;

const form = document.getElementById("apply-form");
const submitBtn = document.getElementById("submit-btn");
const statusEl = document.getElementById("status");
const fileInput = document.getElementById("resume");
const fileDrop = document.getElementById("file-drop");
const fileNameEl = document.getElementById("file-name");

/** Use local proxy when opened from our dev server (avoids CORS). */
function getSubmitUrl() {
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    return PROXY_URL;
  }
  return APPLY_URL;
}

async function bearerTokenFromEmail(email) {
  const normalized = email.trim().toLowerCase();
  const data = new TextEncoder().encode(normalized);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function showStatus(message, type) {
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

function clearStatus() {
  statusEl.hidden = true;
  statusEl.textContent = "";
  statusEl.className = "status";
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function validateFile(file) {
  if (!file) return "Please choose a PDF resume.";
  const name = file.name.toLowerCase();
  if (!name.endsWith(".pdf") && file.type !== "application/pdf") {
    return "Resume must be a PDF file.";
  }
  if (file.size > MAX_RESUME_BYTES) {
    return `Resume is ${formatBytes(file.size)}; maximum is 5 MB.`;
  }
  return null;
}

function updateFileLabel() {
  const file = fileInput.files?.[0];
  if (!file) {
    fileNameEl.hidden = true;
    return;
  }
  fileNameEl.hidden = false;
  fileNameEl.textContent = `${file.name} (${formatBytes(file.size)})`;
}

fileInput.addEventListener("change", updateFileLabel);

fileDrop.addEventListener("dragover", (e) => {
  e.preventDefault();
  fileDrop.classList.add("dragover");
});

fileDrop.addEventListener("dragleave", () => {
  fileDrop.classList.remove("dragover");
});

fileDrop.addEventListener("drop", (e) => {
  e.preventDefault();
  fileDrop.classList.remove("dragover");
  const file = e.dataTransfer?.files?.[0];
  if (file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    updateFileLabel();
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearStatus();

  const name = form.name.value.trim();
  const email = form.email.value.trim();
  let github = form.github_username.value.trim().replace(/^@+/, "");
  const resume = fileInput.files?.[0];

  if (!name || !email || !github) {
    showStatus("Please fill in all fields.", "error");
    return;
  }

  const fileError = validateFile(resume);
  if (fileError) {
    showStatus(fileError, "error");
    return;
  }

  submitBtn.disabled = true;
  showStatus("Submitting…", "info");

  try {
    const token = await bearerTokenFromEmail(email);
    const body = new FormData();
    body.append("name", name);
    body.append("email", email);
    body.append("github_username", github);
    body.append("resume", resume, resume.name);

    const response = await fetch(getSubmitUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Applicant-Tool": "company-apply-web/1.0",
        "X-Submitted-At": new Date().toISOString(),
        "X-GitHub": github,
      },
      body,
    });

    const text = await response.text();

    if (response.status === 201) {
      showStatus(
        text
          ? `Application submitted successfully.\n\n${text}`
          : "Application submitted successfully.",
        "success"
      );
      form.reset();
      updateFileLabel();
      return;
    }

    let message = `Submission failed (HTTP ${response.status}).`;
    if (text) message += `\n\n${text}`;
    if (response.status === 0 || message.includes("Failed to fetch")) {
      message +=
        "\n\nRun the local server and open http://localhost:8080\n  .\\serve.ps1";
    }
    showStatus(message, "error");
  } catch (err) {
    showStatus(
      `Network error: ${err.message}\n\nRun .\\serve.ps1 then open http://localhost:8080`,
      "error"
    );
  } finally {
    submitBtn.disabled = false;
  }
});
