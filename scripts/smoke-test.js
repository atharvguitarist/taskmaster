/**
 * End-to-end smoke test.  Run with:  npm test
 *
 * Boots the app on a random port with an in-memory SQLite DB, then walks
 * through every user story using plain fetch(). No test framework needed.
 */
process.env.DB_FILE = ':memory:';
process.env.JWT_SECRET = 'smoke-test-secret';
process.env.UPLOAD_DIR = require('path').join(require('os').tmpdir(), 'taskmaster-smoke-uploads');

const assert = require('assert');
const app = require('../src/app');
const db = require('../src/config/db');

let BASE;
let passed = 0;

async function api(method, path, { token, body, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !raw) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

async function step(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

async function run() {
  await db.init();
  const server = app.listen(0);
  BASE = `http://127.0.0.1:${server.address().port}`;
  console.log(`\nSmoke test against ${BASE}\n`);

  let alice; let bob; let team; let task;

  try {
    await step('health check', async () => {
      const r = await api('GET', '/api/health');
      assert.equal(r.status, 200);
      assert.equal(r.json.status, 'ok');
    });

    // ---- User stories 1-3: register, login, profile ----
    await step('register (story 1)', async () => {
      const r = await api('POST', '/api/auth/register', { body: { name: 'Alice', email: 'alice@example.com', password: 'password123' } });
      assert.equal(r.status, 201, r.text);
      assert.ok(r.json.token);
      assert.equal(r.json.user.password_hash, undefined, 'password hash must never be returned');
      alice = { token: r.json.token, id: r.json.user.id };

      const r2 = await api('POST', '/api/auth/register', { body: { name: 'Bob', email: 'bob@example.com', password: 'password123' } });
      bob = { token: r2.json.token, id: r2.json.user.id };
    });

    await step('register validation + duplicate email', async () => {
      const r = await api('POST', '/api/auth/register', { body: { name: 'X', email: 'bad', password: '1' } });
      assert.equal(r.status, 400);
      assert.ok(Array.isArray(r.json.error.details));
      const dup = await api('POST', '/api/auth/register', { body: { name: 'Alice2', email: 'alice@example.com', password: 'password123' } });
      assert.equal(dup.status, 409);
    });

    await step('login (story 2)', async () => {
      const r = await api('POST', '/api/auth/login', { body: { email: 'alice@example.com', password: 'password123' } });
      assert.equal(r.status, 200, r.text);
      alice.token = r.json.token;
      const bad = await api('POST', '/api/auth/login', { body: { email: 'alice@example.com', password: 'wrong' } });
      assert.equal(bad.status, 401);
    });

    await step('profile view + update (story 3)', async () => {
      const r = await api('GET', '/api/users/me', { token: alice.token });
      assert.equal(r.json.user.email, 'alice@example.com');
      const u = await api('PATCH', '/api/users/me', { token: alice.token, body: { bio: 'Backend dev', name: 'Alice W' } });
      assert.equal(u.status, 200, u.text);
      assert.equal(u.json.user.bio, 'Backend dev');
      const noAuth = await api('GET', '/api/users/me');
      assert.equal(noAuth.status, 401);
    });

    // ---- Story 11: teams ----
    await step('create team + invite + join (story 11)', async () => {
      const r = await api('POST', '/api/teams', { token: alice.token, body: { name: 'Backend Squad', description: 'API work' } });
      assert.equal(r.status, 201, r.text);
      team = r.json.team;
      assert.equal(team.myRole, 'owner');

      const j = await api('POST', '/api/teams/join', { token: bob.token, body: { inviteCode: team.inviteCode } });
      assert.equal(j.status, 200, j.text);

      const m = await api('GET', `/api/teams/${team.id}/members`, { token: alice.token });
      assert.equal(m.json.members.length, 2);

      const dupJoin = await api('POST', '/api/teams/join', { token: bob.token, body: { inviteCode: team.inviteCode } });
      assert.equal(dupJoin.status, 409);
    });

    // ---- Story 4: create task ----
    await step('create task (story 4)', async () => {
      const r = await api('POST', '/api/tasks', {
        token: alice.token,
        body: { title: 'Write API docs', description: 'Document every endpoint', dueDate: '2026-12-31', priority: 'high', teamId: team.id },
      });
      assert.equal(r.status, 201, r.text);
      task = r.json.task;
      assert.equal(task.status, 'open');
      const bad = await api('POST', '/api/tasks', { token: alice.token, body: { description: 'no title' } });
      assert.equal(bad.status, 400);
    });

    // ---- Story 7: assign ----
    await step('assign task to teammate (story 7) + notification created', async () => {
      const r = await api('POST', `/api/tasks/${task.id}/assign`, { token: alice.token, body: { assigneeId: bob.id } });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.task.assignee.id, bob.id);
      const n = await api('GET', '/api/notifications?unread=true', { token: bob.token });
      assert.ok(n.json.notifications.some((x) => x.type === 'task_assigned'), 'bob should be notified');
    });

    // ---- Story 5: my tasks ----
    await step('list tasks assigned to me (story 5)', async () => {
      const r = await api('GET', '/api/tasks?assignee=me', { token: bob.token });
      assert.equal(r.status, 200);
      assert.equal(r.json.tasks.length, 1);
      assert.equal(r.json.tasks[0].id, task.id);
    });

    // ---- Stories 8 & 9: filter + search + sort ----
    await step('filter / search / sort (stories 8, 9)', async () => {
      await api('POST', '/api/tasks', { token: alice.token, body: { title: 'Fix login bug', description: 'Users cannot sign in', priority: 'low' } });
      const open = await api('GET', '/api/tasks?status=open', { token: alice.token });
      assert.equal(open.json.tasks.length, 2);
      const search = await api('GET', '/api/tasks?search=login', { token: alice.token });
      assert.equal(search.json.tasks.length, 1);
      assert.equal(search.json.tasks[0].title, 'Fix login bug');
      const sorted = await api('GET', '/api/tasks?sortBy=title&order=asc', { token: alice.token });
      assert.equal(sorted.json.tasks[0].title, 'Fix login bug');
      assert.ok(sorted.json.pagination.total === 2);
      const badFilter = await api('GET', '/api/tasks?status=bogus', { token: alice.token });
      assert.equal(badFilter.status, 400);
    });

    // ---- Story 10: comments + attachments ----
    await step('add comment (story 10)', async () => {
      const r = await api('POST', `/api/tasks/${task.id}/comments`, { token: bob.token, body: { content: 'Started on this' } });
      assert.equal(r.status, 201, r.text);
      const l = await api('GET', `/api/tasks/${task.id}/comments`, { token: alice.token });
      assert.equal(l.json.comments.length, 1);
      const n = await api('GET', '/api/notifications?unread=true', { token: alice.token });
      assert.ok(n.json.notifications.some((x) => x.type === 'task_comment'));
    });

    await step('upload + download attachment (story 10)', async () => {
      const form = new FormData();
      form.append('file', new Blob(['hello attachment'], { type: 'text/plain' }), 'notes.txt');
      const r = await api('POST', `/api/tasks/${task.id}/attachments`, { token: alice.token, body: form, raw: true });
      assert.equal(r.status, 201, r.text);
      assert.equal(r.json.attachment.fileName, 'notes.txt');
      const d = await api('GET', r.json.attachment.downloadUrl, { token: bob.token });
      assert.equal(d.status, 200);
      assert.equal(d.text, 'hello attachment');
    });

    // ---- Story 6: complete ----
    await step('mark task completed (story 6)', async () => {
      const r = await api('POST', `/api/tasks/${task.id}/complete`, { token: bob.token });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.task.status, 'completed');
      const done = await api('GET', '/api/tasks?status=completed', { token: alice.token });
      assert.equal(done.json.tasks.length, 1);
    });

    // ---- Access control ----
    await step('non-member cannot see a team task', async () => {
      const r = await api('POST', '/api/auth/register', { body: { name: 'Eve', email: 'eve@example.com', password: 'password123' } });
      const g = await api('GET', `/api/tasks/${task.id}`, { token: r.json.token });
      assert.equal(g.status, 403);
      const missing = await api('GET', '/api/tasks/9999', { token: alice.token });
      assert.equal(missing.status, 404);
    });

    // ---- Story 13: SSE stream ----
    await step('real-time SSE notification (story 13)', async () => {
      const controller = new AbortController();
      const res = await fetch(`${BASE}/api/notifications/stream`, {
        headers: { Authorization: `Bearer ${bob.token}` },
        signal: controller.signal,
      });
      assert.ok(res.headers.get('content-type').startsWith('text/event-stream'));
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = decoder.decode((await reader.read()).value); // "connected" event

      // Trigger a notification for Bob.
      await api('PATCH', `/api/tasks/${task.id}`, { token: alice.token, body: { priority: 'low' } });

      while (!buffer.includes('event: notification')) {
        buffer += decoder.decode((await reader.read()).value);
      }
      assert.ok(buffer.includes('task_updated'));
      controller.abort();
    });

    // ---- Story 14: AI description ----
    await step('AI task description (story 14, local fallback)', async () => {
      const r = await api('POST', '/api/ai/describe', { token: alice.token, body: { title: 'Set up CI pipeline', notes: 'GitHub Actions' } });
      assert.equal(r.status, 200, r.text);
      assert.ok(r.json.description.length > 20);
    });

    // ---- Story 12: logout ----
    await step('logout invalidates token (story 12)', async () => {
      const r = await api('POST', '/api/auth/logout', { token: alice.token });
      assert.equal(r.status, 200);
      const after = await api('GET', '/api/users/me', { token: alice.token });
      assert.equal(after.status, 401);
    });

    await step('404 for unknown route', async () => {
      const r = await api('GET', '/api/nothing-here');
      assert.equal(r.status, 404);
    });

    console.log(`\nAll ${passed} checks passed.\n`);
  } catch (err) {
    console.error(`\nFAILED after ${passed} passing checks:\n`, err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
}

run();
