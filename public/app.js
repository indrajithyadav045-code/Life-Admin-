const $ = selector => document.querySelector(selector);
const workspace = $("#workspace");
const captureCard = $("#captureCard");
const mainContent = $("#mainContent");
const sourceText = $("#sourceText");
const fileInput = $("#fileInput");
const captureMessage = $("#captureMessage");
const readButton = $("#readButton");
const dialog = $("#editDialog");
let samples = [];
let currentDrafts = [];
let activeTasks = [];
let doneTasks = [];
let toastTimer;

function localDate() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function prettyDate(value, options = {}) {
  if (!value) return "No due date";
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: options.weekday ?? "short", day: "numeric", month: "short" }).format(new Date(value + "T00:00:00.000Z"));
}
function daysFromToday(value) {
  if (!value) return null;
  const start = new Date(localDate() + "T00:00:00.000Z");
  const end = new Date(value + "T00:00:00.000Z");
  return Math.round((end - start) / 86400000);
}
function dueLabel(task) {
  const delta = daysFromToday(task.dueDate);
  if (delta === null) return "No due date";
  if (delta < 0) return "Overdue · " + prettyDate(task.dueDate);
  if (delta === 0) return "Today · " + prettyDate(task.dueDate);
  return prettyDate(task.dueDate) + " · in " + delta + (delta === 1 ? " day" : " days");
}
function money(value) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value || 0)); }

function categoryIcon(category) {
  const key = String(category || "Personal").toLowerCase();
  const type = key === "health" ? "health" : key === "school" ? "school" : key === "home" ? "home" : "bills";
  const paths = {
    bills: '<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h4"/><circle cx="16" cy="16" r="2.5"/>',
    health: '<path d="M12 20s-7-4.3-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.7-7 10-7 10Z"/><path d="M8 12h2l1-2 2 4 1-2h2"/>',
    school: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21V5.5Z"/><path d="M4 17a2.5 2.5 0 0 1 2.5-2.5H20M8 7h8"/>',
    home: '<path d="m3 11 9-8 9 8v9H3v-9Z"/><path d="M9 20v-6h6v6M7 10h.01M17 10h.01"/>',
  };
  return '<span class="category-icon ' + type + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + paths[type] + "</svg></span>";
}
function editIcon() { return '<svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16.5-.8 4.3 4.3-.8L19 8.5 15.5 5 4 16.5Z"/><path d="m13.8 6.7 3.5 3.5"/></svg>'; }
function clockIcon() { return '<svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'; }
function checkIcon() { return '<svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>'; }

function taskCard(task, preview = false) {
  const delta = daysFromToday(task.dueDate);
  const bucket = task.bucket || (delta !== null && delta < 0 ? "overdue" : delta === 0 ? "today" : "upcoming");
  const badgeClass = bucket === "overdue" ? "overdue" : bucket === "today" ? "today" : "";
  const cardClass = bucket === "overdue" ? "overdue-card" : bucket === "today" ? "today-card" : "";
  const details = task.details ? escapeHtml(task.details) : "";
  const amount = task.amount?.value ? money(task.amount.value) + (details ? " · " : "") : "";
  const info = (amount + details).trim();
  const actionMarkup = preview ? "" : '<div class="task-divider"></div><div class="task-actions"><button class="action-button done-action" data-action="done" data-id="' + escapeHtml(task.id) + '">' + checkIcon() + ' Done</button><button class="action-button" data-action="snooze" data-id="' + escapeHtml(task.id) + '">' + clockIcon() + ' Snooze</button><button class="icon-button edit-action" data-action="edit" data-id="' + escapeHtml(task.id) + '" aria-label="Edit ' + escapeHtml(task.title) + '">' + editIcon() + "</button></div>";
  return '<article class="task-card ' + cardClass + '"><div class="task-top">' + categoryIcon(task.category) + '<div class="task-title-wrap"><h3 class="task-title">' + escapeHtml(task.title) + '</h3><p class="task-category">' + escapeHtml(task.category || "Personal") + '</p></div></div><span class="due-badge ' + badgeClass + '">' + escapeHtml(dueLabel(task)) + '</span><p class="task-details">' + (info || "&nbsp;") + '</p>' + actionMarkup + '</article>';
}

function groupUpcoming(tasks) {
  const groups = [{ label: "THIS WEEK", tasks: [] }, { label: "NEXT WEEK", tasks: [] }, { label: "LATER", tasks: [] }];
  tasks.forEach(task => {
    const delta = daysFromToday(task.dueDate);
    if (delta !== null && delta <= 6) groups[0].tasks.push(task);
    else if (delta !== null && delta <= 13) groups[1].tasks.push(task);
    else groups[2].tasks.push(task);
  });
  return groups.filter(group => group.tasks.length);
}

