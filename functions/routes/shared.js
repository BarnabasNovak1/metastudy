// ================================================================
// Shared setup for the Express API: app, global middleware, Firebase
// Admin, Llama/Stripe clients, usage/quota helpers, validation schemas.
// Extracted from server.js - every route module imports from here.
// ================================================================
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import * as Sentry from '@sentry/node';
import { z } from 'zod';
import bodyParser from 'body-parser';
// AI calls go to Meta's Llama API (OpenAI-compatible) via plain fetch - no SDK needed
import Stripe from 'stripe';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import * as functions from 'firebase-functions/v1';
import { reserveUserUsage, refundUserUsage } from '../lib/usage.js';

export const app = express();

// ================================================================
// SENTRY ERROR MONITORING
// ================================================================
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'production',
    tracesSampleRate: 0.1,
    // Do not attach IP addresses or other "default PII" fields to events
    sendDefaultPii: false,
    // Strip request bodies, cookies, and auth headers before an event ever
    // leaves the process. Request bodies can contain student-submitted
    // content (chat messages, uploaded text, prompts); auth headers/cookies
    // are credentials. Only minimal diagnostic info (route, method, status,
    // stack trace) is retained.
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        if (event.request.headers) {
          delete event.request.headers.authorization;
          delete event.request.headers.cookie;
        }
        if (event.request.query_string) delete event.request.query_string;
      }
      if (Array.isArray(event.breadcrumbs)) {
        for (const b of event.breadcrumbs) {
          if (b?.data) delete b.data.body;
        }
      }
      return event;
    },
  });
  app.use(Sentry.expressErrorHandler());
}

// ================================================================
// RATE LIMITING
// ================================================================
const createRateLimiter = (windowMs, max, message) => rateLimit({
  windowMs,
  max,
  message: { error: message },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.authUid || req.ip,
  // Disable express-rate-limit v8 IPv6 validation â€” Cloud Functions sits behind Google's proxy
  validate: false,
});

// General API rate limit: 100 requests per minute
const generalLimiter = createRateLimiter(60 * 1000, 100, 'Too many requests, please try again later.');

// AI endpoints rate limit: 10 requests per minute (reduced to control API costs)
const aiLimiter = createRateLimiter(60 * 1000, 10, 'AI request limit reached. Please wait a moment.');

// Apply general rate limit to all routes
app.use(generalLimiter);

// ================================================================
// ZOD VALIDATION SCHEMAS
// ================================================================
const chatRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
  })).min(1).max(60),
  personality_id: z.string().optional(),
  word_limit: z.number().optional(),
  userId: z.string().optional(),
});

const summarizeRequestSchema = z.object({
  text: z.string().min(1, 'Text is required'),
  format: z.enum(['bullet_points', 'paragraph', 'outline', 'cornell', 'mindmap']).optional(),
  length: z.enum(['short', 'medium', 'long']).optional(),
  focus: z.string().optional(),
  userId: z.string().optional(),
});

const flashcardsRequestSchema = z.object({
  text: z.string().min(1, 'Text is required'),
  count: z.number().min(1).max(50).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  userId: z.string().optional(),
});

const quizRequestSchema = z.object({
  text: z.string().min(1, 'Text is required'),
  questionCount: z.number().min(1).max(50).optional(),
  questionTypes: z.array(z.string()).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  userId: z.string().optional(),
});

const lessonRequestSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  subjects: z.union([z.array(z.string()), z.string()]).optional(),
  difficulty: z.string().optional(),
  audience: z.string().optional(),
  studyDuration: z.string().optional(),
  includeFlashcards: z.boolean().optional(),
  includeQuiz: z.boolean().optional(),
  includeHomework: z.boolean().optional(),
  userId: z.string().optional(),
});

const visionExtractSchema = z.object({
  images: z.array(z.object({
    data: z.string().min(1).max(15_000_000), // ~11MB base64 per page image
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif']),
  })).min(1).max(10),
});

