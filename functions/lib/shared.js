import * as functions from 'firebase-functions/v1';
import admin from 'firebase-admin';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import Stripe from 'stripe';
import { Resend } from 'resend';
import crypto from 'crypto';


// Lazy-initialized Stripe instance for functions that declare secrets: ['STRIPE_SECRET_KEY']
// Secrets are injected at runtime (not module load), so we defer initialization
let _stripe = null;
function getStripe() {
  if (!_stripe) {
    _stripe = new Stripe((process.env.STRIPE_SECRET_KEY || '').trim(), { apiVersion: '2024-06-20' });
  }
  return _stripe;
}

// Initialize Admin SDK once
try { admin.app(); } catch { admin.initializeApp(); }
const db = getFirestore();

// Helper: read price IDs from environment variables
const PRICE_MAP = {
  BASIC: process.env.PRICE_BASIC || process.env.VITE_PRICE_BASIC || '',
  ADVANCED: process.env.PRICE_ADVANCED || process.env.VITE_PRICE_ADVANCED || '',
  PRO: process.env.PRICE_PRO || process.env.VITE_PRICE_PRO || '',
  ADDON_10: process.env.PRICE_ADDON_10 || process.env.VITE_PRICE_ADDON_10 || '',
};

const PLAN_CONFIG = {
  BASIC: { plan: 'basic', monthly_quota: 50, word_limit: 5000 },
  ADVANCED: { plan: 'advanced', monthly_quota: 200, word_limit: 7000 },
  PRO: { plan: 'pro', monthly_quota: 500, word_limit: 15000 },
  FREE: { plan: 'free', monthly_quota: 5, word_limit: 3000 },
};

// Internal helper: apply institution plan / status to a user. Used by both
// activateInstitutionPlan (signup-time) and confirmInstitutionEmail (self-heal
// after email confirm). Returns a structured result describing what happened
// so callers can decide whether to surface errors.
async function applyInstitutionStatusForUser(uid, requestedInstitutionId) {
  // Fetch auth user and profile in parallel - independent reads.
  const [userRecRes, usnap] = await Promise.all([
    getAuth().getUser(uid).catch(() => null),
    db.collection('users').doc(uid).get(),
  ]);
  const email = (userRecRes?.email || '').toLowerCase();
  if (!email) return { ok: false, reason: 'no-email' };

  const domain = email.includes('@') ? email.split('@')[1] : '';
  if (!domain) return { ok: false, reason: 'invalid-email' };

  const uref = db.collection('users').doc(uid);
  const udata = usnap.exists ? (usnap.data() || {}) : {};

  // Locate institution: explicit id -> profile id -> email-domain match.
  // Fire all three lookups at once - they're independent reads.
  const [reqDoc, profileDoc, domainQ] = await Promise.all([
    requestedInstitutionId ? db.collection('institutions').doc(String(requestedInstitutionId)).get() : Promise.resolve(null),
    udata.institutionId ? db.collection('institutions').doc(String(udata.institutionId)).get() : Promise.resolve(null),
    domain ? db.collection('institutions').where('emailDomain', '==', domain).limit(1).get() : Promise.resolve(null),
  ]);
  const instDoc = (reqDoc?.exists ? reqDoc : null)
    || (profileDoc?.exists ? profileDoc : null)
    || (domainQ && !domainQ.empty ? domainQ.docs[0] : null);
  if (!instDoc) return { ok: false, reason: 'no-institution' };

  const inst = instDoc.data() || {};
  const instDomain = String(inst.emailDomain || '').toLowerCase();
  if (instDomain && domain !== instDomain) {
    return { ok: false, reason: 'domain-mismatch', domain, instDomain };
  }

  const userLimit = Number(inst.userLimit || 0);
  const currentUserCount = Number(inst.currentUserCount || 0);
  if (userLimit > 0 && currentUserCount >= userLimit) {
    return { ok: false, reason: 'limit-reached', userLimit };
  }

  const now = new Date();
  const day = Math.min(28, Math.max(1, now.getUTCDate()));
  const planTier = String(inst.planTier || '').toUpperCase();
  let applied = null;
  if (planTier === 'BASIC') applied = PLAN_CONFIG.BASIC;
  else if (planTier === 'ADVANCED') applied = PLAN_CONFIG.ADVANCED;
  else if (planTier === 'PRO') applied = PLAN_CONFIG.PRO;

  const institutionName = String(inst.name || instDoc.id);
  const updates = {
    verifiedInstitution: true,
    institutionId: instDoc.id,
    schoolName: institutionName,
    education_level: institutionName,
    usage_cycle_day: day,
    cycle_start_at: FieldValue.serverTimestamp(),
  };
  if (applied) {
    Object.assign(updates, applied, { planTier });
  } else if (planTier) {
    updates.planTier = planTier;
    console.warn(`[institutionStatus] Institution ${instDoc.id} has planTier "${planTier}" but no PLAN_CONFIG match; user ${uid} marked verifiedInstitution without plan fields.`);
  } else {
    console.warn(`[institutionStatus] Institution ${instDoc.id} has no planTier set; user ${uid} marked verifiedInstitution without plan fields.`);
  }

  await uref.set(updates, { merge: true });

  // Increment institution user count (only on transition to verified for this inst)
  if (!udata.verifiedInstitution || udata.institutionId !== instDoc.id) {
    try {
      await db.collection('institutions').doc(instDoc.id).update({
        currentUserCount: FieldValue.increment(1),
      });
    } catch (e) {
      console.warn('Could not increment institution user count:', e?.message || e);
    }
  }

  // Seed counters.usage_period_end so UI can render reset day immediately
  try {
    const ref = db.collection('users').doc(uid).collection('meta').doc('counters');
    const nowUTC = new Date();
    const y = nowUTC.getUTCFullYear();
    const m = nowUTC.getUTCMonth();
    const d = nowUTC.getUTCDate();
    const next = (d < day) ? new Date(Date.UTC(y, m, day)) : new Date(Date.UTC(y, m + 1, day));
    await ref.set({ usage_period_end: next.toISOString() }, { merge: true });
  } catch {}

  return { ok: true, updates, planApplied: !!applied, institutionId: instDoc.id };
}

