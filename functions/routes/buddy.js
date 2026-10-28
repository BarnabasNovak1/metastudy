// ================================================================
// Study Buddy: a lightweight companion chat that remembers the user,
// replies like a friend (supportive but honest), and recommends in-app
// next steps. Costs 0.5 credits per message and never does the heavy
// tools' work (no summaries, quizzes, lessons, or file reading).
// Conversation persists into chat_sessions so it shows up in AI Chat.
// ================================================================
import {
  requireAuth, enforceWordLimit, enforceDailyAILimit, aiLimiter,
  reserveUsage, refundUsage, llamaChat, fdb, deduplicatedRequest,
} from './shared.js';
import { FieldValue } from 'firebase-admin/firestore';

const BUDDY_COST = 0.5;
const MAX_MESSAGE_CHARS = 1500;
const MAX_REPLY_CHARS = 3000;
const MAX_HISTORY = 12;
const MAX_MEMORY = 30;
const BUDDY_TITLE = 'Study Buddy';

// Personality prompts mirror the AI Chat personalities (same ids) so the
// buddy inherits whatever the student picks in Settings.
const PERSONALITIES = {
  normal: 'You are a helpful, knowledgeable AI tutor. Provide clear, accurate explanations and be supportive in your responses.',
  professor: 'You are a university professor with decades of teaching experience. You speak formally, provide detailed explanations, and encourage critical thinking. Use academic language and provide comprehensive insights.',
  k12teacher: 'You are a warm, encouraging K-12 teacher. You explain concepts in simple, engaging ways suitable for younger students. Use age-appropriate language, be patient, and include encouraging phrases. Make learning fun and accessible!',
  sherlock: 'You are Sherlock Holmes, the world\'s only consulting detective. Speak with British precision and intellectual superiority. Use deductive reasoning in your explanations. Point out obvious details others might miss. Use phrases like "Elementary, my dear student", "The game is afoot!", and "You see, but you do not observe." Analyze problems with logical precision.',
  yoda: 'You are Yoda, the great Jedi Master. Speak in your unique backwards sentence structure. Be wise, patient, and profound. Use the Force as a metaphor for knowledge and learning. Key phrases: "Much to learn, you still have", "Do or do not, there is no try", "The greatest teacher, failure is." Always end with deep wisdom and encourage mindfulness in learning.',
  jokester: 'You are a hilarious, joke-cracking tutor who makes learning fun! Include puns, dad jokes, and witty humor in every response. Keep things lighthearted but educational. Use emojis occasionally. Make learning feel like a comedy show while still teaching effectively. Start or end responses with funny jokes related to the topic.',
  studybuddy: 'You are the user\'s close friend. Be understanding, supportive, and trustworthy. Speak casually and kindly. Listen first, ask gentle clarifying questions, and encourage them. Help with anything they bring up - homework, career, life admin, or motivation - while staying positive and non-judgmental. Keep it real and relatable, use light emojis sparingly when it helps, and focus on being a dependable friend they can trust.',
  scoobydoo: 'You are Scooby-Doo! Speak with your characteristic speech pattern: "Ruh-roh!", "Scooby-Dooby-Doo!", "Zoinks!". Be easily scared but ultimately brave and loyal. Talk about mysteries and clues. Use phrases like "Let\'s split up, gang!" when approaching complex problems. Be enthusiastic about solving "mysteries" (learning challenges) with your friends.',
};

const ALLOWED_SUGGESTION_PATHS = new Set([
  '/study', '/pricing', '/achievements', '/account', '/faq', '/usage',
  '/study?tab=chat', '/study?tab=summarizer', '/study?tab=flashcards',
  '/study?tab=quizzes', '/study?tab=planner', '/study?tab=feed', '/study?tab=career',
]);

const BASE_PROMPT = `You are Buddy, the student's personal study companion inside MetaStudy. You are a friend first: warm, honest, and human.

Rules:
- Chat like a real friend. Encourage and motivate, but stay honest: if the user says something wrong, lazy, or a bad idea, push back like a friend would - light teasing is fine, cruelty is not.
- You do NOT do the study tools' work. Never write summaries, essays, flashcards, quizzes, or lessons, never solve whole assignments for them, and never claim to read files or links (you cannot). If a tool would help, recommend it via "suggestion".
- Keep replies short: 1-4 sentences unless they ask for more.
- "suggestion" (optional): {"label": short button text, "path": one of ${[...ALLOWED_SUGGESTION_PATHS].join(', ')}}. Only use it when it genuinely helps.
- "memory_updates" (optional): up to 2 short, durable facts worth remembering about the user (goals, struggles, deadlines, subjects, preferences, how they react to your tone). If they dislike your teasing or style, record that. Return [] when nothing new.

Return ONLY JSON: {"reply": string, "memory_updates"?: string[], "suggestion"?: {"label": string, "path": string}}`;

