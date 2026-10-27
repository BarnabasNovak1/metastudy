import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';

// A completed receipt never expires. A lease only expires for unfinished work.
export async function claimWebhookEvent(db, event, now = Date.now()) {
  const ref = db.collection('webhook_events').doc(event.id);
  const token = randomUUID();
  const state = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    // Old receipts did not have a status. Preserve them rather than replaying
    // historical purchases whose fulfillment cannot safely be inferred.
    if (snap.exists && (!data.status || data.status === 'completed')) return 'completed';
    if (data?.status === 'processing' && data.leaseUntil > now) return 'busy';
    tx.set(ref, {
      type: event.type, status: 'processing', token,
      leaseUntil: now + 10 * 60 * 1000,
      receivedAt: FieldValue.serverTimestamp(),
    });
    return 'claimed';
  });
  return { ref, token, state };
}

export async function finishWebhookEvent(db, claim, succeeded) {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(claim.ref);
    if (snap.data()?.token !== claim.token) return;
    tx.update(claim.ref, succeeded
      ? { status: 'completed', completedAt: FieldValue.serverTimestamp(), leaseUntil: 0 }
      : { status: 'failed', leaseUntil: 0 });
  });
}

// Both delivery paths use the Stripe session ID, not an event or Firestore ID.
// The credit and receipt commit together, including after a process crash.
export async function creditAddonSession(db, stripe, session, uid, addonPriceId) {
  if (session.mode !== 'payment' || session.payment_status !== 'paid') return false;
  if (!addonPriceId) throw new Error('Add-on price is not configured');
  const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
  if (items.has_more || items.data.length !== 1 || items.data[0].price?.id !== addonPriceId) {
    console.warn('[billing] Ignoring checkout with an unsupported add-on price', session.id);
    return false;
  }
  const quantity = items.data[0].quantity;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(quantity * 10)) {
    throw new Error('Invalid add-on quantity');
  }
  const receipt = db.collection('billing_purchases').doc(session.id);
  const userRef = db.collection('users').doc(uid);
  const countersRef = userRef.collection('meta').doc('counters');
  return db.runTransaction(async (tx) => {
    const [purchase, user, counters] = await Promise.all([
      tx.get(receipt), tx.get(userRef), tx.get(countersRef),
    ]);
    if (purchase.exists) return false;
    if (!user.exists) throw new Error('Add-on account no longer exists');
    const balance = Number(counters.data()?.extra_uses_balance || 0) + quantity * 10;
    tx.set(countersRef, { extra_uses_balance: balance }, { merge: true });
    tx.set(userRef, { extra_uses_balance: balance }, { merge: true });
    tx.create(receipt, { uid, quantity, uses: quantity * 10, createdAt: FieldValue.serverTimestamp() });
    return true;
  });
}

export function usesStripeExtension() {
  const mode = process.env.BILLING_MODE || 'custom';
  if (!['custom', 'extension'].includes(mode)) throw new Error('Invalid BILLING_MODE');
  return mode === 'extension';
}