function renderDashboard(data) {
  activeTasks = data.tasks || [];
  doneTasks = data.done || [];
  const todayTasks = activeTasks.filter(task => task.bucket === "today" || task.bucket === "overdue");
  const upcoming = activeTasks.filter(task => !todayTasks.includes(task));
  const summary = data.summary || { todayCount: todayTasks.length, billsThisWeek: 0 };
  $("#headline").textContent = "You have " + summary.todayCount + " things today and " + money(summary.billsThisWeek) + " in bills this week.";
  $("#summaryLine").textContent = "All your important next steps, in one place.";
  const todayMarkup = todayTasks.length ? '<div class="task-grid">' + todayTasks.map(task => taskCard(task)).join("") + "</div>" : '<div class="empty-state"><h2>Nothing urgent today</h2><p>Drop in a note or bill and I’ll help turn it into a clear next step.</p></div>';
  const upcomingMarkup = groupUpcoming(upcoming).map(group => '<p class="week-label">' + group.label + '</p><div class="task-grid">' + group.tasks.map(task => taskCard(task)).join("") + "</div>").join("");
  const doneNames = doneTasks.map(task => escapeHtml(task.title)).join(" · ");
  const doneMarkup = '<details class="done-panel"><summary><span>Done</span><span class="count-pill neutral">' + doneTasks.length + '</span><span class="done-summary-text">' + (doneNames || "Nothing completed yet") + '</span></summary><div class="done-list">' + doneTasks.map(task => '<div class="done-row"><span>' + escapeHtml(task.title) + '</span><button class="text-button" data-action="undo" data-id="' + escapeHtml(task.id) + '">Undo</button></div>').join("") + "</div></details>";
  mainContent.innerHTML = '<section class="task-section"><div class="section-heading"><h2>Today</h2><span class="count-pill">' + todayTasks.length + '</span></div>' + todayMarkup + '</section>' + (upcoming.length ? '<section class="task-section"><div class="section-heading"><h2>Upcoming</h2><span class="count-pill neutral">' + upcoming.length + '</span></div><div class="task-grid upcoming-grid">' + upcomingMarkup + '</div></section>' : "") + '<section class="task-section">' + doneMarkup + '</section>';
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const payload = response.status === 204 ? {} : await response.json();
  if (!response.ok) throw new Error(payload.error || "Something went wrong.");
  return payload;
}
async function loadDashboard() { renderDashboard(await api("/api/tasks?referenceDate=" + localDate())); }
function setMessage(text, error = false) { captureMessage.textContent = text; captureMessage.classList.toggle("error", error); }
function showToast(text) {
  const toast = $("#toast"); toast.textContent = text; toast.classList.add("visible");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("visible"), 2600);
}
function categoryOptions(value) { return ["Bills", "Health", "School", "Home", "Personal"].map(category => '<option' + (category === value ? " selected" : "") + '>' + category + "</option>").join(""); }

function draftEditor(draft, index) {
  const amount = draft.amount?.value ?? "";
  return '<div class="draft-editor" data-draft-index="' + index + '"><label class="field-label" for="draft-title-' + index + '">TASK</label><input id="draft-title-' + index + '" data-field="title" value="' + escapeHtml(draft.title) + '" maxlength="160"><div class="field-row"><div><label class="field-label" for="draft-date-' + index + '">DUE</label><input id="draft-date-' + index + '" data-field="dueDate" type="date" value="' + escapeHtml(draft.dueDate || "") + '"></div><div><label class="field-label" for="draft-amount-' + index + '">AMOUNT · ₹</label><input id="draft-amount-' + index + '" data-field="amount" type="number" min="0" step="0.01" value="' + escapeHtml(amount) + '"></div></div><div class="field-row"><div><label class="field-label" for="draft-category-' + index + '">CATEGORY</label><select id="draft-category-' + index + '" data-field="category">' + categoryOptions(draft.category) + '</select></div><div><label class="field-label" for="draft-source-' + index + '">SOURCE</label><input id="draft-source-' + index + '" value="' + escapeHtml(draft.sourceName || "Pasted note") + '" disabled></div></div><label class="field-label" for="draft-details-' + index + '">WHAT HAPPENED</label><textarea id="draft-details-' + index + '" data-field="details" rows="3">' + escapeHtml(draft.details) + '</textarea><p class="confidence-note">✓ Date and details are ready for your review · ' + Math.round((draft.confidence || .7) * 100) + '% match</p></div>';
}

