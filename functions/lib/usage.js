// Quota data is read and changed in one transaction, before calling Llama.
export async function reserveUserUsage(db, uid) {
  if (!db || !uid) throw new Error('Usage service unavailable. Please try again.');
  const userRef = db.collection('users').doc(uid);
  const countersRef = userRef.collection('meta').doc('counters');
  return db.runTransaction(async (tx) => {
    const [user, counters] = await Promise.all([tx.get(userRef), tx.get(countersRef)]);
    if (!user.exists) throw new Error('Account is not ready. Please try again.');
    const profile = user.data();
    const current = counters.data() || {};
    const quota = Number(profile.monthly_quota ?? 5);
    if (!Number.isFinite(quota) || quota < 0) throw new Error('Invalid account quota');
    let uses = Number(current.uses_this_month || 0);
    let extraUsed = Number(current.extra_uses_used || 0);
    let period = current.usage_period_end || null;
    const now = new Date();
    const resets = {};
    // Free/institution cycles do not depend on a Stripe invoice. Paid cycles
    // are advanced by billing, never by an unverified client.
    if (profile.verifiedInstitution || !profile.plan || profile.plan === 'free') {
      if (!period || Date.parse(period) <= now.getTime()) {
        const day = Math.min(28, Math.max(1, Number(profile.usage_cycle_day) || now.getUTCDate()));
        period = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + (now.getUTCDate() >= day ? 1 : 0), day)).toISOString();
        uses = 0;
        extraUsed = 0;
        Object.assign(resets, { uses_this_month: 0, extra_uses_used: 0, usage_period_end: period });
      }
    }
    const extra = Number(current.extra_uses_balance || 0);
    const kind = uses >= quota ? 'extra' : 'monthly';
    if (kind === 'extra' && extra <= 0) return { allowed: false, error: 'Monthly uses limit reached' };
    tx.set(countersRef, {
      ...resets,
      ...(kind === 'extra'
        ? { extra_uses_balance: extra - 1, extra_uses_used: extraUsed + 1 }
        : { uses_this_month: uses + 1 }),
    }, { merge: true });
    return {
      allowed: true,
      consumed: { kind, period },
      plan: profile.plan || 'free', monthlyQuota: quota,
      usesThisMonth: kind === 'monthly' ? uses + 1 : uses,
      extraUsesBalance: kind === 'extra' ? extra - 1 : extra,
      wordLimit: Number(profile.word_limit || 3000),
      consumedFromExtra: kind === 'extra',
    };
  });
}

export async function refundUserUsage(db, uid, consumed) {
  if (!db || !uid || !consumed) return;
  const userRef = db.collection('users').doc(uid);
  const countersRef = userRef.collection('meta').doc('counters');
  await db.runTransaction(async (tx) => {
    const [user, counters] = await Promise.all([tx.get(userRef), tx.get(countersRef)]);
    if (!user.exists || !counters.exists) return;
    const current = counters.data();
    const samePeriod = (current.usage_period_end || null) === consumed.period;
    if (consumed.kind === 'extra') {
      tx.update(countersRef, {
        extra_uses_balance: Number(current.extra_uses_balance || 0) + 1,
        ...(samePeriod ? { extra_uses_used: Math.max(0, Number(current.extra_uses_used || 0) - 1) } : {}),
      });
    } else if (samePeriod) {
      tx.update(countersRef, { uses_this_month: Math.max(0, Number(current.uses_this_month || 0) - 1) });
    }
  });
}
