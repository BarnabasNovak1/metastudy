// ================================================================
// Billing routes: Stripe checkout, portal, session sync, force sync.
// Extracted from server.js - register() mounts them on the shared app.
// ================================================================
import {
  requireAuth, enforceWordLimit, getStripeCustomerId,
  db, fdb, stripe, PRICE_MAP, PLAN_CONFIG,
} from './shared.js';
import { getAuth } from 'firebase-admin/auth';
import { usesStripeExtension } from '../lib/billing-safety.js';

export function register(app) {
  const SUBSCRIPTION_PRICE_IDS = [PRICE_MAP.BASIC, PRICE_MAP.ADVANCED, PRICE_MAP.PRO].filter(Boolean);
  const ADDON_PRICE_IDS = Object.keys(PRICE_MAP)
    .filter((k) => k.startsWith('ADDON'))
    .map((k) => PRICE_MAP[k])
    .filter(Boolean);

  // Billing - create checkout session for subscriptions
  app.post('/billing/create-checkout-session', requireAuth, enforceWordLimit, async (req, res) => {
    try {
      if (usesStripeExtension()) return res.status(409).json({ error: 'Checkout is unavailable. Please refresh the app or contact support.' });
      const { priceId } = req.body ?? {};
      const uid = req.authUid;
      if (!priceId || !uid) return res.status(400).json({ error: 'priceId and uid required' });
      if (!SUBSCRIPTION_PRICE_IDS.includes(priceId)) {
        return res.status(400).json({ error: 'Invalid priceId' });
      }
      const customerId = await getStripeCustomerId(uid);
      // Read the app-side email to keep Stripe customer email in sync
      let userEmail = null;
      try {
        const usnap = await db.doc(`users/${uid}`).get();
        if (usnap.exists) userEmail = (usnap.data() || {}).email || null;
      } catch {}
      // If customer already has an active/trialing subscription, direct them to the billing portal to change plans.
      if (customerId) {
        try {
          // Proactively keep Stripe customer's email aligned with app email
          try { if (userEmail) await stripe.customers.update(customerId, { email: userEmail }); } catch {}
          const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 });
          const hasActive = subs.data?.some(s => ['active','trialing','past_due','unpaid'].includes(s.status));
          if (hasActive) {
            const portal = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: (req.headers.origin || 'http://localhost:5173') + '/account' });
            return res.json({ portal_url: portal.url, already_subscribed: true });
          }
        } catch {}
      }
      const base = {
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${req.headers.origin || 'http://localhost:5173'}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${req.headers.origin || 'http://localhost:5173'}/checkout/cancel`,
        metadata: { uid },
        client_reference_id: uid,
        // Let Stripe automatically determine best payment methods for the user's browser/device
        allow_promotion_codes: true,
      };
      if (customerId) {
        Object.assign(base, { customer: customerId });
      } else if (userEmail) {
        // Hint Stripe to create the customer with this email
        Object.assign(base, { customer_email: userEmail });
      }
      const session = await stripe.checkout.sessions.create(base);
      res.json({ url: session.url });
    } catch (e) {
      console.error('[billing/create-checkout-session] ERROR:', e?.message || e, e?.stack);
      res.status(500).json({ error: e?.message || 'Failed to create checkout session' });
    }
  });

  // Billing - create addon session (one-time)
  app.post('/billing/create-addon-session', requireAuth, enforceWordLimit, async (req, res) => {
    try {
      if (usesStripeExtension()) return res.status(409).json({ error: 'Checkout is unavailable. Please refresh the app or contact support.' });
      const { priceId } = req.body ?? {};
      const uid = req.authUid;
      if (!priceId || !uid) return res.status(400).json({ error: 'priceId and uid required' });
      if (!ADDON_PRICE_IDS.includes(priceId)) {
        return res.status(400).json({ error: 'Invalid priceId' });
      }
      const customerId = await getStripeCustomerId(uid);
      // Read the app-side email to keep Stripe customer email in sync
      let userEmail = null;
      try {
        const usnap = await db.doc(`users/${uid}`).get();
        if (usnap.exists) userEmail = (usnap.data() || {}).email || null;
      } catch {}
      const base = {
        mode: 'payment',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${req.headers.origin || 'http://localhost:5173'}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${req.headers.origin || 'http://localhost:5173'}/checkout/cancel`,
        metadata: { uid, addon: '10_uses' },
        client_reference_id: uid,
        // Let Stripe automatically determine best payment methods for the user's browser/device
        allow_promotion_codes: true,
      };
      if (customerId) {
        // Align existing customer's email
        try { if (userEmail) await stripe.customers.update(customerId, { email: userEmail }); } catch {}
        Object.assign(base, { customer: customerId });
      } else if (userEmail) {
        Object.assign(base, { customer_email: userEmail });
      }
      const session = await stripe.checkout.sessions.create(base);
      res.json({ url: session.url });
    } catch (e) {
      console.error('[billing/create-addon-session] ERROR:', e?.message || e, e?.stack);
      res.status(500).json({ error: e?.message || 'Failed to create addon session' });
    }
  });

  // Read-only checkout status. Fulfillment is owned by signed billing events.
  app.post('/billing/sync-session', requireAuth, enforceWordLimit, async (req, res) => {
    try {
      const { sessionId } = req.body ?? {};
      const uid = req.authUid;
      if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
      const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['subscription', 'line_items.data.price'] });
      // Verify the session belongs to the calling user before returning its details
      const sessionUid = session.client_reference_id || session.metadata?.uid || null;
      if (!sessionUid || sessionUid !== uid) {
        return res.status(403).json({ error: 'Session does not belong to this account' });
      }
      const mode = session.mode;
      const status = session.status;
      if (status !== 'complete') return res.json({ status });

      if (mode === 'subscription') {
        const price = session?.line_items?.data?.[0]?.price?.id || session?.subscription?.items?.data?.[0]?.price?.id;
        let applied;
        if (price === PRICE_MAP.BASIC) applied = PLAN_CONFIG.BASIC;
        else if (price === PRICE_MAP.ADVANCED) applied = PLAN_CONFIG.ADVANCED;
        else if (price === PRICE_MAP.PRO) applied = PLAN_CONFIG.PRO;

        const renews_at = session?.subscription?.current_period_end ? new Date(session.subscription.current_period_end * 1000).toISOString() : null;
        return res.json({ status, payment_status: session.payment_status, type: 'subscription', applied, renews_at, customer: session.customer });
      } else if (mode === 'payment') {
        const item = session?.line_items?.data?.[0];
        const paid = session.payment_status === 'paid';
        const supported = PRICE_MAP.ADDON_10 && item?.price?.id === PRICE_MAP.ADDON_10;
        return res.json({ status, payment_status: session.payment_status, type: 'addon', add_uses: paid && supported ? 10 * (item.quantity || 1) : 0 });
      }
      res.json({ status });
    } catch (e) {
      res.status(500).json({ error: e?.message || 'Failed to sync session' });
    }
  });

  // Billing - customer portal session
  app.post('/billing/create-portal-session', requireAuth, enforceWordLimit, async (req, res) => {
    try {
      const uid = req.authUid;
      // Look up the Stripe customer ID server-side to prevent IDOR
      const verifiedCustomerId = await getStripeCustomerId(uid);
      if (!verifiedCustomerId) return res.status(400).json({ error: 'No Stripe customer linked to your account' });
      const session = await stripe.billingPortal.sessions.create({
        customer: verifiedCustomerId,
        return_url: (req.headers.origin || 'http://localhost:5173') + '/account',
      });
      res.json({ url: session.url });
    } catch (e) {
      console.error('[billing/create-portal-session] ERROR:', e?.message || e, e?.stack);
      res.status(500).json({ error: e?.message || 'Failed to create portal session' });
    }
  });

  // Billing - force sync subscription from Stripe to Firebase
  app.post('/billing/force-sync', requireAuth, enforceWordLimit, async (req, res) => {
    try {
      // Always use the verified auth UID - never trust client-supplied uid
      const uid = req.authUid;
      if (!uid) return res.status(400).json({ error: 'uid required' });
    
      // Get user data from Firebase
      const userRef = fdb.collection('users').doc(uid);
      const userSnap = await userRef.get();
      if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
    
      const userData = userSnap.data() || {};
      let customerId = userData.stripe_customer_id;
    
      // DO NOT search by email - that could link wrong accounts
      // Customer ID must be set by the checkout webhook using client_reference_id
      if (!customerId) {
        return res.status(400).json({ 
          error: 'No Stripe subscription linked to this account. Please complete checkout again or contact support.',
          hint: 'The payment email may differ from your account email. Complete a new checkout to link your subscription.'
        });
      }
    
      // Get active subscriptions from Stripe
      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: 'active',
        limit: 1,
      });
    
      if (!subscriptions.data.length) {
        // No active subscription - set to free plan
        await userRef.set({
          ...PLAN_CONFIG.FREE,
          renews_at: null,
          subscription_cancelled: false,
        }, { merge: true });
        return res.json({ success: true, plan: 'free', message: 'No active subscription found, set to free plan' });
      }
    
      const sub = subscriptions.data[0];
      const priceId = sub.items.data[0]?.price?.id;
      const renews_at = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
    
      // Map price to plan
      let applied = null;
      if (priceId === PRICE_MAP.BASIC) applied = PLAN_CONFIG.BASIC;
      else if (priceId === PRICE_MAP.ADVANCED) applied = PLAN_CONFIG.ADVANCED;
      else if (priceId === PRICE_MAP.PRO) applied = PLAN_CONFIG.PRO;
    
      // Try to get plan from price metadata or product name if direct mapping failed
      if (!applied && priceId) {
        try {
          const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
          const role = String(price.metadata?.role || '').toLowerCase();
          const productName = typeof price.product === 'object' ? (price.product?.name || '').toLowerCase() : '';
        
          if (role === 'basic' || productName.includes('basic')) applied = PLAN_CONFIG.BASIC;
          else if (role === 'advanced' || productName.includes('advanced')) applied = PLAN_CONFIG.ADVANCED;
          else if (role === 'pro' || productName.includes('pro')) applied = PLAN_CONFIG.PRO;
        } catch {}
      }
    
      if (!applied) {
        return res.status(400).json({ error: 'Could not determine plan from subscription', priceId });
      }
    
      // Update user's plan in Firebase
      await userRef.set({
        ...applied,
        renews_at,
        subscription_cancelled: sub.cancel_at_period_end || false,
      }, { merge: true });
    
      // Also set stripeRole custom claim for auth
      try {
        await getAuth().setCustomUserClaims(uid, { stripeRole: applied.plan });
      } catch (e) {
        console.error('Failed to set custom claims:', e?.message);
      }
    
      res.json({ success: true, plan: applied.plan, renews_at, priceId });
    } catch (e) {
      console.error('[billing/force-sync] ERROR:', e?.message || e, e?.stack);
      res.status(500).json({ error: e?.message || 'Failed to sync subscription' });
    }
  });
}
