# Life Admin Inbox

Responsive dashboard and dependency-free Node.js API for the Life Admin Inbox prototype. The dashboard follows the supplied desktop and mobile references. It accepts pasted or already-extracted document text, creates editable task drafts, and only saves a task after the user approves it.

## Run on Netlify

Requires Node.js 22.12 or newer. Install dependencies with `npm install`, then run `npm run dev` and open http://localhost:8889. The Netlify CLI serves the dashboard, Functions, and Identity together.

The checked-in Netlify configuration publishes `public` and deploys the API as Netlify Functions. No frontend build command is required. Task records use Netlify Database with Drizzle; schema migrations in `netlify/database/migrations` are applied automatically by Netlify during deployment. Do not apply them manually.

Create an account from the dashboard, confirm your email, and sign in. Each account can only read and edit its own tasks. Forgot password sends a reset email, and confirmation, recovery, and invitation links are handled at the homepage. Identity must be enabled for the site. Sessions refresh through the account and API endpoints.

Run `npm run check` for JavaScript syntax and TypeScript checks. `/api/health` is public; other API endpoints require a signed-in Identity session. Write requests also require a matching Origin header.

## Frontend flow

1. GET /api/samples supplies the four sample buttons.
2. POST /api/extract (or POST /api/process) powers Read it and returns draft cards for the extraction preview. It does not save them.
3. POST /api/tasks saves the reviewed task or tasks after Add to inbox.
4. GET /api/tasks returns Today, Overdue, Upcoming, Done, and dashboard summary data.
5. PATCH /api/tasks/:id handles Done/Undo, Snooze, and Edit.

For PDF/image uploads, the frontend should send extracted text as text; this API does not parse binary documents yet.

## API example

    POST /api/extract
    Content-Type: application/json
    {"text":"Please return the signed permission slip with ₹350 by Wednesday.","sourceName":"school-notice.pdf","referenceDate":"2026-10-25"}

The response includes a drafts array with title, category, dueDate, amount, details, source text, and confidence. To save a reviewed draft, POST /api/tasks with {"drafts":[...]}.

Task due dates use ISO YYYY-MM-DD; amounts use INR. The built-in MVP extractor recognizes common action phrases, today/tomorrow, weekdays, ISO and month-name dates, categories, and rupee amounts. It is deterministic, so users can review and correct every draft before saving.

## Original standalone server

`src/server.mjs`, the Dockerfile, and Compose configuration are retained as the original local API prototype. That server uses a local JSON store and Basic authentication in production; it is not the Netlify deployment entry point and does not provide the dashboard's new Identity account flow. Use `npm run dev` for the complete application.
