# TaskMaster — Collaborative Task Tracking API

A backend for a team task-tracking app. Users register, create teams, create and assign tasks, filter/search them, discuss them in comments, attach files, and get real-time notifications.

**Stack:** Node.js · Express 5 · SQLite via sql.js (pure JS, no native build) · JWT auth · bcrypt · multer · Server-Sent Events

---

## Features

| Area | What's implemented |
|---|---|
| Auth | Register, login, logout (token revocation), bcrypt password hashing, JWT sessions |
| Users | View / update profile (name, email, bio, password), user search |
| Tasks | Create, read, update, delete · status (`open`, `in_progress`, `completed`) · priority · due date |
| Tasks | Filter by status / priority / assignee / team / due-date range · full-text search on title + description · sort · pagination |
| Teams | Create team, join by invite code, invite by email, list members, remove member / leave, owner & admin roles |
| Collaboration | Assign tasks to teammates, comments, file attachments (upload + download) |
| Real-time | Notifications stored in DB **and** pushed live via Server-Sent Events (`/api/notifications/stream`) |
| AI (optional) | `POST /api/ai/describe` generates a task description from a title (uses Claude API if a key is set, else a local template) |
| Quality | Input validation (express-validator), consistent JSON errors, access control on every resource, 18-check end-to-end test (`npm test`) |

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Create your config file
cp .env.example .env        # Windows: copy .env.example .env
#    then open .env and set JWT_SECRET to any long random string

# 3. Run
npm start                   # or: npm run dev  (auto-restarts on changes)
```

The API is now at **http://localhost:3000**. The SQLite database file is created automatically at `data/taskmaster.db` — nothing else to install, and no C++ compiler is needed (sql.js is SQLite compiled to WebAssembly).

Run the end-to-end test (uses an in-memory DB, leaves no files behind):

```bash
npm test
```

---

## Project structure

```
src/
├── server.js                 # starts the HTTP server
├── app.js                    # Express app: middleware + route mounting
├── config/
│   ├── env.js                # reads .env with safe defaults
│   └── db.js                 # SQLite (sql.js) adapter + schema (auto-created) + save-to-disk
├── middleware/
│   ├── auth.js               # JWT check -> req.user
│   ├── validate.js           # turns express-validator failures into 400s
│   └── errorHandler.js       # 404 + global error -> JSON
├── routes/                   # URL -> validation rules -> controller
│   ├── auth.routes.js
│   ├── user.routes.js
│   ├── task.routes.js        # tasks + nested comments + attachments
│   ├── team.routes.js
│   ├── notification.routes.js
│   └── ai.routes.js
├── controllers/              # request handling logic
├── services/                 # shared logic: access rules, notifications, AI
└── utils/ApiError.js         # error class with HTTP status
scripts/smoke-test.js         # npm test
requests.http                 # ready-made requests (VS Code REST Client)
```

---

## Authentication

Every endpoint except `/api/auth/register` and `/api/auth/login` needs a header:

```
Authorization: Bearer <token>
```

You get the token from register or login. Tokens expire after `JWT_EXPIRES_IN` (default 1 day). Logging out records the token's id in a `revoked_tokens` table so it can't be reused even before it expires.

---

## API reference

Base URL: `http://localhost:3000/api`

### Auth

| Method | Endpoint | Body | Description |
|---|---|---|---|
| POST | `/auth/register` | `{ name, email, password }` | Create account. Returns `{ user, token }` |
| POST | `/auth/login` | `{ email, password }` | Log in. Returns `{ user, token }` |
| POST | `/auth/logout` | — | Revoke the current token |

### Users

| Method | Endpoint | Body | Description |
|---|---|---|---|
| GET | `/users/me` | — | My profile |
| PATCH | `/users/me` | `{ name?, email?, bio?, password? }` | Update my profile |
| GET | `/users?q=ali` | — | Search users by name/email (to find people to invite/assign) |

### Teams

| Method | Endpoint | Body | Description |
|---|---|---|---|
| GET | `/teams` | — | Teams I belong to |
| POST | `/teams` | `{ name, description? }` | Create a team (you become owner). Response includes `inviteCode` |
| POST | `/teams/join` | `{ inviteCode }` | Join a team using its invite code |
| GET | `/teams/:id` | — | Team details + members |
| PATCH | `/teams/:id` | `{ name?, description? }` | Update (owner/admin) |
| DELETE | `/teams/:id` | — | Delete (owner only) |
| GET | `/teams/:id/members` | — | List members |
| POST | `/teams/:id/invite` | `{ email }` | Add an existing user directly (owner/admin) |
| DELETE | `/teams/:id/members/:userId` | — | Remove a member (owner/admin) or leave (yourself) |

### Tasks

| Method | Endpoint | Body | Description |
|---|---|---|---|
| GET | `/tasks` | — | List tasks I can see (see query params below) |
| POST | `/tasks` | `{ title, description?, dueDate?, priority?, teamId?, assigneeId? }` | Create a task |
| GET | `/tasks/:id` | — | Task with its comments and attachments |
| PATCH | `/tasks/:id` | any of `title, description, status, priority, dueDate, assigneeId` | Update |
| DELETE | `/tasks/:id` | — | Delete (creator or team admin) |
| POST | `/tasks/:id/assign` | `{ assigneeId }` | Assign to a user (`null` to unassign) |
| POST | `/tasks/:id/complete` | — | Mark as completed |

**Query parameters for `GET /tasks`** (all optional, combine freely):

