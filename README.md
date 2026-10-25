# Life Admin Inbox

Responsive dashboard and dependency-free Node.js API for the Life Admin Inbox prototype. The dashboard follows the supplied desktop and mobile references. It accepts pasted or already-extracted document text, creates editable task drafts, and only saves a task after the user approves it.

## Run

Requires Node.js 20 or newer.

    cd D:\LifeAdminInbox
    npm run dev

For a non-watching run, use npm start.

The server listens on http://localhost:3001 (override with PORT). A new install starts with an empty inbox; use the sample chips or paste your own text to create tasks. DATA_DIR controls where the JSON store is written.

Open http://localhost:3001/ for the dashboard. The API route guide is at http://localhost:3001/api.

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

## Deploy to Vercel (free)

The Vercel build uses static files from public/ and a Node.js Function for the API. Task data is stored in Neon Postgres; it is not written to Vercel's temporary filesystem.

1. Create a Neon Postgres project and copy its pooled connection string (DATABASE_URL).
2. In Vercel Project Settings → Environment Variables, add DATABASE_URL, APP_USER, and APP_PASSWORD for Production. Set APP_PASSWORD to a unique value at least 16 characters long. Keep all three values private.
3. Push this repository to Vercel or redeploy the latest commit. The API creates its small task table automatically on first request.
4. Open the deployment URL. The browser will ask for APP_USER and APP_PASSWORD; sign-in is kept only for the current tab session.

Neon's free database compute may scale to zero while idle, so the first request after a quiet period can be slower. The database stores tasks independently of Vercel function instances.

## Deploy with Docker

This is a private, single-user MVP. Production mode requires HTTP Basic authentication (APP_USER and a unique APP_PASSWORD of at least 16 characters), and the health endpoint is the only unauthenticated route. Put it behind HTTPS before making it reachable outside your machine or private network. It is not a multi-user service: tasks share one store and there are no user accounts or tenant boundaries.

1. Install Docker with Compose support.
2. Copy .env.example to .env and replace the sample username and password with unique values. Keep .env private; it is ignored by Git and excluded from the image.
3. From the project folder, run docker compose up --build -d.
4. Open http://localhost:3001/. Your browser will ask for the Basic Auth username and password.

Compose attaches a named volume at /app/data, so saved tasks survive container replacement. Back up that volume. When deploying to a container host, use the Dockerfile, set NODE_ENV=production, APP_USER, APP_PASSWORD, PORT, DATA_DIR, and optionally APP_TIMEZONE (defaults to Asia/Kolkata), and attach durable storage at DATA_DIR. The host must terminate HTTPS. Do not run multiple replicas against this JSON file store; use a database before scaling out. /api/health is available for the host's liveness check.

Run npm run check for JavaScript syntax checks. npm start starts the local Node server; for production, set NODE_ENV=production and the required authentication variables before starting it.