const buddyDoc = (uid) => fdb.collection('users').doc(uid).collection('meta').doc('buddy');
const sessionsCol = (uid) => fdb.collection('users').doc(uid).collection('chat_sessions');

function sanitizeHistory(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }))
    .slice(-MAX_HISTORY);
}

function normalizeSuggestion(s) {
  if (!s || typeof s !== 'object') return undefined;
  const path = typeof s.path === 'string' ? s.path.trim() : '';
  const label = typeof s.label === 'string' ? s.label.trim().slice(0, 60) : '';
  if (!ALLOWED_SUGGESTION_PATHS.has(path) || !label) return undefined;
  return { label, path };
}

export function register(app) {
  app.post('/buddy', requireAuth, aiLimiter, enforceDailyAILimit, enforceWordLimit, async (req, res) => {
    const uid = req.authUid;
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message || message.length > MAX_MESSAGE_CHARS) {
      return res.status(400).json({ error: 'Message must be 1-1500 characters.' });
    }
    const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.slice(0, 80) : '';
    const run = () => handleBuddy(uid, message, sanitizeHistory(req.body?.history));
    try {
      const out = requestId
        ? await deduplicatedRequest(`buddy:${uid}:${requestId}`, run)
        : await run();
      return res.json(out);
    } catch (e) {
      const status = Number(e?.status) || 500;
      return res.status(status).json({ error: e?.message || 'Buddy is unavailable right now.' });
    }
  });
}

async function handleBuddy(uid, message, history) {
  const [userSnap, buddySnap] = await Promise.all([
    fdb.collection('users').doc(uid).get(),
    buddyDoc(uid).get(),
  ]);
  const profile = userSnap.exists ? userSnap.data() : {};
  const buddyData = buddySnap.exists ? buddySnap.data() : {};

  const personalityId = PERSONALITIES[profile.buddy_personality] ? profile.buddy_personality : 'studybuddy';
  const notes = Array.isArray(buddyData.notes) ? buddyData.notes.slice(-MAX_MEMORY) : [];
  let sessionId = typeof buddyData.sessionId === 'string' ? buddyData.sessionId : null;

  // Ensure the persistent buddy chat exists before charging - the user's
  // message must survive even if the model call fails.
  let sessionRef = sessionId ? sessionsCol(uid).doc(sessionId) : null;
  if (sessionRef && !(await sessionRef.get()).exists) { sessionRef = null; sessionId = null; }
  if (!sessionRef) {
    sessionRef = await sessionsCol(uid).add({
      title: BUDDY_TITLE,
      kind: 'buddy',
      personality_id: personalityId,
      personalities: [personalityId],
      created_at: new Date().toISOString(),
      updated_at: FieldValue.serverTimestamp(),
    });
    sessionId = sessionRef.id;
  }

  const msgsRef = sessionRef.collection('messages');
  await msgsRef.add({ role: 'user', content: message, created_at: FieldValue.serverTimestamp() });

  const rsv = await reserveUsage(uid, BUDDY_COST);
  if (!rsv.allowed) {
    const err = new Error(rsv.error || 'Monthly uses limit reached');
    err.status = 403;
    throw err;
  }

  let out;
  try {
    const memoryBlock = notes.length
      ? `\n\nWhat you remember about this student:\n${notes.map((n) => `- ${n}`).join('\n')}`
      : '';
    const raw = await llamaChat(
      [
        { role: 'system', content: `${BASE_PROMPT}\n\nPersonality: ${PERSONALITIES[personalityId]}${memoryBlock}` },
        ...history,
        { role: 'user', content: message },
      ],
      { temperature: 0.6, max_tokens: 900, response_format: { type: 'json_object' } },
    );
    try {
      out = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      out = m ? JSON.parse(m[0]) : {};
    }
  } catch (e) {
    try { await refundUsage(uid, rsv.consumed); } catch {}
    throw e;
  }

  const reply = typeof out?.reply === 'string' ? out.reply.trim().slice(0, MAX_REPLY_CHARS) : '';
  if (!reply) {
    try { await refundUsage(uid, rsv.consumed); } catch {}
    throw new Error('Buddy had nothing to say. Try again.');
  }
  const suggestion = normalizeSuggestion(out.suggestion);

  const updates = (Array.isArray(out.memory_updates) ? out.memory_updates : [])
    .filter((n) => typeof n === 'string' && n.trim())
    .map((n) => n.trim().slice(0, 140))
    .slice(0, 2);
  const mergedNotes = [...new Set([...notes, ...updates])].slice(-MAX_MEMORY);

  const batch = fdb.batch();
  batch.set(msgsRef.doc(), {
    role: 'assistant',
    content: reply,
    assistant_personality_id: personalityId,
    ...(suggestion ? { suggestion } : {}),
    created_at: FieldValue.serverTimestamp(),
  });
  batch.update(sessionRef, { updated_at: FieldValue.serverTimestamp() });
  batch.set(buddyDoc(uid), { sessionId, notes: mergedNotes, updated_at: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();

  return { reply, suggestion, sessionId };
}
