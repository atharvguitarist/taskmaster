/**
 * Optional generative-AI helper (user story 14).
 *
 * POST /api/ai/describe { title, notes? }  -> { description }
 *
 * If ANTHROPIC_API_KEY is set in .env, the Claude API is called to write a
 * clear task description from the title and rough notes.
 * If it is NOT set, a simple local template is used instead, so the endpoint
 * still works (and the smoke test passes) without any external account.
 */
const env = require('../config/env');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';

async function generateDescription({ title, notes = '' }) {
  if (!env.anthropicApiKey) {
    return {
      provider: 'local-template',
      description:
        `Task: ${title}.` +
        (notes ? ` Context: ${notes.trim()}.` : '') +
        ' Define the expected outcome, list the concrete steps needed, and note any blockers or dependencies before marking this complete.',
    };
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.anthropicApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content:
            `Write a concise task description (2-4 sentences, plain text, no headings) for a task tracker.\n` +
            `Title: ${title}\n` +
            (notes ? `Notes from the user: ${notes}\n` : '') +
            `Describe the goal, what "done" looks like, and any obvious steps.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI provider error (${response.status}): ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const description = (data.content || []).map((c) => c.text || '').join('').trim();
  return { provider: 'anthropic', description };
}

module.exports = { generateDescription };
