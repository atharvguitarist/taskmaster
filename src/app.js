/**
 * Express application: middleware + route mounting.
 * Kept separate from server.js so tests can import the app without opening a port.
 */
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const taskRoutes = require('./routes/task.routes');
const teamRoutes = require('./routes/team.routes');
const notificationRoutes = require('./routes/notification.routes');
const aiRoutes = require('./routes/ai.routes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

// ---- Global middleware ----
app.use(cors());                               // allow browser front-ends on other origins
app.use(express.json({ limit: '1mb' }));       // parse JSON bodies
app.use(express.urlencoded({ extended: true }));

// Tiny request logger (method, path, status, duration).
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// ---- Routes ----
app.get('/', (req, res) => {
  res.json({
    name: 'TaskMaster API',
    version: '1.0.0',
    docs: 'See README.md for the full endpoint list',
    health: '/api/health',
  });
});
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/ai', aiRoutes);

// ---- Fallbacks ----
app.use(notFound);
app.use(errorHandler);

module.exports = app;
