import { functions, db, ROLE_LEVELS, DEMO_USERNAME_REGEX, normalizeUsername, verifyRoleLevel, crypto } from './lib/shared.js';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';


const DEMO_USERNAME = 'demo';
const DEMO_DEFAULT_EMAIL = 'demo@metastudy.app';
const DEMO_CONFIG_REF = db.collection('app_config').doc('demo_access');
const DEMO_PASSWORD_REGEX = /^.{6,}$/;

function resolveDemoUsername(configUsername) {
  const candidate = normalizeUsername(configUsername || DEMO_USERNAME);
  return DEMO_USERNAME_REGEX.test(candidate) ? candidate : DEMO_USERNAME;
}

function createDemoPasswordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex');
  return { salt, hash };
}

function verifyDemoPasswordHash(password, salt, expectedHash) {
  if (!password || !salt || !expectedHash) return false;
  const hash = crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex');
  const a = Buffer.from(hash, 'utf8');
  const b = Buffer.from(String(expectedHash), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function generateInternalDemoAuthPassword() {
  return `Demo${crypto.randomBytes(24).toString('hex')}aA1!`;
}

// Public helper for auth page: map demo username to managed demo email
export const getDemoLoginEmail = functions.https.onCall(async (data) => {
  const username = String(data?.username || '').trim().toLowerCase();
  const configSnap = await DEMO_CONFIG_REF.get();
  const config = configSnap.exists ? (configSnap.data() || {}) : {};
  const demoUsername = DEMO_USERNAME;
  if (username !== demoUsername) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid demo username');
  }
  const enabled = !!config.enabled;
  if (!enabled) {
    throw new functions.https.HttpsError('failed-precondition', 'Demo login is currently disabled');
  }

  const email = DEMO_DEFAULT_EMAIL;
  return { enabled: true, username: demoUsername, email };
});

// Admin or higher: demo account control (activate/deactivate/change password)
export const setDemoAccess = functions.https.onCall(async (data, context) => {
  const callerUid = context?.auth?.uid;
  if (!callerUid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');

  const { valid } = await verifyRoleLevel(callerUid, ROLE_LEVELS.admin);
  if (!valid) throw new functions.https.HttpsError('permission-denied', 'Admin access required');

  const action = String(data?.action || '').trim().toLowerCase();
  const password = String(data?.password || '');
  const passwordMeetsPolicy = (pwd) => {
    if (!DEMO_PASSWORD_REGEX.test(pwd)) return false;
    return true;
  };
  if (!['activate', 'deactivate', 'change_password'].includes(action)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid action');
  }
  if ((action === 'activate' || action === 'change_password') && !passwordMeetsPolicy(password)) {
    throw new functions.https.HttpsError('invalid-argument', 'Password must be at least 6 characters');
  }

  const configSnap = await DEMO_CONFIG_REF.get();
  const config = configSnap.exists ? (configSnap.data() || {}) : {};
  const existingUsername = resolveDemoUsername(config.username);
  const targetUsername = DEMO_USERNAME;
  if (!DEMO_USERNAME_REGEX.test(targetUsername)) {
    throw new functions.https.HttpsError('invalid-argument', 'Username must be 3-20 chars: lowercase letters, numbers, or dot');
  }
  const demoEmail = DEMO_DEFAULT_EMAIL;
  let demoUid = String(config.demoUid || '');
  let demoUser = null;

  if (demoUid) {
    try { demoUser = await getAuth().getUser(demoUid); } catch {}
  }
  if (!demoUser) {
    try {
      demoUser = await getAuth().getUserByEmail(demoEmail);
      demoUid = demoUser.uid;
    } catch {}
  }

  if (!demoUser && action === 'deactivate') {
    await DEMO_CONFIG_REF.set({
      enabled: false,
      username: targetUsername,
      email: demoEmail,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: callerUid,
    }, { merge: true });
    return { ok: true, enabled: false, username: targetUsername, email: demoEmail };
  }

  if (!demoUser && action === 'change_password') {
    throw new functions.https.HttpsError('not-found', 'Demo user is not created yet');
  }

  if (!demoUser && action === 'activate') {
    demoUser = await getAuth().createUser({
      email: demoEmail,
      emailVerified: true,
      password: generateInternalDemoAuthPassword(),
      disabled: false,
      displayName: 'Demo User',
    });
    demoUid = demoUser.uid;
  }

  if (!demoUid) throw new functions.https.HttpsError('internal', 'Failed to resolve demo user');

  // Ensure configured demo username belongs to this managed demo account
  const unameRef = db.collection('usernames').doc(targetUsername);
  const unameSnap = await unameRef.get();
  const unameUid = unameSnap.exists ? String((unameSnap.data() || {}).uid || '') : '';
  if (unameUid && unameUid !== demoUid) {
    throw new functions.https.HttpsError('failed-precondition', `Username "${targetUsername}" is already taken by another account`);
  }

  if (existingUsername !== targetUsername) {
    const oldRef = db.collection('usernames').doc(existingUsername);
    const oldSnap = await oldRef.get();
    const oldUid = oldSnap.exists ? String((oldSnap.data() || {}).uid || '') : '';
    if (oldUid === demoUid) {
      await oldRef.delete();
    }
  }

  if (action === 'activate' || action === 'change_password') {
    const now = new Date();
    const nextPeriodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
    const usagePeriodEnd = nextPeriodStart.toISOString();
    const { salt, hash } = createDemoPasswordHash(password);
    const authUpdates = { password };
    if (action === 'activate') authUpdates.disabled = false;
    if (Object.keys(authUpdates).length) {
      try {
        await getAuth().updateUser(demoUid, authUpdates);
      } catch (e) {
        const message = String(e?.message || '');
        if (/PASSWORD_DOES_NOT_MEET_REQUIREMENTS|Missing password requirements/i.test(message)) {
          throw new functions.https.HttpsError('invalid-argument', 'Password does not meet Firebase Auth policy. Include at least one uppercase letter and use 6+ characters.');
        }
        throw e;
      }
    }

    try {
      const latestUser = await getAuth().getUser(demoUid);
      const existingClaims = latestUser.customClaims || {};
      if (!existingClaims.isDemoUser) {
        await getAuth().setCustomUserClaims(demoUid, { ...existingClaims, isDemoUser: true });
      }
    } catch {}

    await unameRef.set({ uid: demoUid, updated_at: FieldValue.serverTimestamp() }, { merge: true });

    await db.collection('users').doc(demoUid).set({
      email: demoEmail,
      username: targetUsername,
      isDemoUser: true,
      demoAccessEnabled: true,
      plan: 'pro',
      usage_cycle_day: 1,
      monthly_quota: 1000000,
      word_limit: 50000,
      usage_period_end: usagePeriodEnd,
      role: 'user',
      banned: {},
      updated_at: new Date().toISOString(),
      demoManagedAt: FieldValue.serverTimestamp(),
      demoManagedBy: callerUid,
    }, { merge: true });

    await db.collection('users').doc(demoUid).collection('meta').doc('counters').set({
      uses_this_month: 0,
      extra_uses_balance: 0,
      extra_uses_used: 0,
      usage_period_end: usagePeriodEnd,
    }, { merge: true });

    await DEMO_CONFIG_REF.set({
      enabled: true,
      username: targetUsername,
      email: demoEmail,
      demoUid,
      demoPasswordSalt: salt,
      demoPasswordHash: hash,
      passwordUpdatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: callerUid,
      activatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { ok: true, enabled: true, username: targetUsername, email: demoEmail };
  }

  await getAuth().updateUser(demoUid, { disabled: true });
  await db.collection('users').doc(demoUid).set({
    isDemoUser: true,
    demoAccessEnabled: false,
    demoManagedAt: FieldValue.serverTimestamp(),
    demoManagedBy: callerUid,
  }, { merge: true });

  await DEMO_CONFIG_REF.set({
    enabled: false,
    username: targetUsername,
    email: demoEmail,
    demoUid,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: callerUid,
    deactivatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true, enabled: false, username: targetUsername, email: demoEmail };
});

// One-shot bootstrap: creates and activates the demo account. Only works while
// no demo_access config exists yet, so it can't be used to hijack the account
// after initial setup. Intended to be called once right after deployment.
export const bootstrapDemo = functions.https.onCall(async (data) => {
  const configSnap = await DEMO_CONFIG_REF.get();
  if (configSnap.exists) {
    throw new functions.https.HttpsError('failed-precondition', 'Demo account is already configured');
  }

  const password = String(data?.password || '');
  if (!DEMO_PASSWORD_REGEX.test(password)) {
    throw new functions.https.HttpsError('invalid-argument', 'Password must be at least 6 characters');
  }

  const demoEmail = DEMO_DEFAULT_EMAIL;
  const demoUsername = DEMO_USERNAME;

  let demoUser = null;
  try { demoUser = await getAuth().getUserByEmail(demoEmail); } catch {}
  if (!demoUser) {
    demoUser = await getAuth().createUser({
      email: demoEmail,
      emailVerified: true,
      password,
      disabled: false,
      displayName: 'Demo User',
    });
  } else {
    await getAuth().updateUser(demoUser.uid, { password, disabled: false });
  }
  const demoUid = demoUser.uid;

  try {
    const latestUser = await getAuth().getUser(demoUid);
    const existingClaims = latestUser.customClaims || {};
    if (!existingClaims.isDemoUser) {
      await getAuth().setCustomUserClaims(demoUid, { ...existingClaims, isDemoUser: true });
    }
  } catch {}

  const now = new Date();
  const nextPeriodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  const usagePeriodEnd = nextPeriodStart.toISOString();
  const { salt, hash } = createDemoPasswordHash(password);

  await db.collection('usernames').doc(demoUsername).set(
    { uid: demoUid, updated_at: FieldValue.serverTimestamp() }, { merge: true });

  await db.collection('users').doc(demoUid).set({
    email: demoEmail,
    username: demoUsername,
    isDemoUser: true,
    demoAccessEnabled: true,
    plan: 'pro',
    usage_cycle_day: 1,
    monthly_quota: 1000000,
    word_limit: 50000,
    usage_period_end: usagePeriodEnd,
    role: 'user',
    banned: {},
    updated_at: new Date().toISOString(),
  }, { merge: true });

  await db.collection('users').doc(demoUid).collection('meta').doc('counters').set({
    uses_this_month: 0,
    extra_uses_balance: 0,
    extra_uses_used: 0,
    usage_period_end: usagePeriodEnd,
  }, { merge: true });

  await DEMO_CONFIG_REF.set({
    enabled: true,
    username: demoUsername,
    email: demoEmail,
    demoUid,
    demoPasswordSalt: salt,
    demoPasswordHash: hash,
    passwordUpdatedAt: FieldValue.serverTimestamp(),
    activatedAt: FieldValue.serverTimestamp(),
  });

  return { ok: true, enabled: true, username: demoUsername, email: demoEmail };
});

// One-shot bootstrap for a plain email+password demo login (demo@gmail.com).
// Gated on a config doc so it can't be re-run to hijack the account afterwards.
export const bootstrapDemoEmail = functions.https.onCall(async (data) => {
  const DEMO_EMAIL = 'demo@gmail.com';
  const DEMO_EMAIL_USERNAME = 'demopro';
  const configRef = db.collection('app_config').doc('demo_email_access');

  const configSnap = await configRef.get();
  if (configSnap.exists) {
    throw new functions.https.HttpsError('failed-precondition', 'Demo email account is already configured');
  }

  const password = String(data?.password || '');
  if (!DEMO_PASSWORD_REGEX.test(password)) {
    throw new functions.https.HttpsError('invalid-argument', 'Password must be at least 6 characters');
  }

  let demoUser = null;
  try { demoUser = await getAuth().getUserByEmail(DEMO_EMAIL); } catch {}
  if (!demoUser) {
    demoUser = await getAuth().createUser({
      email: DEMO_EMAIL,
      emailVerified: true,
      password,
      disabled: false,
      displayName: 'Demo User',
    });
  } else {
    await getAuth().updateUser(demoUser.uid, { password, disabled: false, emailVerified: true });
  }
  const demoUid = demoUser.uid;

  try {
    const latestUser = await getAuth().getUser(demoUid);
    const existingClaims = latestUser.customClaims || {};
    if (!existingClaims.isDemoUser) {
      await getAuth().setCustomUserClaims(demoUid, { ...existingClaims, isDemoUser: true });
    }
  } catch {}

  const now = new Date();
  const nextPeriodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  const usagePeriodEnd = nextPeriodStart.toISOString();

  const unameRef = db.collection('usernames').doc(DEMO_EMAIL_USERNAME);
  const unameSnap = await unameRef.get();
  const unameUid = unameSnap.exists ? String((unameSnap.data() || {}).uid || '') : '';
  if (!unameUid || unameUid === demoUid) {
    await unameRef.set({ uid: demoUid, updated_at: FieldValue.serverTimestamp() }, { merge: true });
  }

  await db.collection('users').doc(demoUid).set({
    email: DEMO_EMAIL,
    username: DEMO_EMAIL_USERNAME,
    isDemoUser: true,
    demoAccessEnabled: true,
    plan: 'pro',
    usage_cycle_day: 1,
    monthly_quota: 1000000,
    word_limit: 50000,
    usage_period_end: usagePeriodEnd,
    role: 'user',
    banned: {},
    updated_at: new Date().toISOString(),
  }, { merge: true });

  await db.collection('users').doc(demoUid).collection('meta').doc('counters').set({
    uses_this_month: 0,
    extra_uses_balance: 0,
    extra_uses_used: 0,
    usage_period_end: usagePeriodEnd,
  }, { merge: true });

  await configRef.set({
    email: DEMO_EMAIL,
    username: DEMO_EMAIL_USERNAME,
    demoUid,
    activatedAt: FieldValue.serverTimestamp(),
  });

  return { ok: true, email: DEMO_EMAIL };
});

// Public helper for auth page: validate demo credentials and issue a custom token
export const signInDemo = functions.https.onCall(async () => {
  throw new functions.https.HttpsError('failed-precondition', 'Username login is no longer supported. Please sign in with email.');
});

// Admin or higher: get demo status for admin dashboard controls
export const getDemoAccessStatus = functions.https.onCall(async (data, context) => {
  const callerUid = context?.auth?.uid;
  if (!callerUid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');

  const { valid } = await verifyRoleLevel(callerUid, ROLE_LEVELS.admin);
  if (!valid) throw new functions.https.HttpsError('permission-denied', 'Admin access required');

  const configSnap = await DEMO_CONFIG_REF.get();
  const config = configSnap.exists ? (configSnap.data() || {}) : {};
  const demoUsername = DEMO_USERNAME;
  const demoEmail = DEMO_DEFAULT_EMAIL;
  let demoUid = String(config.demoUid || '');
  let demoUser = null;

  if (demoUid) {
    try { demoUser = await getAuth().getUser(demoUid); } catch {}
  }
  if (!demoUser) {
    try {
      demoUser = await getAuth().getUserByEmail(demoEmail);
      demoUid = demoUser.uid;
    } catch {}
  }

  if (!demoUser) {
    demoUser = await getAuth().createUser({
      email: demoEmail,
      emailVerified: true,
      password: generateInternalDemoAuthPassword(),
      disabled: true,
      displayName: 'Demo User',
    });
    demoUid = demoUser.uid;
  }

  if (demoUid) {
    let configNeedsSync = false;
    const unameRef = db.collection('usernames').doc(demoUsername);
    const unameSnap = await unameRef.get();
    const unameUid = unameSnap.exists ? String((unameSnap.data() || {}).uid || '') : '';
    if (!unameUid) {
      await unameRef.set({ uid: demoUid, updated_at: FieldValue.serverTimestamp() }, { merge: true });
    }

    const userRef = db.collection('users').doc(demoUid);
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? (userSnap.data() || {}) : {};

    const now = new Date();
    const nextPeriodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
    const usagePeriodEnd = nextPeriodStart.toISOString();

    const shouldPatchUser = !userSnap.exists
      || String(userData.email || '') !== demoEmail
      || String(userData.username || '') !== demoUsername
      || !userData.isDemoUser
      || !!userData.demoAccessEnabled !== !!config.enabled
      || String(userData.plan || '') !== 'pro'
      || Number(userData.usage_cycle_day || 0) !== 1
      || Number(userData.monthly_quota || 0) !== 1000000
      || Number(userData.word_limit || 0) !== 50000
      || String(userData.role || 'user') !== 'user';

    if (shouldPatchUser) {
      const userPatch = {
        email: demoEmail,
        username: demoUsername,
        isDemoUser: true,
        demoAccessEnabled: !!config.enabled,
        plan: 'pro',
        usage_cycle_day: 1,
        monthly_quota: 1000000,
        word_limit: 50000,
        role: 'user',
      };
      if (typeof userData.usage_period_end !== 'string') {
        userPatch.usage_period_end = usagePeriodEnd;
      }
      await userRef.set(userPatch, { merge: true });
    }

    const countersRef = userRef.collection('meta').doc('counters');
    const countersSnap = await countersRef.get();
    if (!countersSnap.exists) {
      await countersRef.set({
        uses_this_month: 0,
        extra_uses_balance: 0,
        extra_uses_used: 0,
        usage_period_end: usagePeriodEnd,
      }, { merge: true });
    }

    if (String(config.username || '') !== demoUsername) configNeedsSync = true;
    if (String(config.email || '') !== demoEmail) configNeedsSync = true;
    if (String(config.demoUid || '') !== String(demoUid || '')) configNeedsSync = true;
    if (configNeedsSync) {
      await DEMO_CONFIG_REF.set({
        username: demoUsername,
        email: demoEmail,
        demoUid,
        enabled: !!config.enabled,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: callerUid,
      }, { merge: true });
    }
  }

  return {
    enabled: !!config.enabled,
    username: demoUsername,
    email: demoEmail,
    demoUid: String(demoUid || ''),
    updatedAt: config.updatedAt?.toDate?.()?.toISOString?.() || null,
    updatedBy: String(config.updatedBy || ''),
  };
});