// Validation middleware factory
const validate = (schema) => (req, res, next) => {
  try {
    req.body = schema.parse(req.body);
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: error.errors.map(e => ({ path: e.path.join('.'), message: e.message })) 
      });
    }
    next(error);
  }
};
const originOk = (origin) => {
  if (!origin) return true;
  try {
    return /^(https:\/\/)?(www\.)?metastudy-e1ba2\.web\.app$/.test(new URL(origin).origin)
      || /^(https:\/\/)?metastudy-e1ba2\.firebaseapp\.com$/.test(new URL(origin).origin)
      || origin === 'http://localhost:5173'
      || origin === 'http://localhost:8080';
  } catch { return false; }
};
const corsOptions = {
  origin: (origin, callback) => callback(null, originOk(origin)),
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: true,
  optionsSuccessStatus: 204,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
// Vision OCR endpoint accepts base64 page images -> needs a larger JSON body limit.
// Registered before the global parser; body-parser skips bodies that were already parsed.
app.use(['/vision-extract', '/api/vision-extract'], bodyParser.json({ limit: '25mb' }));
app.use(bodyParser.json({ limit: '2mb' }));

// Support Hosting rewrites like "/api/**" by stripping the "/api" prefix if present
app.use((req, _res, next) => {
  if (req.url === '/api') {
    req.url = '/';
  } else if (req.url.startsWith('/api/')) {
    req.url = req.url.substring(4);
  }
  next();
});

// ==================== AUTH MIDDLEWARE ====================
// Verifies Firebase ID token from Authorization: Bearer <token> header
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }
    const idToken = authHeader.slice(7);
    const decoded = await getAuth().verifyIdToken(idToken);
    req.authUid = decoded.uid;
    req.authEmail = decoded.email || '';
    req.authToken = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired authentication token' });
  }
}

// Initialize Admin SDK if not already (server.js may be loaded before index.js initialization)
try { admin.app(); } catch { try { admin.initializeApp(); } catch {} }
const fdb = getFirestore();

// ==================== OPTIMIZED USAGE TRACKING ====================
// Cache for user quotas to avoid repeated reads (TTL: 60 seconds)
const quotaCache = new Map();
const CACHE_TTL = 60000;

// ==================== LLAMA RESPONSE CACHING ====================
// Cache for Llama responses to avoid duplicate API calls (TTL: 5 minutes)
const responseCache = new Map();
const RESPONSE_CACHE_TTL = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 100;

function getCacheKey(model, messages, options = {}) {
  const msgStr = JSON.stringify(messages.slice(-3)); // Only use last 3 messages for key
  const optStr = JSON.stringify({ temp: options.temperature, format: options.response_format?.type });
  return `${model}:${Buffer.from(msgStr + optStr).toString('base64').slice(0, 64)}`;
}

function getCachedResponse(key) {
  const cached = responseCache.get(key);
  if (cached && Date.now() - cached.ts < RESPONSE_CACHE_TTL) {
    return cached.response;
  }
  responseCache.delete(key);
  return null;
}

function setCachedResponse(key, response) {
  // Evict old entries if cache is too large
  if (responseCache.size >= MAX_CACHE_SIZE) {
    const oldest = [...responseCache.entries()]
      .sort((a, b) => a[1].ts - b[1].ts)
      .slice(0, 20);
    oldest.forEach(([k]) => responseCache.delete(k));
  }
  responseCache.set(key, { response, ts: Date.now() });
}

// Optimized Llama call with caching and retry
async function cachedLlamaCall(messages, options = {}) {
  const cacheKey = getCacheKey(LLAMA_MODEL, messages, options);

  // Check cache first
  const cached = getCachedResponse(cacheKey);
  if (cached) {
    return cached;
  }

  // Make API call with retry logic
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await llamaChat(messages, options);
      
      // Cache successful response
      setCachedResponse(cacheKey, response);
      return response;
    } catch (e) {
      lastError = e;
      if (e?.status === 429 || e?.message?.includes('429') || e?.message?.includes('rate')) {
        // Rate limited, wait and retry
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      } else {
        throw e;
      }
    }
  }
  throw lastError;
}

