import type { Config } from "@netlify/functions";
import { getUser, refreshSession, verifyRequestOrigin } from "@netlify/identity";
import { and, eq, desc } from "drizzle-orm";
import { getDb } from "../../db/index.js";
import { tasks as taskTable } from "../../db/schema.js";
import { extractDrafts, makeId, taskBucket } from "../../src/processor.mjs";

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: Netlify.env.get("APP_TIMEZONE") || "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function addDays(date, amount) {
  const result = new Date(date + "T00:00:00.000Z");
  result.setUTCDate(result.getUTCDate() + amount);
  return result.toISOString().slice(0, 10);
}
export function send(status, body) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
export async function readJson(req: Request) {
  const reader = req.body?.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_000_000) {
        await reader.cancel();
        throw Object.assign(new Error("Request body exceeds 1 MB."), { status: 413 });
      }
      chunks.push(value);
    }
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw Object.assign(new Error("Send a valid JSON object."), { status: 400 }); }
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

function dashboardSummary(tasks, referenceDate) {
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


export default async (req: Request) => {
  const url = new URL(req.url);
  const referenceDate = referenceDateFrom(url);
  const allowedCategories = new Set(["Bills", "Health", "School", "Home", "Personal"]);
  try {
    if (req.method === "OPTIONS") return send(204, {});
    if (req.method === "GET" && url.pathname === "/api/health") return send(200, { status: "ok", service: "life-admin-inbox-api" });
    if (!["GET", "HEAD"].includes(req.method)) verifyRequestOrigin(req);
    await refreshSession();
    const user = await getUser();
    if (!user) return send(401, { error: "Sign in to open your private inbox." });
    const db = getDb();
    let tasks: any[] = url.pathname.startsWith("/api/tasks")
      ? await db.select().from(taskTable).where(eq(taskTable.userId, user.id)).orderBy(desc(taskTable.createdAt)) : [];
    if (req.method === "GET" && url.pathname === "/api") {
      return send(200, {
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
      return send(200, { samples: [
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
      return send(200, { tasks: active, done, summary: dashboardSummary(tasks, referenceDate), referenceDate });
    }
    if (req.method === "POST" && (url.pathname === "/api/extract" || url.pathname === "/api/process")) {
      const body = await readJson(req);
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) return send(400, { error: "Add the email, bill, or notice text first." });
      if (text.length > 50_000) return send(413, { error: "Text is too long. Keep it under 50,000 characters." });
      const date = validDate(body.referenceDate) ? body.referenceDate : referenceDate;
      const drafts = extractDrafts(text, date).map(draft => ({
        ...draft,
        id: makeId(),
        sourceName: typeof body.sourceName === "string" ? body.sourceName.slice(0, 160) : null,
        bucket: taskBucket(draft.dueDate, date),
      }));
      return send(200, {
        drafts,
        sourceName: typeof body.sourceName === "string" ? body.sourceName : null,
        message: drafts.length ? "Review the details, then add them to your inbox." : "I couldn’t find a clear action. Try including the requested task and any due date.",
      });
    }
    if (req.method === "POST" && url.pathname === "/api/tasks") {
      const body = await readJson(req);
      const drafts = Array.isArray(body.drafts) ? body.drafts : [body];
      if (!drafts.length) return send(400, { error: "Add at least one reviewed task." });
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
      const summary = dashboardSummary(tasks, referenceDate);
      await db.insert(taskTable).values(created.map(task => ({ ...task, userId: user.id })));
      return send(201, { tasks: created, summary });
    }

    const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (req.method === "PATCH" && taskMatch) {
      const body = await readJson(req);
      const task = tasks.find(item => item.id === decodeURIComponent(taskMatch[1]));
      if (!task) return send(404, { error: "Task not found." });
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
      const summary = dashboardSummary(tasks, referenceDate);
      const { bucket, ...saved } = task;
      await db.update(taskTable).set(saved).where(and(eq(taskTable.id, task.id), eq(taskTable.userId, user.id)));
      return send(200, { task, summary });
    }
    return send(404, { error: "Route not found." });
  } catch (error) {
    return send(error.status ?? 500, { error: error.status ? error.message : "The request could not be processed. Please try again." });
  }
};

export const config: Config = { path: ["/api", "/api/*"] };
