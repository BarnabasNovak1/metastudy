import { functions, db, PRICE_MAP, PLAN_CONFIG, mapPlanByPriceId, getStripe, Stripe } from './lib/shared.js';
import { FieldValue } from 'firebase-admin/firestore';
import { creditAddonSession, usesStripeExtension } from './lib/billing-safety.js';


// Mirror counters -> root user doc for admin viewing in Console
export const onCountersUpdate = functions.firestore
  .document('users/{uid}/meta/counters')
  .onWrite(async (change, context) => {
    const uid = context.params.uid;
    const before = change.before.exists ? (change.before.data() || {}) : null;
    const after = change.after.exists ? (change.after.data() || {}) : null;
    if (!after) return;
    const uses = Number(after.uses_this_month || 0);
    const extra = Number(after.extra_uses_balance || 0);
    const periodEnd = typeof after.usage_period_end === 'string' ? after.usage_period_end : null;
    const beforeUses = Number(before?.uses_this_month || 0);
    const beforeExtra = Number(before?.extra_uses_balance || 0);
    const beforePeriodEnd = typeof before?.usage_period_end === 'string' ? before.usage_period_end : null;

    // PRIVACY: mirror public stats to public_profiles (profile popups read this
    // instead of the private meta/counters doc)
    const publicStats = {
      xp: Number(after.xp || 0),
      quizzes: Number(after.quizzes || 0),
      chats: Number(after.chats || 0),
      flashcards: Number(after.flashcards || 0),
    };
    const beforeStats = before ? {
      xp: Number(before.xp || 0),
      quizzes: Number(before.quizzes || 0),
      chats: Number(before.chats || 0),
      flashcards: Number(before.flashcards || 0),
    } : null;
    const statsChanged = !beforeStats || Object.keys(publicStats).some((k) => publicStats[k] !== beforeStats[k]);
    if (statsChanged) {
      try {
        await db.collection('public_profiles').doc(uid).set({
          ...publicStats,
          updated_at: FieldValue.serverTimestamp(),
        }, { merge: true });
      } catch (e) {
        console.error('Failed to mirror counters to public profile', uid, e?.message || e);
      }
    }

    if (before && uses === beforeUses && extra === beforeExtra && periodEnd === beforePeriodEnd) return;
    try {
      await db.collection('users').doc(uid).set({
        uses_this_month: uses,
        extra_uses_balance: extra,
        ...(periodEnd ? { usage_period_end: periodEnd } : {}),
      }, { merge: true });
    } catch (e) {
      console.error('Failed to mirror counters to user root', uid, e?.message || e);
    }
  });