// ==================== REQUEST DEDUPLICATION ====================
// Prevent duplicate concurrent requests for the same operation
const pendingRequests = new Map();

async function deduplicatedRequest(key, fn) {
  const existing = pendingRequests.get(key);
  if (existing) {
    return existing; // Return existing promise
  }
  
  const promise = fn().finally(() => {
    pendingRequests.delete(key);
  });
  
  pendingRequests.set(key, promise);
  return promise;
}

// Get monthly quota with caching (reduces reads for repeated calls)
async function getMonthlyQuota(uid) {
  const cached = quotaCache.get(uid);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.quota;
  try {
    const userSnap = await fdb.collection('users').doc(uid).get();
    const quota = Number(userSnap.exists ? (userSnap.data()?.monthly_quota ?? 5) : 5);
    quotaCache.set(uid, { quota, ts: Date.now() });
    return quota;
  } catch { throw new Error('Could not verify account quota. Please try again.'); }
}

// Per-plan input cap: word_limit lives on the user doc (PLAN_CONFIG). The client
// truncates too, but the API is public to authed users â€” clamp here so a direct
// call can't bypass it with oversized input.
const wordLimitCache = new Map();
async function getWordLimit(uid) {
  const cached = wordLimitCache.get(uid);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.limit;
  try {
    const snap = await fdb.collection('users').doc(uid).get();
    const limit = Math.max(500, Number(snap.exists ? (snap.data()?.word_limit || 3000) : 3000));
    wordLimitCache.set(uid, { limit, ts: Date.now() });
    return limit;
  } catch { return 3000; }
}

const WORD_LIMIT_FIELDS = new Set(['text', 'content', 'context', 'notes', 'resume', 'resumeText', 'transcript', 'material', 'description', 'question', 'answer', 'rubric', 'essay']);

function clampWords(s, limit) {
  const words = s.trim().split(/\s+/);
  return words.length > limit ? words.slice(0, limit).join(' ') : s;
}
function clampBodyWords(obj, limit, depth = 0) {
  if (!obj || depth > 6) return;
  if (Array.isArray(obj)) { for (const it of obj) clampBodyWords(it, limit, depth + 1); return; }
  if (typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'messages' && Array.isArray(v)) {
      // Chat history: cap cumulative words across messages, newest first
      let budget = limit * 2;
      for (let i = v.length - 1; i >= 0 && budget > 0; i--) {
        const m = v[i];
        if (m && typeof m === 'object' && typeof m.content === 'string') {
          const words = m.content.trim().split(/\s+/);
          if (words.length > budget) m.content = words.slice(-budget).join(' ');
          budget -= Math.min(words.length, budget);
        }
      }
      continue;
    }
    if (typeof v === 'string' && WORD_LIMIT_FIELDS.has(k)) obj[k] = clampWords(v, limit);
    else if (v && typeof v === 'object') clampBodyWords(v, limit, depth + 1);
  }
}

const enforceWordLimit = async (req, res, next) => {
  try {
    const uid = req.authUid;
    if (uid && req.body && typeof req.body === 'object') {
      clampBodyWords(req.body, await getWordLimit(uid));
    }
  } catch {}
  next();
};