// =========================
// Friends/Username Utilities
// =========================

function validateUsername(raw) {
  const name = String(raw || '').trim().toLowerCase();
  const ok = /^[a-z0-9.]{3,20}$/.test(name);
  return { ok, name };
}

function makeSuggestions(base, count = 3) {
  const root = String(base || '').slice(0, 16);
  const variations = [
    `${root}123`,
    `${root}.ai`,
    `${root}${Math.floor(100 + Math.random() * 900)}`,
    `${root}.${new Date().getFullYear()}`,
  ];
  // Return first N unique
  const out = [];
  for (const v of variations) { if (out.length >= count) break; if (!out.includes(v)) out.push(v); }
  while (out.length < count) { out.push(`${root}${Math.floor(1000 + Math.random()*9000)}`); }
  return out.map(s => s.toLowerCase());
}

function mapPlanByPriceId(priceId) {
  if (!priceId) return null;
  if (priceId === PRICE_MAP.BASIC) return PLAN_CONFIG.BASIC;
  if (priceId === PRICE_MAP.ADVANCED) return PLAN_CONFIG.ADVANCED;
  if (priceId === PRICE_MAP.PRO) return PLAN_CONFIG.PRO;
  return null;
}

// =============================
// ROLE-BASED ACCESS CONTROL (RBAC)
// =============================

// Role hierarchy levels
const ROLE_LEVELS = {
  user: 0,
  moderator: 1,
  admin: 2,
  superadmin: 3,
};

const SYSTEMIC_REPORT_TYPES = new Set(['bug', 'error', 'feature']);
const USER_REPORT_TYPES = new Set(['report_user', 'user_report', 'abuse', 'harassment', 'spam_user']);
const SUPPORT_REPORT_METRICS_REF = db.collection('app_stats').doc('support_reports');
const DEMO_USERNAME_REGEX = /^[a-z0-9.]{3,20}$/;

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeReportType(rawType) {
  return String(rawType || 'general').trim().toLowerCase();
}

function getReportCategory(type) {
  const normalized = normalizeReportType(type);
  if (SYSTEMIC_REPORT_TYPES.has(normalized)) return 'systemic';
  if (USER_REPORT_TYPES.has(normalized)) return 'user_related';
  return 'general';
}

// Branded transactional email wrapper - MetaStudy wordmark + brand color.
const BRAND_PRIMARY = '#7c3aed';

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function brandedEmailHtml({ greeting, bodyHtml, contextLine }) {
  return `
  <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; background: #f4f4fb; padding: 24px 0;">
    <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e6e6f2;">
      <div style="background: #ffffff; padding: 20px 24px; text-align: center; border-bottom: 3px solid ${BRAND_PRIMARY};">
        <div style="font-size: 28px; font-weight: 800; letter-spacing: -0.5px; color: #1a1a2e;">
          Meta<span style="color: ${BRAND_PRIMARY};">Study</span>
        </div>
      </div>
      <div style="padding: 28px 24px; color: #1a1a2e; font-size: 15px; line-height: 1.6;">
        <p style="margin-top: 0;">${escapeHtml(greeting)}</p>
        <div style="white-space: pre-wrap;">${bodyHtml}</div>
      </div>
      <div style="padding: 16px 24px; border-top: 1px solid #eee; color: #888; font-size: 12px;">
        ${contextLine ? `${escapeHtml(contextLine)}<br/>` : ''}
        <strong style="color: #1a1a2e;">The MetaStudy Team</strong><br/>
        <a href="https://metastudy-e1ba2.web.app" style="color: ${BRAND_PRIMARY}; text-decoration: none;">metastudy-e1ba2.web.app</a>
      </div>
    </div>
  </div>`;
}

// Helper: Check if caller has sufficient role level
async function verifyRoleLevel(uid, requiredLevel) {
  const userSnap = await db.collection('users').doc(uid).get();
  const userData = userSnap.exists ? userSnap.data() || {} : {};
  const role = String(userData.role || 'user').toLowerCase();
  const level = ROLE_LEVELS[role] || 0;
  return { valid: level >= requiredLevel, role, level, userData };
}

export {
  functions, db, getStripe, Stripe, Resend, crypto,
  PRICE_MAP, PLAN_CONFIG,
  applyInstitutionStatusForUser, validateUsername, makeSuggestions,
  ROLE_LEVELS, SYSTEMIC_REPORT_TYPES, USER_REPORT_TYPES, SUPPORT_REPORT_METRICS_REF,
  DEMO_USERNAME_REGEX, normalizeUsername, normalizeReportType, getReportCategory,
  verifyRoleLevel, mapPlanByPriceId,
  escapeHtml, brandedEmailHtml,
};
