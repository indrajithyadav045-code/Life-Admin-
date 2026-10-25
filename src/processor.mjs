const ACTION_PATTERNS = [
  /\b(?:please\s+)?(?:remember\s+to\s+)?(?:pay|submit|return|renew|confirm|call|book|schedule|attend|send|sign|complete|pick\s+up|collect|service|file|register|bring|review|cancel|reschedule|upload|drop\s+off)\b/i,
  /\b(?:needs?\s+to\s+be|must\s+be|has\s+to\s+be)\s+(?:paid|submitted|returned|renewed|confirmed|signed|completed|sent|filed|uploaded)\b/i,
  /\b(?:is|are)\s+due\b/i,
];

const MONTHS = new Map([
  ["jan", 0], ["january", 0], ["feb", 1], ["february", 1], ["mar", 2], ["march", 2],
  ["apr", 3], ["april", 3], ["may", 4], ["jun", 5], ["june", 5], ["jul", 6], ["july", 6],
  ["aug", 7], ["august", 7], ["sep", 8], ["sept", 8], ["september", 8],
  ["oct", 9], ["october", 9], ["nov", 10], ["november", 10], ["dec", 11], ["december", 11],
]);
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function isoDate(date) { return date.toISOString().slice(0, 10); }
function startOfDay(date) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); }

function parseMonthDate(text, base) {
  const match = text.match(/\b(?:by|before|on|due(?:\s+date)?\s*[:=-]?)\s*([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i)
    ?? text.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i);
  if (!match) return null;
  const month = MONTHS.get(match[1].toLowerCase());
  if (month === undefined) return null;
  const day = Number(match[2]);
  let year = match[3] ? Number(match[3]) : base.getUTCFullYear();
  let parsed = new Date(Date.UTC(year, month, day));
  if (parsed.getUTCMonth() !== month || parsed.getUTCDate() !== day) return null;
  if (!match[3] && parsed < base) {
    year += 1;
    parsed = new Date(Date.UTC(year, month, day));
  }
  return isoDate(parsed);
}

function findDueDate(text, referenceDate) {
  const base = startOfDay(new Date(referenceDate + "T00:00:00.000Z"));
  const lower = text.toLowerCase();
  if (/\bday after tomorrow\b/.test(lower)) {
    base.setUTCDate(base.getUTCDate() + 2);
    return isoDate(base);
  }
  if (/\btomorrow\b/.test(lower)) {
    base.setUTCDate(base.getUTCDate() + 1);
    return isoDate(base);
  }
  if (/\btoday\b/.test(lower)) return isoDate(base);

  const weekdayMatch = lower.match(/\b(?:(next|this)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (weekdayMatch) {
    const [, qualifier, weekday] = weekdayMatch;
    const target = WEEKDAYS.indexOf(weekday);
    let delta = (target - base.getUTCDay() + 7) % 7;
    if (delta === 0 && qualifier !== "this") delta = 7;
    if (qualifier === "next" && delta < 7) delta += 7;
    base.setUTCDate(base.getUTCDate() + delta);
    return isoDate(base);
  }

  const isoMatch = text.match(/\b(?:by|before|on|due(?:\s+date)?\s*[:=-]?)\s*(\d{4})-(\d{1,2})-(\d{1,2})\b/i);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (parsed.getUTCMonth() === Number(month) - 1 && parsed.getUTCDate() === Number(day)) return isoDate(parsed);
  }
  return parseMonthDate(text, base);
}

function extractAmount(text) {
  const match = text.match(/(?:₹|INR\s?)(\d[\d,]*(?:\.\d{1,2})?)/i)
    ?? text.match(/\b(\d[\d,]*(?:\.\d{1,2})?)\s?(?:rupees?|INR)\b/i);
  return match ? { value: Number(match[1].replaceAll(",", "")), currency: "INR" } : null;
}

function categoryFor(text) {
  const lower = text.toLowerCase();
  if (/\b(doctor|clinic|appointment|medicine|hospital|health|dentist|prescription)\b/.test(lower)) return "Health";
  if (/\b(school|teacher|student|class|permission slip|field trip|museum|homework|parent)\b/.test(lower)) return "School";
  if (/\b(bill|electricity|water bill|insurance|premium|payment|account ending|invoice)\b/.test(lower)) return "Bills";
  if (/\b(home|house|repair|service|technician|plumb|ac\b|maintenance)\b/.test(lower)) return "Home";
  return "Personal";
}

function titleFor(sentence) {
  let title = sentence
    .replace(/^(?:dear\s+[^,]+,?\s*)/i, "")
    .replace(/^\s*(?:please\s+)?/i, "")
    .replace(/\b(?:by|before|on)\s+(?:today|tomorrow|next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|[A-Za-z]{3,9}\.?\s+\d{1,2}|\d{4}-\d{2}-\d{2}).*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:]+$/, "")
    .trim();
  if (!title) title = sentence.trim();
  return title.length > 80 ? title.slice(0, 77).trimEnd() + "…" : title;
}

export function extractDrafts(text, referenceDate) {
  const sentences = text.replace(/\r/g, "\n").split(/(?<=[.!?])\s+|\n+/).map(item => item.trim()).filter(Boolean);
  return sentences
    .filter(sentence => ACTION_PATTERNS.some(pattern => pattern.test(sentence)))
    .map(sentence => {
      const dueDate = findDueDate(sentence, referenceDate);
      const amount = extractAmount(sentence);
      return { title: titleFor(sentence), category: categoryFor(sentence), dueDate, amount, details: sentence, sourceText: text, confidence: amount || dueDate ? 0.88 : 0.72 };
    });
}

export function taskBucket(dueDate, referenceDate) {
  if (!dueDate) return "upcoming";
  if (dueDate < referenceDate) return "overdue";
  if (dueDate === referenceDate) return "today";
  return "upcoming";
}

export function makeId() { return globalThis.crypto.randomUUID(); }