// OPTIMIZED: Check limit with minimal reads (1 read to counters, quota cached)
async function checkUsageLimit(uid) {
  if (!uid || !fdb) throw new Error('Usage service unavailable. Please try again.');
  try {
    const monthlyQuota = await getMonthlyQuota(uid);
    const countersSnap = await fdb.collection('users').doc(uid).collection('meta').doc('counters').get();
    const cdata = countersSnap.exists ? (countersSnap.data() || {}) : {};
    const usesThisMonth = Number(cdata.uses_this_month || 0);
    const extraUses = Number(cdata.extra_uses_balance || 0);
    if (usesThisMonth >= monthlyQuota && extraUses <= 0) {
      return { allowed: false, error: 'Monthly uses limit reached' };
    }
    return { allowed: true };
  } catch (e) {
    console.error('checkUsageLimit error:', e);
    throw new Error('Could not verify usage. Please try again.');
  }
}

// Keep the reservation token for a refund if the downstream AI call fails.
async function reserveUsage(uid) {
  return reserveUserUsage(fdb, uid);
}

// Return a previously reserved usage slot after a downstream failure.
async function refundUsage(uid, consumed) {
  try {
    await refundUserUsage(fdb, uid, consumed);
  } catch (e) { console.error('refundUsage error:', e); }
}
// ================================================================

const LLAMA_API_KEY = process.env.LLAMA_API_KEY || process.env.META_API_KEY || '';
const LLAMA_API_BASE = (process.env.LLAMA_API_BASE || 'https://api.meta.ai/v1').replace(/\/+$/, '');
const LLAMA_MODEL = process.env.LLAMA_MODEL || 'muse-spark-1.3';
const STRIPE_KEY = (process.env.STRIPE_SECRET_KEY || '').trim();

// Daily AI usage limits to prevent API abuse
const DAILY_AI_CALL_LIMIT = 100; // max AI calls per user per day (across all features)

// Check and increment daily AI usage
async function checkDailyAILimit(uid) {
  const today = new Date().toISOString().split('T')[0];
  const dailyRef = fdb.collection('users').doc(uid).collection('meta').doc('daily_usage');
  return fdb.runTransaction(async (tx) => {
    const dailySnap = await tx.get(dailyRef);
    const dailyData = dailySnap.data() || {};
    const aiCallsToday = dailyData.date === today ? Number(dailyData.ai_calls || 0) : 0;
    if (aiCallsToday >= DAILY_AI_CALL_LIMIT) {
      return { allowed: false, error: `Daily AI limit reached (${DAILY_AI_CALL_LIMIT}/day). Try again tomorrow.` };
    }
    tx.set(dailyRef, { date: today, ai_calls: aiCallsToday + 1 }, { merge: true });
    return { allowed: true };
  });
}

// Middleware form of the daily cap — blocks burst spend even when monthly quota remains.
const enforceDailyAILimit = async (req, res, next) => {
  try {
    const daily = await checkDailyAILimit(req.authUid);
    if (!daily.allowed) return res.status(429).json({ error: daily.error });
  } catch (e) {
    console.error('checkDailyAILimit failed:', e);
  }
  next();
};

