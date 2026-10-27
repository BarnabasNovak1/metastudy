import { functions, db, PLAN_CONFIG, applyInstitutionStatusForUser, validateUsername, makeSuggestions, Resend, crypto } from './lib/shared.js';
import { FieldValue, FieldPath, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';


// OPTIMIZED: Initialize user on signup - combines all writes into 2 operations (user doc + counters)
// Also initialize free tier plan config so users can use features immediately (5 uses/month)
export const onAuthCreate = functions.auth.user().onCreate(async (user) => {
  const uid = user.uid;
  const email = (user.email || '').toLowerCase();
  if (!email) return;

  // The managed demo accounts' user docs are fully written by demo.js
  // (plan 'pro', quotas, username). Skip the free-plan seeding so this
  // trigger can't overwrite them in a race.
  if (email === 'demo@metastudy.app' || email === 'demo@gmail.com') return;
  
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const freeConfig = PLAN_CONFIG.FREE;
  
  // Build user doc data - all fields in ONE write
  const userData = { 
    email, 
    photo_url: user.photoURL || null,
    plan: freeConfig.plan,
    monthly_quota: freeConfig.monthly_quota,
    word_limit: freeConfig.word_limit,
    usage_cycle_day: now.getDate(),
    created_at: now.toISOString(),
  };
  
  // Check institution by email domain (1 read)
  try {
    const domain = email.includes('@') ? email.split('@')[1] : '';
    if (domain) {
      const instSnap = await db.collection('institutions').where('emailDomain', '==', domain).limit(1).get();
      if (!instSnap.empty) {
        const inst = instSnap.docs[0];
        const instData = inst.data() || {};
        userData.institutionId = inst.id;
        userData.schoolName = String(instData.name || inst.id);
        userData.planTier = String(instData.planTier || '').toUpperCase();
        userData.verifiedInstitution = false;
        userData.emailVerified = !!user.emailVerified;
      }
    }
  } catch {}
  
  // WRITE 1: User doc (all fields combined)
  await db.collection('users').doc(uid).set(userData, { merge: true });
  
  // Seed public profile mirror (safe, non-sensitive fields only)
  try {
    await db.collection('public_profiles').doc(uid).set({
      photo_url: user.photoURL || null,
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch {}
  
  // WRITE 2: Counters subcollection
  try {
    await db.collection('users').doc(uid).collection('meta').doc('counters').set({
      uses_this_month: 0,
      extra_uses_balance: 0,
      extra_uses_used: 0,
      usage_period_end: nextMonth.toISOString(),
    }, { merge: true });
  } catch {}
});

// Auth trigger: when the Auth user record is deleted without going through
// deleteAccountFull (Firebase Console, admin SDK, or client-side fallback),
// free the username so it can be reused and cascade Firestore cleanup.
// When deleteAccountFull runs, everything is already deleted by the time it
// removes the Auth user, so these steps are cheap no-ops in that path.
export const onAuthDelete = functions
  .runWith({ timeoutSeconds: 300, memory: '512MB' })
  .auth.user().onDelete(async (user) => {
    const uid = user.uid;

    // Read institution membership before wiping the profile
    let institutionId = '';
    let wasVerifiedInstitution = false;
    try {
      const usnap = await db.collection('users').doc(uid).get();
      const ud = usnap.exists ? (usnap.data() || {}) : {};
      institutionId = String(ud.institutionId || '');
      wasVerifiedInstitution = !!ud.verifiedInstitution;
    } catch {}

    // Free username mappings directly so the name is reusable even if the
    // users/{uid} doc is already gone
    try {
      const taken = await db.collection('usernames').where('uid', '==', uid).get();
      if (!taken.empty) {
        const batch = db.batch();
        taken.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    } catch (e) {
      console.error(`[onAuthDelete] Failed to free usernames for ${uid}:`, e?.message || e);
    }

    // Deleting users/{uid} fires onUserDocDelete (friends/usernames/storage/groups)
    // and onUserProfileWrite (removes the public_profiles mirror)
    try {
      await db.recursiveDelete(db.collection('users').doc(uid));
    } catch (e) {
      console.error(`[onAuthDelete] recursiveDelete failed for users/${uid}:`, e?.message || e);
      try { await db.collection('users').doc(uid).delete(); } catch {}
    }

    await Promise.allSettled([
      db.collection('public_profiles').doc(uid).delete(),
      db.recursiveDelete(db.collection('customers').doc(uid)),
    ]);

    // Decrement the institution's user count if this was a verified member
    if (institutionId && wasVerifiedInstitution) {
      try {
        await db.collection('institutions').doc(institutionId).update({
          currentUserCount: FieldValue.increment(-1),
        });
      } catch (e) {
        console.warn(`[onAuthDelete] Could not decrement institution ${institutionId} count:`, e?.message || e);
      }
    }
  });

// Set photo URL on user profile (server-side to bypass client rules)
export const setPhotoURL = functions.https.onCall(async (data, context) => {
  const uid = context?.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  const url = String(data?.url || '').trim();
  if (!url) throw new functions.https.HttpsError('invalid-argument', 'Missing url');

  // Delete old photo from Storage before setting new one (free up space)
  try {
    const uSnap = await db.collection('users').doc(uid).get();
    const uData = uSnap.exists ? (uSnap.data() || {}) : {};
    const oldPhotoUrl = String(uData.photo_url || uData.photoURL || '');
    
    // Only delete if it's a Firebase Storage URL and different from new URL
    if (oldPhotoUrl && oldPhotoUrl !== url) {
      const bucket = getStorage().bucket();
      if (oldPhotoUrl.startsWith('gs://')) {
        const withoutScheme = oldPhotoUrl.replace('gs://', '');
        const firstSlash = withoutScheme.indexOf('/');
        const path = firstSlash >= 0 ? withoutScheme.slice(firstSlash + 1) : '';
        if (path) { try { await bucket.file(path).delete(); } catch {} }
      } else if (oldPhotoUrl.includes('/o/')) {
        // https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<encodedPath>?...
        const enc = oldPhotoUrl.split('/o/')[1]?.split('?')[0] || '';
        const path = decodeURIComponent(enc);
        if (path) { try { await bucket.file(path).delete(); } catch {} }
      }
    }
  } catch (e) {
    console.error('Failed to delete old photo:', e?.message || e);
  }

  await db.collection('users').doc(uid).set({ photo_url: url }, { merge: true });

  // Update all feed posts owned by this user to reflect new photo URL
  try {
    const postsSnap = await db.collection('feed_posts').where('ownerId', '==', uid).get();
    if (!postsSnap.empty) {
      const batch = db.batch();
      postsSnap.docs.forEach((d) => {
        batch.update(d.ref, { ownerPhotoURL: url });
      });
      await batch.commit();
    }
  } catch (e) {
    console.error('Failed to update feed posts with new photo URL:', e?.message || e);
  }

  return { ok: true };
});

// Firestore trigger: when a user document is deleted, remove references from all friends lists and free username mapping
export const onUserDocDelete = functions.firestore
  .document('users/{uid}')
  .onDelete(async (snap, context) => {
    const uid = context.params.uid;
    // Remove any friends/* docs across all users that point to this uid
    try {
      const cg = await db
        .collectionGroup('friends')
        .where(FieldPath.documentId(), '==', uid)
        .get();
      if (!cg.empty) {
        const batch = db.batch();
        cg.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    } catch {}

    // Free username mappings that reference this uid
    try {
      const taken = await db.collection('usernames').where('uid', '==', uid).get();
      if (!taken.empty) {
        const batch = db.batch();
        taken.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    } catch {}

    // Best-effort: delete storage files under users/{uid}/
    try {
      const bucket = getStorage().bucket();
      const [files] = await bucket.getFiles({ prefix: `users/${uid}/` });
      await Promise.all((files || []).map((f) => f.delete().catch(() => null)));
    } catch {}

    // Remove uid from any groups they were a member of
    try {
      const groupsSnap = await db.collection('groups').where('members', 'array-contains', uid).get();
      if (!groupsSnap.empty) {
        const batch = db.batch();
        groupsSnap.docs.forEach((d) => {
          batch.update(d.ref, {
            members: FieldValue.arrayRemove(uid),
            admins: FieldValue.arrayRemove(uid),
            [`memberUsernames.${uid}`]: FieldValue.delete(),
          });
        });
        await batch.commit();
      }
    } catch {}
  });

// Pre-check username availability and return suggestions if taken/invalid
export const checkUsername = functions.https.onCall(async (data, context) => {
  const { username } = data || {};
  const { ok, name } = validateUsername(username);
  if (!ok) {
    return { available: false, reason: 'invalid', suggestions: makeSuggestions(name || 'user') };
  }
  const ref = db.collection('usernames').doc(name);
  const snap = await ref.get();
  if (snap.exists) {
    // Self-heal: a mapping whose owner no longer exists is free to reclaim
    const ownerUid = String((snap.data() || {}).uid || '');
    const ownerSnap = ownerUid ? await db.collection('users').doc(ownerUid).get() : null;
    if (ownerUid && ownerSnap && ownerSnap.exists) {
      return { available: false, reason: 'taken', suggestions: makeSuggestions(name) };
    }
  }
  return { available: true };
});

// Reserve username for the authenticated user atomically
// OPTIMIZED: Also accepts optional profile fields to save in one transaction (reduces writes)
export const reserveUsername = functions.https.onCall(async (data, context) => {
  const uid = context?.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  const { username, first_name, last_name, institutionId, schoolName, tosAccepted, tosVersion } = data || {};
  const { ok, name } = validateUsername(username);
  if (!ok) throw new functions.https.HttpsError('invalid-argument', 'Invalid username');

  // Get the Firebase Auth user to access their photoURL (especially for Google sign-in)
  let authPhotoURL = null;
  try {
    const authUser = await getAuth().getUser(uid);
    authPhotoURL = authUser.photoURL || null;
  } catch (e) {
    console.log('Could not fetch auth user photo:', e?.message);
  }

  const unameRef = db.collection('usernames').doc(name);
  const userRef = db.collection('users').doc(uid);

  await db.runTransaction(async (tx) => {
    const existing = await tx.get(unameRef);
    if (existing.exists) {
      // Allow reclaim when the mapping is orphaned (owner account deleted)
      // or already belongs to this user (retry-safe)
      const ownerUid = String((existing.data() || {}).uid || '');
      const ownerSnap = ownerUid ? await tx.get(db.collection('users').doc(ownerUid)) : null;
      const ownerAlive = !!ownerUid && !!ownerSnap && ownerSnap.exists;
      if (ownerAlive && ownerUid !== uid) {
        throw new functions.https.HttpsError('already-exists', 'Username taken', { suggestions: makeSuggestions(name) });
      }
    }
    tx.set(unameRef, { uid, reserved_at: FieldValue.serverTimestamp() }, { merge: false });
    // Save username + optional profile fields in ONE write
    // Also save photo_url from Firebase Auth (Google profile pic)
    const profileData = { 
      username: name, 
      username_lower: name,
      ...(authPhotoURL ? { photo_url: authPhotoURL } : {}),
      ...(first_name ? { first_name } : {}),
      ...(last_name ? { last_name } : {}),
      ...(institutionId ? { institutionId } : {}),
      ...(schoolName ? { schoolName } : {}),
      // GDPR consent record: ToS/Privacy acceptance + 13+ age attestation,
      // captured at signup with a server timestamp (client cannot write these fields)
      ...(tosAccepted === true ? {
        tos_accepted_at: FieldValue.serverTimestamp(),
        tos_version: String(tosVersion || 'unknown').slice(0, 40),
        age_attested_13_plus: true,
      } : {}),
    };
    tx.set(userRef, profileData, { merge: true });
  });

  return { ok: true, username: name };
});

// Change username once per year: create new mapping, update user, free old mapping
export const changeUsername = functions.https.onCall(async (data, context) => {
  const uid = context?.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  const { newUsername } = data || {};
  const { ok, name } = validateUsername(newUsername);
  if (!ok) throw new functions.https.HttpsError('invalid-argument', 'Invalid username');

  const userRef = db.collection('users').doc(uid);
  const newURef = db.collection('usernames').doc(name);

  await db.runTransaction(async (tx) => {
    const uSnap = await tx.get(userRef);
    const uData = uSnap.exists ? (uSnap.data() || {}) : {};
    const oldName = String(uData.username || '').toLowerCase();
    const lastChange = uData.last_username_change ? uData.last_username_change.toDate ? uData.last_username_change.toDate() : new Date(uData.last_username_change) : null;
    if (lastChange) {
      const now = new Date();
      const diffDays = (now.getTime() - lastChange.getTime()) / (1000*60*60*24);
      if (diffDays < 365) {
        throw new functions.https.HttpsError('failed-precondition', 'Username can only be changed once per year', { next_allowed_in_days: Math.ceil(365 - diffDays) });
      }
    }

    const existsNew = await tx.get(newURef);
    if (existsNew.exists) {
      // Allow reclaim when the mapping is orphaned (owner account deleted)
      const ownerUid = String((existsNew.data() || {}).uid || '');
      const ownerSnap = ownerUid ? await tx.get(db.collection('users').doc(ownerUid)) : null;
      const ownerAlive = !!ownerUid && !!ownerSnap && ownerSnap.exists;
      if (ownerAlive && ownerUid !== uid) {
        throw new functions.https.HttpsError('already-exists', 'Username taken', { suggestions: makeSuggestions(name) });
      }
    }

    // Read old username mapping BEFORE any writes (Firestore requires all reads before writes)
    let shouldDeleteOld = false;
    let oldRef = null;
    if (oldName && oldName !== name) {
      oldRef = db.collection('usernames').doc(oldName);
      const oldSnap = await tx.get(oldRef);
      if (oldSnap.exists) {
        const d = oldSnap.data() || {};
        shouldDeleteOld = String(d.uid || '') === uid;
      }
    }

    // Now do all writes
    // Create new mapping
    tx.set(newURef, { uid, reserved_at: FieldValue.serverTimestamp() }, { merge: false });
    // Update user doc
    tx.set(userRef, { username: name, username_lower: name, last_username_change: FieldValue.serverTimestamp() }, { merge: true });
    // Free old mapping if it belonged to this uid
    if (shouldDeleteOld && oldRef) {
      tx.delete(oldRef);
    }
  });

  // Update all feed posts owned by this user to reflect new username
  try {
    const postsSnap = await db.collection('feed_posts').where('ownerId', '==', uid).get();
    if (!postsSnap.empty) {
      const batch = db.batch();
      postsSnap.docs.forEach((d) => {
        batch.update(d.ref, { ownerUsername: name });
      });
      await batch.commit();
    }
  } catch (e) {
    console.error('Failed to update feed posts with new username:', e?.message || e);
  }

  return { ok: true, username: name };
});

// Send custom branded email verification to institution users via Resend.
// Uses our own token system instead of Firebase Auth's verification flow:
//  - Generates a random token stored in `email_verifications/{token}` (24h TTL).
//  - Sends Resend email with link to https://metastudy-e1ba2.web.app/auth/confirm?t=TOKEN.
//  - Confirmation handled by confirmInstitutionEmail callable.
// Only institution users (users.institutionId set) are eligible.
export const sendInstitutionVerificationEmail = functions
  .https.onCall(async (data, context) => {
    const uid = context?.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');

    // Load Auth user + Firestore profile
    let authUser;
    try {
      authUser = await getAuth().getUser(uid);
    } catch (e) {
      throw new functions.https.HttpsError('not-found', 'User not found');
    }
    const email = (authUser.email || '').toLowerCase();
    if (!email) throw new functions.https.HttpsError('failed-precondition', 'No email on account');

    // Confirm institution membership + check if already confirmed
    let profile = {};
    try {
      const snap = await db.collection('users').doc(uid).get();
      profile = snap.exists ? (snap.data() || {}) : {};
    } catch {}
    if (profile.emailConfirmedAt) {
      return { ok: true, alreadyVerified: true };
    }
    const institutionId = String(profile.institutionId || '').trim();
    if (!institutionId) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Email confirmation is only required for institution accounts.'
      );
    }

    const schoolName = String(profile.schoolName || 'your institution');
    const firstName = String(profile.first_name || '').trim();
    const displayName = firstName || (authUser.displayName || '').split(' ')[0] || 'there';

    const RESEND_KEY = (process.env.RESEND_API_KEY || '').trim();
    if (!RESEND_KEY) throw new functions.https.HttpsError('internal', 'Email service not configured');

    const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://metastudy-e1ba2.web.app').replace(/\/+$/, '');

    // Generate a cryptographically-random token and store it (24h expiry).
    // Use a fresh token per request so prior links naturally rotate out.
    const token = crypto.randomBytes(32).toString('hex');
    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000);
    try {
      await db.collection('email_verifications').doc(token).set({
        uid,
        email,
        institutionId,
        createdAt: now,
        expiresAt,
        usedAt: null,
      });
    } catch (e) {
      console.error('Failed to store verification token:', e?.message || e);
      throw new functions.https.HttpsError('internal', 'Could not create verification token');
    }

    const verificationLink = `${APP_BASE_URL}/auth/confirm?t=${token}`;

    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
    const safeName = escapeHtml(displayName);
    const safeSchool = escapeHtml(schoolName);

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width" />
    <title>Confirm your email</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f4fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4fb;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e6e6f2;overflow:hidden;">
            <tr>
              <td align="center" style="padding:20px 24px;background:#ffffff;border-bottom:3px solid #7c3aed;">
                <div style="font-size:28px;font-weight:800;letter-spacing:-0.5px;color:#1a1a2e;">
                  Meta<span style="color:#7c3aed;">Study</span>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 0 32px;text-align:center;">
                <h1 style="margin:8px 0 8px;font-size:22px;line-height:1.3;color:#0f172a;font-weight:700;">Confirm your email</h1>
                <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#475569;">
                  Hi ${safeName}, please confirm your email to activate your <strong>${safeSchool}</strong> account on MetaStudy.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:8px 32px 24px 32px;">
                <a href="${verificationLink}"
                   style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 28px;border-radius:10px;">
                  Confirm Email
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px 32px;text-align:center;">
                <p style="margin:0;font-size:12px;line-height:1.5;color:#94a3b8;">
                  If the button doesn't work, copy and paste this link into your browser:<br />
                  <a href="${verificationLink}" style="color:#7c3aed;word-break:break-all;">${verificationLink}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;">
                <p style="margin:0;font-size:12px;color:#94a3b8;">
                  This link expires in 24 hours. If you didn't sign up for MetaStudy, you can safely ignore this message.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:11px;color:#94a3b8;">&copy; ${new Date().getFullYear()} MetaStudy</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    const text = `Hi ${displayName},\n\nConfirm your email to activate your ${schoolName} account on MetaStudy.\n\nConfirm: ${verificationLink}\n\nThis link expires in 24 hours. If you didn't sign up, ignore this email.`;

    try {
      const resend = new Resend(RESEND_KEY);
      await resend.emails.send({
        from: 'MetaStudy <noreply@metastudy.com>',
        to: [email],
        subject: 'Confirm your MetaStudy email',
        html,
        text,
      });
    } catch (e) {
      console.error('Verification email send failed:', e?.message || e);
      throw new functions.https.HttpsError('internal', 'Failed to send verification email');
    }

    return { ok: true };
  });

// Confirm institution email via custom token. Public callable (no auth required
// since the token itself is the proof). Marks users/{uid}.emailConfirmedAt and
// invalidates the token. Returns { ok, uid } so the client can show a success
// state and decide whether to redirect immediately or prompt sign-in.
export const confirmInstitutionEmail = functions.https.onCall(async (data, context) => {
  const token = String((data && data.token) || '').trim();
  if (!token || !/^[a-f0-9]{32,128}$/i.test(token)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid confirmation token');
  }

  const tokenRef = db.collection('email_verifications').doc(token);
  let uid = '';

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(tokenRef);
      if (!snap.exists) {
        throw new functions.https.HttpsError('not-found', 'This confirmation link is invalid or has already been used.');
      }
      const t = snap.data() || {};
      if (t.usedAt) {
        // Allow idempotent confirmation for ~5 minutes after first use so reloads
        // of the confirm page don't show an error.
        const usedAtMs = t.usedAt?.toMillis ? t.usedAt.toMillis() : 0;
        if (Date.now() - usedAtMs > 5 * 60 * 1000) {
          throw new functions.https.HttpsError('failed-precondition', 'This confirmation link has already been used.');
        }
        uid = String(t.uid || '');
        return;
      }
      const expMs = t.expiresAt?.toMillis ? t.expiresAt.toMillis() : 0;
      if (!expMs || expMs < Date.now()) {
        throw new functions.https.HttpsError('deadline-exceeded', 'This confirmation link has expired. Please request a new one.');
      }
      uid = String(t.uid || '');
      if (!uid) {
        throw new functions.https.HttpsError('failed-precondition', 'Token is missing a user reference.');
      }
      tx.update(tokenRef, { usedAt: FieldValue.serverTimestamp() });
      tx.set(db.collection('users').doc(uid), {
        emailConfirmedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    console.error('confirmInstitutionEmail failed:', e?.message || e);
    throw new functions.https.HttpsError('internal', 'Could not confirm email');
  }

  // Flip Firebase Auth emailVerified AND self-heal institution status in
  // parallel - independent operations, saves a round-trip of latency.
  let institutionApplied = false;
  let institutionReason = null;
  const heal = async () => {
    if (!uid) return;
    const usnap = await db.collection('users').doc(uid).get();
    const udata = usnap.exists ? (usnap.data() || {}) : {};
    if (!udata.verifiedInstitution) {
      const result = await applyInstitutionStatusForUser(uid, udata.institutionId);
      institutionApplied = !!result.ok;
      institutionReason = result.ok ? null : result.reason;
      if (!result.ok) {
        console.warn(`[confirmInstitutionEmail] self-heal skipped for ${uid}:`, result);
      } else {
        console.log(`[confirmInstitutionEmail] self-heal applied for ${uid}:`, result.institutionId, 'planApplied=', result.planApplied);
      }
    } else {
      institutionApplied = true;
    }
  };
  await Promise.allSettled([
    uid ? getAuth().updateUser(uid, { emailVerified: true }).catch((e) => {
      console.warn('Could not flip auth emailVerified:', e?.message || e);
    }) : Promise.resolve(),
    heal().catch((e) => console.warn('Institution self-heal failed:', e?.message || e)),
  ]);

  return { ok: true, uid, institutionApplied, institutionReason };
});

// Send a branded password reset email via Resend. Generates a Firebase Auth
// password reset link server-side, then sends it inside a custom HTML template
// (same gradient header / button styling as the verification email). This is
// a separate, dedicated flow from email verification - different subject,
// different button, different landing page. Public callable: no auth required
// because the user has forgotten their password.
export const sendBrandedPasswordResetEmail = functions
  .https.onCall(async (data, context) => {
    const rawEmail = String((data && data.email) || '').trim().toLowerCase();
    if (!rawEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rawEmail)) {
      throw new functions.https.HttpsError('invalid-argument', 'Please provide a valid email address.');
    }

    const RESEND_KEY = (process.env.RESEND_API_KEY || '').trim();
    if (!RESEND_KEY) throw new functions.https.HttpsError('internal', 'Email service not configured');

    const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://metastudy-e1ba2.web.app').replace(/\/+$/, '');

    // Look up the user (best-effort). If the address isn't registered, we
    // still return ok to avoid leaking account existence, but skip the send.
    let userRecord = null;
    try {
      userRecord = await getAuth().getUserByEmail(rawEmail);
    } catch (e) {
      // user-not-found is fine, treat as no-op success.
      return { ok: true, sent: false };
    }
    if (!userRecord) return { ok: true, sent: false };

    // Try to load profile for personalization
    let displayName = '';
    try {
      const psnap = await db.collection('users').doc(userRecord.uid).get();
      const p = psnap.exists ? (psnap.data() || {}) : {};
      displayName = String(p.first_name || '').trim();
    } catch {}
    if (!displayName) {
      displayName = (userRecord.displayName || '').split(' ')[0] || 'there';
    }

    // Generate the Firebase password-reset link with our /reset-password page
    // as the continueUrl. Then rewrite the host/path so the link points
    // directly at our branded reset page (avoiding any /__/auth/action UI).
    let resetLink;
    try {
      resetLink = await getAuth().generatePasswordResetLink(rawEmail, {
        url: `${APP_BASE_URL}/reset-password`,
        handleCodeInApp: false,
      });
    } catch (e) {
      const raw = String(e?.message || e || '');
      console.error('generatePasswordResetLink failed:', raw);
      if (/TOO_MANY_ATTEMPTS_TRY_LATER/i.test(raw)) {
        throw new functions.https.HttpsError(
          'resource-exhausted',
          'Too many reset attempts. Please wait a minute and try again.'
        );
      }
      throw new functions.https.HttpsError('internal', 'Could not generate reset link');
    }

    // Rewrite link host + path so users land directly on our reset page.
    // The oobCode query param is what `confirmPasswordReset` validates against
    // Firebase Auth, so it works regardless of which host serves it.
    try {
      const parsed = new URL(resetLink);
      parsed.host = (process.env.AUTH_LINK_HOST || 'metastudy-e1ba2.web.app').replace(/^https?:\/\//, '').replace(/\/+$/, '');
      parsed.protocol = 'https:';
      parsed.pathname = '/reset-password';
      resetLink = parsed.toString();
    } catch (e) {
      console.warn('Could not rewrite reset link host:', e?.message || e);
    }

    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
    const safeName = escapeHtml(displayName);

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width" />
    <title>Reset your password</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f6fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e6e6f2;overflow:hidden;">
            <tr>
              <td align="center" style="padding:20px 24px;background:#ffffff;border-bottom:3px solid #7c3aed;">
                <div style="font-size:28px;font-weight:800;letter-spacing:-0.5px;color:#1a1a2e;">
                  Meta<span style="color:#7c3aed;">Study</span>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 0 32px;text-align:center;">
                <h1 style="margin:8px 0 8px;font-size:22px;line-height:1.3;color:#0f172a;font-weight:700;">Reset your password</h1>
                <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#475569;">
                  Hi ${safeName}, click the button below to choose a new password for your MetaStudy account.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:8px 32px 24px 32px;">
                <a href="${resetLink}"
                   style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 28px;border-radius:10px;">
                  Reset Password
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px 32px;text-align:center;">
                <p style="margin:0;font-size:12px;line-height:1.5;color:#94a3b8;">
                  If the button doesn't work, copy and paste this link into your browser:<br />
                  <a href="${resetLink}" style="color:#7c3aed;word-break:break-all;">${resetLink}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;">
                <p style="margin:0;font-size:12px;color:#94a3b8;">
                  This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email \u2014 your password will stay the same.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:11px;color:#94a3b8;">&copy; ${new Date().getFullYear()} MetaStudy</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    const text = `Hi ${displayName},\n\nReset your MetaStudy password using this link:\n\n${resetLink}\n\nThis link expires in 1 hour. If you didn't request this, ignore the email.`;

    try {
      const resend = new Resend(RESEND_KEY);
      await resend.emails.send({
        from: 'MetaStudy <noreply@metastudy.com>',
        to: [rawEmail],
        subject: 'Reset your MetaStudy password',
        html,
        text,
      });
    } catch (e) {
      console.error('Password reset email send failed:', e?.message || e);
      throw new functions.https.HttpsError('internal', 'Failed to send password reset email');
    }

    return { ok: true, sent: true };
  });

// Public helper for auth page: resolve username to email for username/password login
export const resolveLoginEmail = functions.https.onCall(async () => {
  throw new functions.https.HttpsError('failed-precondition', 'Username login is no longer supported. Please sign in with email.');
});