function renderPreview(data) {
  currentDrafts = data.drafts || []; workspace.classList.add("is-preview"); document.body.classList.add("preview-mode"); captureCard.hidden = true;
  if (!currentDrafts.length) {
    mainContent.innerHTML = '<div class="empty-state"><h2>No clear action found</h2><p>' + escapeHtml(data.message || "Try adding the action and due date to the note.") + '</p><button class="secondary-button" data-action="back">Back to inbox</button></div>';
    return;
  }
  const first = currentDrafts[0];
  const original = data.originalText || first.sourceText || "";
  const previewTitle = currentDrafts.length === 1 ? "Here’s what I understood" : "Here are " + currentDrafts.length + " things I found";
  mainContent.innerHTML = '<div class="preview-columns"><aside class="source-card"><p class="eyebrow teal">SOURCE NOTE</p><h2>What landed in your inbox?</h2><p class="source-name">' + escapeHtml(data.sourceName || "Pasted note") + '</p><p class="source-text">' + escapeHtml(original) + '</p><div class="source-legend"><span><i class="legend-action"></i>Action</span><span><i class="legend-amount"></i>Amount</span><span><i class="legend-date"></i>Date</span></div><button class="secondary-button full-button" data-action="read-again">Read again</button></aside><section class="review-card"><div class="review-heading"><p class="eyebrow teal">DRAFT TASK</p><h2>' + previewTitle + '</h2><p>Check the details, fix anything that looks off, then add them to your inbox.</p></div>' + currentDrafts.map(draftEditor).join("") + '<div class="review-actions"><button id="saveDrafts" class="primary-button">Add to inbox</button><button class="secondary-button" data-action="discard">Discard</button></div></section><aside class="preview-aside"><div class="landing-pill"><span>→</span> Lands in ' + (first.bucket === "today" ? "Today" : first.bucket === "overdue" ? "Today · overdue" : "Upcoming") + '</div><div class="preview-task-card">' + taskCard(first, true) + '</div><p class="preview-explainer">Cards sort themselves by due date. Within two days they turn amber; overdue items turn red.</p></aside></div>';
}

async function processText(text, sourceName = null) {
  if (!text.trim()) { setMessage("Paste a note first, or choose a sample.", true); return; }
  readButton.disabled = true; readButton.textContent = "Reading…"; setMessage("");
  try {
    const result = await api("/api/extract", { method: "POST", body: JSON.stringify({ text, sourceName, referenceDate: localDate() }) });
    result.originalText = text; renderPreview(result);
  } catch (error) { setMessage(error.message, true); }
  finally { readButton.disabled = false; readButton.innerHTML = 'Read it <span aria-hidden="true">→</span>'; }
}

async function saveDrafts() {
  const saveButton = $("#saveDrafts");
  if (!saveButton || saveButton.disabled) return;
  saveButton.disabled = true; saveButton.textContent = "Adding…";
  const editors = [...mainContent.querySelectorAll(".draft-editor")];
  const drafts = editors.map((editor, index) => {
    const read = field => editor.querySelector('[data-field="' + field + '"]').value;
    const amountValue = read("amount"); const original = currentDrafts[index];
    return { title: read("title").trim(), dueDate: read("dueDate") || null, category: read("category"), amount: amountValue ? { value: Number(amountValue), currency: "INR" } : null, details: read("details"), sourceName: original.sourceName };
  });
  try {
    await api("/api/tasks", { method: "POST", body: JSON.stringify({ drafts }) });
    showToast(drafts.length === 1 ? "Added to your inbox" : "Added " + drafts.length + " tasks to your inbox");
    returnToDashboard(); await loadDashboard();
  } catch (error) { showToast(error.message); }
  finally { if (saveButton.isConnected) { saveButton.disabled = false; saveButton.textContent = "Add to inbox"; } }
}

