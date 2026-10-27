import { functions, db } from './lib/shared.js';
import { Timestamp } from 'firebase-admin/firestore';


// Cleanup: remove report resolution logs after 2 years
export const cleanupExpiredReportLogs = functions.pubsub
  .schedule('every 24 hours')
  .onRun(async () => {
    const now = Timestamp.now();
    let deletedCount = 0;

    while (true) {
      const snap = await db.collection('moderation_logs')
        .where('type', '==', 'report_resolved')
        .where('retentionUntil', '<=', now)
        .limit(300)
        .get();

      if (snap.empty) break;

      const batch = db.batch();
      snap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      deletedCount += snap.size;

      if (snap.size < 300) break;
    }

    console.log(`[cleanupExpiredReportLogs] Deleted ${deletedCount} expired report logs`);
    return null;
  });

// Fallback auto-reset: ensure usage counters roll over even if a webhook/client sync was missed.
// - Institution users: reset on institution cycle (usage_cycle_day / usage_period_end)
// - Normal paid users: reset on billing period rollover unless subscription is cancelled
export const autoResetUsageCounters = functions.pubsub
  .schedule('every 24 hours')
  .onRun(async () => {
    const now = new Date();
    const nowMs = now.getTime();
    const clampDay = (day) => Math.min(28, Math.max(1, Number(day) || 1));
    const computeNextFromDayUtc = (anchorDay) => {
      const day = clampDay(anchorDay);
      const y = now.getUTCFullYear();
      const m = now.getUTCMonth();
      const d = now.getUTCDate();
      const next = d < day ? new Date(Date.UTC(y, m, day)) : new Date(Date.UTC(y, m + 1, day));
      return next.toISOString();
    };
    const addOneMonthIso = (iso) => {
      const base = new Date(iso);
      if (Number.isNaN(base.getTime())) return null;
      base.setUTCMonth(base.getUTCMonth() + 1);
      return base.toISOString();
    };

    let institutionChecked = 0;
    let institutionReset = 0;
    let institutionInitialized = 0;
    let paidChecked = 0;
    let paidReset = 0;
    let paidSynced = 0;
    let skippedCancelled = 0;

    // 1) Institution users
    let instCursor = null;
    while (true) {
      let q = db.collection('users')
        .where('verifiedInstitution', '==', true)
        .orderBy('__name__')
        .limit(200);
      if (instCursor) q = q.startAfter(instCursor);
      const snap = await q.get();
      if (snap.empty) break;

      for (const userDoc of snap.docs) {
        institutionChecked++;
        const userData = userDoc.data() || {};
        const anchorDay = clampDay(userData.usage_cycle_day || now.getUTCDate());
        const countersRef = userDoc.ref.collection('meta').doc('counters');
        const countersSnap = await countersRef.get();
        const counters = countersSnap.exists ? (countersSnap.data() || {}) : {};
        const usagePeriodEnd = typeof counters.usage_period_end === 'string' ? counters.usage_period_end : null;

        if (!usagePeriodEnd) {
          await countersRef.set({ usage_period_end: computeNextFromDayUtc(anchorDay) }, { merge: true });
          institutionInitialized++;
          continue;
        }

        const endMs = new Date(usagePeriodEnd).getTime();
        if (!Number.isNaN(endMs) && nowMs >= endMs) {
          await countersRef.set({
            uses_this_month: 0,
            extra_uses_used: 0,
            usage_period_end: computeNextFromDayUtc(anchorDay),
          }, { merge: true });
          institutionReset++;
        }
      }

      instCursor = snap.docs[snap.docs.length - 1];
      if (snap.size < 200) break;
    }

    // 2) Normal paid users (skip cancelled subscriptions)
    let paidCursor = null;
    while (true) {
      let q = db.collection('users')
        .where('plan', 'in', ['basic', 'advanced', 'pro'])
        .orderBy('__name__')
        .limit(200);
      if (paidCursor) q = q.startAfter(paidCursor);
      const snap = await q.get();
      if (snap.empty) break;

      for (const userDoc of snap.docs) {
        paidChecked++;
        const userData = userDoc.data() || {};
        if (userData.verifiedInstitution === true) continue;
        if (userData.subscription_cancelled === true) {
          skippedCancelled++;
          continue;
        }

        const renewsAt = typeof userData.renews_at === 'string' ? userData.renews_at : null;
        const countersRef = userDoc.ref.collection('meta').doc('counters');
        const countersSnap = await countersRef.get();
        const counters = countersSnap.exists ? (countersSnap.data() || {}) : {};
        const usagePeriodEnd = typeof counters.usage_period_end === 'string' ? counters.usage_period_end : null;

        if (!usagePeriodEnd && renewsAt) {
          await countersRef.set({ usage_period_end: renewsAt }, { merge: true });
          paidSynced++;
          continue;
        }

        if (!usagePeriodEnd) continue;
        const endMs = new Date(usagePeriodEnd).getTime();
        if (Number.isNaN(endMs) || nowMs < endMs) continue;

        const renewMs = renewsAt ? new Date(renewsAt).getTime() : NaN;
        const nextEnd = (!Number.isNaN(renewMs) && renewMs > nowMs)
          ? renewsAt
          : (addOneMonthIso(usagePeriodEnd) || new Date(nowMs + (30 * 24 * 60 * 60 * 1000)).toISOString());

        await countersRef.set({
          uses_this_month: 0,
          extra_uses_used: 0,
          usage_period_end: nextEnd,
        }, { merge: true });
        paidReset++;
      }

      paidCursor = snap.docs[snap.docs.length - 1];
      if (snap.size < 200) break;
    }

    // 3) Free users - reset on personal cycle (usage_cycle_day / usage_period_end)
    let freeChecked = 0;
    let freeReset = 0;
    let freeInitialized = 0;
    let freeCursor = null;
    while (true) {
      let q = db.collection('users')
        .where('plan', '==', 'free')
        .orderBy('__name__')
        .limit(200);
      if (freeCursor) q = q.startAfter(freeCursor);
      const snap = await q.get();
      if (snap.empty) break;

      for (const userDoc of snap.docs) {
        freeChecked++;
        const userData = userDoc.data() || {};
        // Skip institution users (handled in section 1) and demo users
        if (userData.verifiedInstitution === true) continue;
        if (userData.isDemoUser === true) continue;

        const countersRef = userDoc.ref.collection('meta').doc('counters');
        const countersSnap = await countersRef.get();
        const counters = countersSnap.exists ? (countersSnap.data() || {}) : {};
        const usagePeriodEnd = typeof counters.usage_period_end === 'string' ? counters.usage_period_end : null;

        // Use existing cycle day or default to the day they signed up (or today)
        const anchorDay = clampDay(userData.usage_cycle_day || now.getUTCDate());

        if (!usagePeriodEnd) {
          // Initialize usage_period_end for free users who don't have one
          const nextEnd = computeNextFromDayUtc(anchorDay);
          await countersRef.set({ usage_period_end: nextEnd }, { merge: true });
          // Also set usage_cycle_day if not set
          if (typeof userData.usage_cycle_day !== 'number') {
            await userDoc.ref.set({ usage_cycle_day: anchorDay }, { merge: true });
          }
          freeInitialized++;
          continue;
        }

        const endMs = new Date(usagePeriodEnd).getTime();
        if (!Number.isNaN(endMs) && nowMs >= endMs) {
          // Reset counters and set next period
          await countersRef.set({
            uses_this_month: 0,
            extra_uses_used: 0,
            usage_period_end: computeNextFromDayUtc(anchorDay),
          }, { merge: true });
          freeReset++;
        }
      }

      freeCursor = snap.docs[snap.docs.length - 1];
      if (snap.size < 200) break;
    }

    console.log('[autoResetUsageCounters] complete', {
      institutionChecked,
      institutionReset,
      institutionInitialized,
      paidChecked,
      paidReset,
      paidSynced,
      skippedCancelled,
      freeChecked,
      freeReset,
      freeInitialized,
    });

    return null;
  });