// PRIVACY: Mirror safe profile fields -> public_profiles/{uid}.
// The users/{uid} doc is owner-only readable (it contains plan/billing data);
// other users read public_profiles instead.
export const onUserProfileWrite = functions.firestore
  .document('users/{uid}')
  .onWrite(async (change, context) => {
    const uid = context.params.uid;
    if (!change.after.exists) {
      // User deleted -> remove public mirror
      try { await db.collection('public_profiles').doc(uid).delete(); } catch {}
      return;
    }
    const after = change.after.data() || {};
    const before = change.before.exists ? (change.before.data() || {}) : {};
    const pick = (d) => ({
      username: (d.username || '').toLowerCase() || null,
      photo_url: d.photo_url || d.photoURL || null,
      bio: d.bio || null,
      education_level: d.education_level || null,
    });
    const afterPub = pick(after);
    const beforePub = pick(before);
    if (change.before.exists && JSON.stringify(afterPub) === JSON.stringify(beforePub)) return;
    try {
      await db.collection('public_profiles').doc(uid).set({
        ...afterPub,
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (e) {
      console.error('Failed to mirror user profile to public profile', uid, e?.message || e);
    }
  });

// PRIVACY: Mirror streak/days stats -> public_profiles/{uid}
export const onAchievementsUpdate = functions.firestore
  .document('users/{uid}/meta/achievements')
  .onWrite(async (change, context) => {
    const uid = context.params.uid;
    if (!change.after.exists) return;
    const after = change.after.data() || {};
    const before = change.before.exists ? (change.before.data() || {}) : {};
    const keys = ['days_total', 'streak_current', 'streak_longest'];
    if (change.before.exists && keys.every((k) => Number(after[k] || 0) === Number(before[k] || 0))) return;
    try {
      await db.collection('public_profiles').doc(uid).set({
        days_total: Number(after.days_total || 0),
        streak_current: Number(after.streak_current || 0),
        streak_longest: Number(after.streak_longest || 0),
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (e) {
      console.error('Failed to mirror achievements to public profile', uid, e?.message || e);
    }
  });

// PRIVACY: Keep challenge participation counts on public_profiles so runs can be owner-only
export const onUserRunWrite = functions.firestore
  .document('users/{uid}/runs/{runId}')
  .onWrite(async (change, context) => {
    const uid = context.params.uid;
    const isCompleted = (d) => !!d && d.score !== null && d.score !== undefined && !!d.completedAt;
    const before = change.before.exists ? change.before.data() : null;
    const after = change.after.exists ? change.after.data() : null;
    let joinedDelta = 0;
    let completedDelta = 0;
    if (!before && after) joinedDelta = 1;
    if (before && !after) joinedDelta = -1;
    const wasCompleted = isCompleted(before);
    const nowCompleted = isCompleted(after);
    if (!wasCompleted && nowCompleted) completedDelta = 1;
    if (wasCompleted && !nowCompleted) completedDelta = -1;
    if (joinedDelta === 0 && completedDelta === 0) return;
    try {
      await db.collection('public_profiles').doc(uid).set({
        challenges_joined: FieldValue.increment(joinedDelta),
        challenges_completed: FieldValue.increment(completedDelta),
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (e) {
      console.error('Failed to update challenge counts on public profile', uid, e?.message || e);
    }
  });

// PRIVACY: Keep friends_count on public_profiles so the friends list can be owner-only
export const onFriendWrite = functions.firestore
  .document('users/{uid}/friends/{friendUid}')
  .onWrite(async (change, context) => {
    const uid = context.params.uid;
    const delta = (!change.before.exists && change.after.exists) ? 1
      : (change.before.exists && !change.after.exists) ? -1 : 0;
    if (delta === 0) return;
    try {
      await db.collection('public_profiles').doc(uid).set({
        friends_count: FieldValue.increment(delta),
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (e) {
      console.error('Failed to update friends count on public profile', uid, e?.message || e);
    }
  });

// Mirror Stripe customer id from extension to users/{uid}
export const onCustomerWrite = functions.firestore
  .document('customers/{uid}')
  .onWrite(async (change, context) => {
    const uid = context.params.uid;
    const before = change.before.exists ? change.before.data() || {} : null;
    const after = change.after.exists ? change.after.data() || {} : null;
    if (!after) return;
    const beforeStripeId = before?.stripeId || before?.stripe_id || before?.customer_id || before?.customerId || null;
    const stripeId = after.stripeId || after.stripe_id || after.customer_id || after.customerId;
    if (!stripeId) return;
    if (beforeStripeId === stripeId) return;
    await db.collection('users').doc(uid).set({ stripe_customer_id: stripeId }, { merge: true });
  });

// Sync subscription -> users/{uid} plan fields (OPTIMIZED: single batch write)
export const onSubscriptionWrite = functions.firestore
  .document('customers/{uid}/subscriptions/{subId}')
  .onWrite(async (change, context) => {
    if (!usesStripeExtension()) return;
    const uid = context.params.uid;
    const after = change.after.exists ? change.after.data() || {} : null;
    const before = change.before.exists ? change.before.data() || {} : null;
    if (!after && !before) return;

    // Skip if no meaningful change (same status and price)
    const afterStatus = (after?.status || '').toLowerCase();
    const beforeStatus = (before?.status || '').toLowerCase();
    const afterPrice = after?.price?.id || after?.priceId || after?.items?.[0]?.price?.id || '';
    const beforePrice = before?.price?.id || before?.priceId || before?.items?.[0]?.price?.id || '';
    if (afterStatus === beforeStatus && afterPrice === beforePrice
      && after?.current_period_end === before?.current_period_end
      && after?.current_period_end_time === before?.current_period_end_time
      && after?.cancel_at_period_end === before?.cancel_at_period_end) return;

    // Determine status and active priceId
    const status = after ? afterStatus : 'canceled';
    const firstItem = Array.isArray(after?.items) ? after.items[0] : null;
    const priceId = after?.price?.id || after?.priceId || firstItem?.price?.id || firstItem?.price || '';
    const priceMetaRole = String(firstItem?.price?.metadata?.role || after?.price?.metadata?.role || '').toLowerCase();

    let applied = mapPlanByPriceId(priceId);
    if (!applied && priceMetaRole) {
      if (priceMetaRole === 'basic') applied = PLAN_CONFIG.BASIC;
      else if (priceMetaRole === 'advanced') applied = PLAN_CONFIG.ADVANCED;
      else if (priceMetaRole === 'pro') applied = PLAN_CONFIG.PRO;
    }
    // Skip Firestore price lookup - too expensive

    const renewEpoch = after?.current_period_end || after?.current_period_end_time || 0;
    const renews_at = renewEpoch ? new Date(Number(renewEpoch) * (renewEpoch > 1e12 ? 1 : 1000)).toISOString() : null;
    const isActive = ['active', 'trialing'].includes(status);

    // Use batch write to update user doc and counters in single operation
    const batch = db.batch();
    const userRef = db.collection('users').doc(uid);
    const countersRef = userRef.collection('meta').doc('counters');

    if (isActive && applied) {
      batch.set(userRef, { ...applied, renews_at }, { merge: true });
      if (renews_at) batch.set(countersRef, { usage_period_end: renews_at }, { merge: true });
    } else if (!isActive) {
      batch.set(userRef, { ...PLAN_CONFIG.FREE, renews_at: null }, { merge: true });
      batch.set(countersRef, { usage_period_end: null }, { merge: true });
    } else {
      return; // Active but unknown price -> skip
    }
    await batch.commit();
  });

// Handle add-on payments via extension checkout sessions
export const onCheckoutSessionWrite = functions
  .firestore
  .document('customers/{uid}/checkout_sessions/{sessionId}')
  .onWrite(async (change, context) => {
    if (!usesStripeExtension()) return;
    const uid = context.params.uid;
    const after = change.after.exists ? change.after.data() || {} : null;
    if (!after) return;

    const status = (after.status || '').toLowerCase();
    const mode = (after.mode || '').toLowerCase();
    if (status !== 'complete' || mode !== 'payment') return;

    // Never grant credit from a client-authored Firestore document.
    const sessionId = after.sessionId;
    if (typeof sessionId !== 'string' || !sessionId.startsWith('cs_')) return;
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const customer = await db.collection('customers').doc(uid).get();
    const customerId = customer.data()?.stripeId;
    if (!customerId || session.customer !== customerId) {
      console.error('[onCheckoutSessionWrite] Checkout customer mismatch', sessionId);
      return;
    }
    await creditAddonSession(db, stripe, session, uid, PRICE_MAP.ADDON_10);
  });