function returnToDashboard() {
  currentDrafts = []; workspace.classList.remove("is-preview"); document.body.classList.remove("preview-mode"); captureCard.hidden = false;
  sourceText.value = ""; fileInput.value = ""; $("#fileLabel").textContent = "or drop a PDF or screenshot"; setMessage("");
}
async function updateTask(id, patch, successMessage) {
  try { await api("/api/tasks/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify(patch) }); if (successMessage) showToast(successMessage); await loadDashboard(); }
  catch (error) { showToast(error.message); }
}
function openEdit(task) {
  if (!task) return;
  $("#editId").value = task.id; $("#editTitle").value = task.title; $("#editDate").value = task.dueDate || "";
  $("#editCategory").value = task.category || "Personal"; $("#editAmount").value = task.amount?.value ?? ""; $("#editDetails").value = task.details || "";
  dialog.showModal();
}
async function loadSamples() {
  try {
    const result = await api("/api/samples"); samples = result.samples || [];
    $("#sampleButtons").innerHTML = samples.map(sample => '<button class="sample-chip" data-sample="' + escapeHtml(sample.id) + '"><i class="sample-dot"></i>' + escapeHtml(sample.label) + '</button>').join("");
  } catch { $("#sampleButtons").innerHTML = '<span class="sample-label">Samples are unavailable while the API is offline.</span>'; }
}
function setHeaderDate() { $("#dateLabel").textContent = prettyDate(localDate(), { weekday: "short" }); }

$("#readButton").addEventListener("click", () => processText(sourceText.value, fileInput.files[0]?.name || null));
$("#mobileAdd").addEventListener("click", () => { captureCard.scrollIntoView({ behavior: "smooth", block: "center" }); sourceText.focus({ preventScroll: true }); });
$("#sampleButtons").addEventListener("click", event => {
  const button = event.target.closest("[data-sample]"); if (!button) return;
  const sample = samples.find(item => item.id === button.dataset.sample);
  if (sample) { sourceText.value = sample.text; processText(sample.text, sample.label); }
});

$("#fileInput").addEventListener("change", async () => {
  const file = fileInput.files[0]; if (!file) return;
  $("#fileLabel").textContent = file.name;
  if (/\.(txt|eml)$/i.test(file.name) || file.type.startsWith("text/")) { sourceText.value = await file.text(); setMessage("Text loaded. Choose Read it when you’re ready."); }
  else setMessage("PDF and image text extraction isn’t enabled yet. Paste the document text to continue.", true);
});
const dropArea = $("#dropArea");
dropArea.addEventListener("dragover", event => { event.preventDefault(); dropArea.classList.add("dragging"); });
dropArea.addEventListener("dragleave", () => dropArea.classList.remove("dragging"));
dropArea.addEventListener("drop", async event => {
  event.preventDefault(); dropArea.classList.remove("dragging"); const file = event.dataTransfer.files[0]; if (!file) return;
  if (/\.(txt|eml)$/i.test(file.name) || file.type.startsWith("text/")) { sourceText.value = await file.text(); $("#fileLabel").textContent = file.name; setMessage("Text loaded. Choose Read it when you’re ready."); }
  else setMessage("PDF and image text extraction isn’t enabled yet. Paste the document text to continue.", true);
});

mainContent.addEventListener("click", async event => {
  if (event.target.id === "saveDrafts") return saveDrafts();
  const button = event.target.closest("[data-action]"); if (!button) return;
  const id = button.dataset.id; const action = button.dataset.action;
  if (action === "done") return updateTask(id, { status: "done" }, "Marked done");
  if (action === "undo") return updateTask(id, { status: "pending" }, "Moved back to your inbox");
  if (action === "snooze") return updateTask(id, { snoozeDays: 1 }, "Snoozed until tomorrow");
  if (action === "edit") return openEdit(activeTasks.find(task => task.id === id) || doneTasks.find(task => task.id === id));
  if (action === "discard" || action === "back") { returnToDashboard(); await loadDashboard(); }
  if (action === "read-again") { returnToDashboard(); sourceText.focus(); }
});

$(".dialog-close").addEventListener("click", () => dialog.close());
$(".dialog-cancel").addEventListener("click", () => dialog.close());
$("#editForm").addEventListener("submit", async event => {
  event.preventDefault(); const amountText = $("#editAmount").value;
  const patch = { title: $("#editTitle").value, dueDate: $("#editDate").value || null, category: $("#editCategory").value, amount: amountText ? { value: Number(amountText), currency: "INR" } : null, details: $("#editDetails").value };
  const id = $("#editId").value; dialog.close(); await updateTask(id, patch, "Task updated");
});

setHeaderDate(); loadSamples();
loadDashboard().catch(error => { mainContent.innerHTML = '<div class="empty-state"><h2>Couldn’t load your inbox</h2><p>' + escapeHtml(error.message) + '</p><button class="secondary-button" data-action="reload">Try again</button></div>'; });
mainContent.addEventListener("click", event => { if (event.target.closest('[data-action="reload"]')) location.reload(); });