// Chat completion - OpenAI-compatible messages API on api.meta.ai (Meta Model API).
// Message content may be a string or an array of OpenAI-style content parts
// ({ type: 'text' } / { type: 'image_url' }) for vision requests.
async function llamaChat(messages, options = {}) {
  const { temperature = 0.3, response_format, max_tokens = 8192, reasoning_effort = 'low' } = options;
  if (!LLAMA_API_KEY) throw new Error('LLAMA_API_KEY is not set');
  const isJson = response_format?.type === 'json_object';

  const out = messages.map(m => ({ role: m.role, content: m.content }));

  // If JSON output is required, reinforce it in the system prompt -
  // response_format alone is not always honored
  if (isJson) {
    const jsonNote = 'IMPORTANT: You MUST respond with valid JSON only. No markdown, no code fences, no explanations outside the JSON.';
    const sysIdx = out.findIndex(m => m.role === 'system' && typeof m.content === 'string');
    if (sysIdx >= 0) out[sysIdx].content += '\n\n' + jsonNote;
    else out.unshift({ role: 'system', content: jsonNote });
  }

  const body = {
    model: LLAMA_MODEL,
    messages: out,
    temperature,
    max_completion_tokens: max_tokens,
    reasoning_effort,
  };
  if (isJson) body.response_format = { type: 'json_object' };

  const resp = await fetch(`${LLAMA_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LLAMA_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    const err = new Error(`Llama API error ${resp.status}: ${t.slice(0, 300)}`);
    err.status = resp.status;
    throw err;
  }
  const json = await resp.json();
  const content = json?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
}

// Initialize Admin to read Stripe customer mapping from Firestore (Stripe Extension writes customers/{uid})
try { admin.app(); } catch { admin.initializeApp(); }
const db = getFirestore();
const getStripeCustomerId = async (uid) => {
  if (!uid) return null;
  // Check users/{uid}.stripe_customer_id first (set by our webhook)
  try {
    const userSnap = await db.doc(`users/${uid}`).get();
    if (userSnap.exists) {
      const custId = (userSnap.data() || {}).stripe_customer_id;
      if (custId) return custId;
    }
  } catch {}
  // Fallback: check Stripe Extension's customers/{uid} collection
  try {
    const snap = await db.doc(`customers/${uid}`).get();
    if (!snap.exists) return null;
    const d = snap.data() || {};
    return d.stripeId || d.customer_id || d.stripe_id || null;
  } catch { return null; }
};

// Career: Rate Resume -> { score, summary, strengths, improvements }
// Stripe is optional: with no STRIPE_SECRET_KEY the client can't be constructed
// (it throws), so export a stub that fails cleanly inside the billing routes
// instead of taking down every function that imports this module.
const stripe = STRIPE_KEY
  ? new Stripe(STRIPE_KEY, { apiVersion: '2024-06-20' })
  : new Proxy({}, { get: () => { throw new Error('Billing is not configured (STRIPE_SECRET_KEY missing)'); } });

const PRICE_MAP = {
  BASIC: process.env.VITE_PRICE_BASIC,
  ADVANCED: process.env.VITE_PRICE_ADVANCED,
  PRO: process.env.VITE_PRICE_PRO,
  ADDON_10: process.env.VITE_PRICE_ADDON_10,
};

const PLAN_CONFIG = {
  BASIC: { plan: 'basic', monthly_quota: 50, word_limit: 5000 },
  ADVANCED: { plan: 'advanced', monthly_quota: 200, word_limit: 7000 },
  PRO: { plan: 'pro', monthly_quota: 500, word_limit: 15000 },
  FREE: { plan: 'free', monthly_quota: 5, word_limit: 3000 },
};

// Barrel export: every free variable used by route modules resolves here.
export {
  // firebase / firestore
  fdb, db,
  // third-party clients + config
  stripe, LLAMA_API_KEY, LLAMA_API_BASE, LLAMA_MODEL,
  STRIPE_KEY, PRICE_MAP, PLAN_CONFIG,
  // middleware
  requireAuth, enforceWordLimit, enforceDailyAILimit, validate,
  generalLimiter, aiLimiter, createRateLimiter,
  // usage limits / quota helpers
  DAILY_AI_CALL_LIMIT,
  checkUsageLimit, checkDailyAILimit, reserveUsage, refundUsage, getMonthlyQuota, getWordLimit,
  // zod schemas
  chatRequestSchema, summarizeRequestSchema, flashcardsRequestSchema,
  quizRequestSchema, lessonRequestSchema, visionExtractSchema,
  // AI helpers
  llamaChat, cachedLlamaCall, deduplicatedRequest,
  // billing helpers
  getStripeCustomerId,
  // caches + misc helpers
  quotaCache, responseCache, pendingRequests, wordLimitCache,
  getCacheKey, getCachedResponse, setCachedResponse,
  clampWords, clampBodyWords, WORD_LIMIT_FIELDS,
  originOk, corsOptions,
};