| Param | Example | Meaning |
|---|---|---|
| `status` | `status=open` | `open` \| `in_progress` \| `completed` |
| `priority` | `priority=high` | `low` \| `medium` \| `high` |
| `assignee` | `assignee=me` or `assignee=7` | Tasks assigned to me / to user 7 |
| `teamId` | `teamId=3` | Tasks in team 3 |
| `search` | `search=login` | Case-insensitive match on title **or** description |
| `dueBefore` / `dueAfter` | `dueBefore=2026-12-31` | Due-date range |
| `sortBy` | `sortBy=dueDate` | `createdAt` (default) \| `dueDate` \| `title` \| `status` \| `priority` \| `updatedAt` |
| `order` | `order=asc` | `asc` \| `desc` (default) |
| `page`, `limit` | `page=2&limit=10` | Pagination (limit max 100) |

Example: `GET /api/tasks?status=open&assignee=me&sortBy=dueDate&order=asc`

**Visibility rule:** you can see a task if you created it, it's assigned to you, or it belongs to a team you're in.

### Comments (nested under a task)

| Method | Endpoint | Body | Description |
|---|---|---|---|
| GET | `/tasks/:taskId/comments` | — | List comments |
| POST | `/tasks/:taskId/comments` | `{ content }` | Add a comment |
| DELETE | `/tasks/:taskId/comments/:id` | — | Delete your own comment |

### Attachments (nested under a task)

| Method | Endpoint | Body | Description |
|---|---|---|---|
| GET | `/tasks/:taskId/attachments` | — | List attachments |
| POST | `/tasks/:taskId/attachments` | `multipart/form-data`, field **`file`** | Upload (max 5 MB by default) |
| GET | `/tasks/:taskId/attachments/:id/download` | — | Download the file |
| DELETE | `/tasks/:taskId/attachments/:id` | — | Delete (uploader only) |

### Notifications

| Method | Endpoint | Description |
|---|---|---|
| GET | `/notifications?unread=true` | My notifications (newest first) |
| PATCH | `/notifications/:id/read` | Mark one as read |
| PATCH | `/notifications/read-all` | Mark all as read |
| GET | `/notifications/stream` | **Server-Sent Events** live stream |

Notifications are generated when: a task is assigned to you, a task you're involved in is updated, someone comments on or attaches a file to your task, someone joins your team, or you're added to a team.

Try the live stream in a terminal (keep it open, then make a change from another client):

```bash
curl -N -H "Authorization: Bearer <token>" http://localhost:3000/api/notifications/stream
```

### AI (optional)

| Method | Endpoint | Body | Description |
|---|---|---|---|
| POST | `/ai/describe` | `{ title, notes? }` | Returns `{ description, provider }` |

Set `ANTHROPIC_API_KEY` in `.env` to use the Claude API; without it a local template is used so the endpoint always works.

---

## Example walkthrough (curl)

```bash
# Register and grab the token
curl -s -X POST localhost:3000/api/auth/register -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@example.com","password":"password123"}'

# Create a team (copy the inviteCode from the response)
curl -s -X POST localhost:3000/api/teams -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Backend Squad"}'

# Create a task in that team
curl -s -X POST localhost:3000/api/tasks -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Write API docs","dueDate":"2026-12-31","priority":"high","teamId":1}'

# Search
curl -s "localhost:3000/api/tasks?search=docs&status=open" -H "Authorization: Bearer TOKEN"

# Upload an attachment
curl -s -X POST localhost:3000/api/tasks/1/attachments -H "Authorization: Bearer TOKEN" -F "file=@./notes.txt"
```

A full set of requests is in **`requests.http`** — open it in VS Code with the *REST Client* extension and click "Send Request".

---

## Error format

All errors return JSON with the right HTTP status:

```json
{ "error": { "message": "Validation failed", "details": [ { "field": "email", "message": "A valid email is required" } ] } }
```

| Status | When |
|---|---|
| 400 | Validation failed / bad input |
| 401 | Missing, invalid, expired or logged-out token |
| 403 | Logged in but not allowed (not a team member, not the author, …) |
| 404 | Resource doesn't exist |
| 409 | Conflict (duplicate email, already a member, …) |
| 500 | Unexpected server error (details are logged, not exposed) |

---

## Data model

```
users ──< team_members >── teams
  │                          │
  │ creator / assignee       │ team_id
  └──────────< tasks >───────┘
                 │
      ┌──────────┼──────────┐
   comments  attachments  notifications
```

Full schema with constraints is in `src/config/db.js`.

---

## Design decisions

- **SQLite via sql.js** keeps setup to `npm install && npm start` — no DB server and no native compilation (the original `better-sqlite3` needs Visual Studio build tools on Windows, which is a poor fit for a shared repo). `src/config/db.js` wraps sql.js in a small synchronous API (`prepare().get/all/run`, `exec`, `transaction`) and saves the database to `data/taskmaster.db` after every write. Swapping to Postgres/MySQL would mean replacing that one file and the SQL strings; the route/controller layer stays the same.
- **Stateless JWT + revocation table** gives real logout without storing sessions server-side for every request.
- **SSE instead of WebSockets** for notifications: notifications are one-directional (server → client), SSE needs no extra library, and it works through plain HTTP and proxies.
- **Validation at the route layer** (express-validator) so controllers only ever see clean input.
- **Access control in services** (`task.service.requireTaskAccess`, `team.service.requireMember`) so every endpoint applies the same rule instead of repeating it.

---

## Environment variables

See `.env.example`. Only `JWT_SECRET` really needs changing for a real deployment.

## License

MIT
