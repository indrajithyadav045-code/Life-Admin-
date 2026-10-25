import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractDrafts, makeId, taskBucket } from "./processor.mjs";

const projectDir = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = process.env.DATA_DIR || join(projectDir, "data");
const dataFile = join(dataDir, "tasks.json");
const port = Number(process.env.PORT ?? 3001);
const production = process.env.NODE_ENV === "production";
const appUser = process.env.APP_USER || "";
const appPassword = process.env.APP_PASSWORD || "";
const MAX_BODY_BYTES = 1_000_000;
const allowedCategories = new Set(["Bills", "Health", "School", "Home", "Personal"]);
const publicFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
]);
let tasks = [];
let persistQueue = Promise.resolve();

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port.");
if (production && (!appUser || !appPassword || appPassword.length < 16)) {
  throw new Error("Production requires APP_USER and an APP_PASSWORD of at least 16 characters.");
}

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
}

function secureEqual(left, right) {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

function isAuthorized(req) {
  if (!production) return true;
  const match = req.headers.authorization?.match(/^Basic\s+([A-Za-z\d+/]+=*)$/i);
  if (!match) return false;
  let credentials;
  try { credentials = Buffer.from(match[1], "base64").toString("utf8"); } catch { return false; }
  const separator = credentials.indexOf(":");
  if (separator < 0) return false;
  return secureEqual(credentials.slice(0, separator), appUser) && secureEqual(credentials.slice(separator + 1), appPassword);
}

function today() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: process.env.APP_TIMEZONE || "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function addDays(date, amount) {
  const result = new Date(date + "T00:00:00.000Z");
  result.setUTCDate(result.getUTCDate() + amount);
  return result.toISOString().slice(0, 10);
}
async function persist() {
  const contents = JSON.stringify(tasks, null, 2);
  const operation = persistQueue.then(async () => {
    await mkdir(dataDir, { recursive: true });
    const tempFile = `${dataFile}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempFile, contents, { encoding: "utf8", mode: 0o600 });
    await rename(tempFile, dataFile);
  });
  persistQueue = operation.catch(() => {});
  return operation;
}

async function load() {
  try {
    tasks = JSON.parse(await readFile(dataFile, "utf8"));
    if (!Array.isArray(tasks)) throw new Error("Stored tasks must be an array.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    tasks = [];
    await persist();
  }
}

function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(status === 204 ? "" : JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request body exceeds 1 MB."), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("Send a valid JSON request body."), { status: 400 }); }
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
function referenceDateFrom(url) {
  const candidate = url.searchParams.get("referenceDate");
  return validDate(candidate) ? candidate : today();
}

function dashboardSummary(referenceDate) {
  const active = tasks.filter(task => task.status !== "done");
  const todayCount = active.filter(task => {
    const bucket = taskBucket(task.dueDate, referenceDate);
    return bucket === "today" || bucket === "overdue";
  }).length;
  const weekEnd = addDays(referenceDate, 6);
  const billsThisWeek = active
    .filter(task => task.category === "Bills" && task.dueDate && task.dueDate >= referenceDate && task.dueDate <= weekEnd)
    .reduce((total, task) => total + (task.amount?.value ?? 0), 0);
  return { todayCount, billsThisWeek, currency: "INR" };
}

const server = createServer(async (req, res) => {
  setSecurityHeaders(res);
  if (req.method === "OPTIONS") return send(res, 204, {});
  const url = new URL(req.url, "http://" + (req.headers.host ?? "localhost"));
  const referenceDate = referenceDateFrom(url);

  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      return send(res, 200, { status: "ok", service: "life-admin-inbox-api" });
    }
    if (!isAuthorized(req)) {
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Life Admin Inbox", charset="UTF-8"', "Cache-Control": "no-store" });
      return res.end("Authentication required.");
    }
    if (req.method === "GET" && publicFiles.has(url.pathname)) {
      const [fileName, contentType] = publicFiles.get(url.pathname);
      const contents = await readFile(join(projectDir, "public", fileName));
      res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache" });
      return res.end(contents);
    }
    if (req.method === "GET" && url.pathname === "/api") {
      return send(res, 200, {
        service: "Life Admin Inbox API",
        status: "ok",
        endpoints: {
          health: "GET /api/health",
          samples: "GET /api/samples",
          dashboard: "GET /api/tasks",
          extract: "POST /api/extract (also POST /api/process)",
          createTask: "POST /api/tasks",
          updateTask: "PATCH /api/tasks/:id",
        },
      });
    }
    if (req.method === "GET" && url.pathname === "/api/samples") {
      return send(res, 200, { samples: [
        { id: "electricity-bill", label: "Electricity bill", text: "Please pay the electricity bill of ₹1,840 for account ending 4521 by today." },
        { id: "school-notice", label: "School notice", text: "Dear parents, please return the signed permission slip for the Grade 4 museum trip with ₹350 by Wednesday. Late slips cannot be accepted." },
        { id: "doctor-appointment", label: "Doctor appointment", text: "Please call Dr. Rao’s clinic to confirm the appointment by tomorrow. Visit on Tuesday at 10:30 AM." },
        { id: "insurance-renewal", label: "Insurance renewal", text: "Renew the car insurance policy TN09-4471 for ₹2,360 by Friday." },
      ] });
    }
    if (req.method === "GET" && url.pathname === "/api/tasks") {
      const active = tasks.filter(task => task.status !== "done")
        .map(task => ({ ...task, bucket: taskBucket(task.dueDate, referenceDate) }))
        .sort((a, b) => (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31"));
      const done = tasks.filter(task => task.status === "done");
      return send(res, 200, { tasks: active, done, summary: dashboardSummary(referenceDate), referenceDate });
    }
    if (req.method === "POST" && (url.pathname === "/api/extract" || url.pathname === "/api/process")) {
      const body = await readJson(req);
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) return send(res, 400, { error: "Add the email, bill, or notice text first." });
      if (text.length > 50_000) return send(res, 413, { error: "Text is too long. Keep it under 50,000 characters." });
      const date = validDate(body.referenceDate) ? body.referenceDate : referenceDate;
      const drafts = extractDrafts(text, date).map(draft => ({
        ...draft,
        id: makeId(),
        sourceName: typeof body.sourceName === "string" ? body.sourceName.slice(0, 160) : null,
        bucket: taskBucket(draft.dueDate, date),
      }));
      return send(res, 200, {
        drafts,
        sourceName: typeof body.sourceName === "string" ? body.sourceName : null,
        message: drafts.length ? "Review the details, then add them to your inbox." : "I couldn’t find a clear action. Try including the requested task and any due date.",
      });
    }
    if (req.method === "POST" && url.pathname === "/api/tasks") {
      const body = await readJson(req);
      const drafts = Array.isArray(body.drafts) ? body.drafts : [body];
      if (!drafts.length) return send(res, 400, { error: "Add at least one reviewed task." });
      const created = drafts.map(draft => {
        if (!draft || typeof draft.title !== "string" || !draft.title.trim()) {
          throw Object.assign(new Error("Every task needs a title."), { status: 400 });
        }
        if (draft.dueDate !== null && draft.dueDate !== undefined && !validDate(draft.dueDate)) {
          throw Object.assign(new Error("Due dates must use YYYY-MM-DD."), { status: 400 });
        }
        const amountValue = Number(draft.amount?.value);
        const amount = draft.amount && Number.isFinite(amountValue) && amountValue >= 0
          ? { value: amountValue, currency: "INR" }
          : null;
        const category = typeof draft.category === "string" && allowedCategories.has(draft.category) ? draft.category : "Personal";
        return {
          id: makeId(),
          title: draft.title.trim().slice(0, 160),
          category,
          dueDate: draft.dueDate ?? null,
          amount,
          details: typeof draft.details === "string" ? draft.details.slice(0, 1200) : "",
          sourceName: typeof draft.sourceName === "string" ? draft.sourceName.slice(0, 160) : null,
          status: "pending",
          createdAt: new Date().toISOString(),
        };
      });
      tasks = [...created, ...tasks];
      const summary = dashboardSummary(referenceDate);
      await persist();
      return send(res, 201, { tasks: created, summary });
    }

    const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (req.method === "PATCH" && taskMatch) {
      const body = await readJson(req);
      const task = tasks.find(item => item.id === decodeURIComponent(taskMatch[1]));
      if (!task) return send(res, 404, { error: "Task not found." });
      if (body.status === "done" || body.status === "pending") task.status = body.status;
      if (typeof body.title === "string" && body.title.trim()) task.title = body.title.trim().slice(0, 160);
      if (typeof body.category === "string" && allowedCategories.has(body.category)) task.category = body.category;
      if (typeof body.details === "string") task.details = body.details.slice(0, 1200);
      if (body.dueDate === null || validDate(body.dueDate)) task.dueDate = body.dueDate;
      if (body.amount === null) task.amount = null;
      else if (body.amount && Number.isFinite(Number(body.amount.value)) && Number(body.amount.value) >= 0) {
        task.amount = { value: Number(body.amount.value), currency: "INR" };
      }
      if (Number.isInteger(body.snoozeDays) && body.snoozeDays > 0 && body.snoozeDays <= 30) {
        task.dueDate = addDays(referenceDate, body.snoozeDays);
      }
      task.bucket = taskBucket(task.dueDate, referenceDate);
      const summary = dashboardSummary(referenceDate);
      await persist();
      return send(res, 200, { task, summary });
    }
    return send(res, 404, { error: "Route not found." });
  } catch (error) {
    console.error(`[${req.method} ${url.pathname}]`, error);
    const message = error.status ? error.message : production ? "The request could not be processed." : (error.message || "Unknown server error.");
    return send(res, error.status ?? 500, { error: message });
  }
});

await load();
server.listen(port, "0.0.0.0", () => console.log(`Life Admin Inbox listening on port ${port} (${production ? "production" : "development"})`));

function shutdown(signal) {
  console.log(`${signal} received; closing server.`);
  server.close(error => {
    if (error) { console.error("Failed to close server cleanly:", error.message); process.exitCode = 1; }
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

