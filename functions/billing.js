import { functions, db, getStripe, PRICE_MAP, PLAN_CONFIG, applyInstitutionStatusForUser, mapPlanByPriceId, Stripe } from './lib/shared.js';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { claimWebhookEvent, finishWebhookEvent, creditAddonSession, usesStripeExtension } from './lib/billing-safety.js';


// Activate institution plan based on email domain matching (no email verification required)
export const activateInstitutionPlan = functions.https.onCall(async (data, context) => {
  const uid = context?.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');

  let result;
  try {
    result = await applyInstitutionStatusForUser(uid, data?.institutionId);
  } catch (e) {
    console.error('activateInstitutionPlan error:', e?.message || e);
    throw new functions.https.HttpsError('internal', 'Activation failed: ' + (e?.message || 'unknown'));
  }

  if (!result.ok) {
    const reason = result.reason;
    if (reason === 'no-email' || reason === 'invalid-email') {
      throw new functions.https.HttpsError('failed-precondition', 'No valid email associated with account');
    }
    if (reason === 'no-institution') {
      // No institution matched - return ok with no updates rather than error
      return { ok: true, updated: { verifiedInstitution: false } };
    }
    if (reason === 'domain-mismatch') {
      throw new functions.https.HttpsError(
        'permission-denied',
        `Email domain "${result.domain}" does not match institution domain "${result.instDomain}". Please use your institution email.`
      );
    }
    if (reason === 'limit-reached') {
      throw new functions.https.HttpsError(
        'resource-exhausted',
        `This institution has reached its user limit of ${result.userLimit}. Please contact your institution administrator.`
      );
    }
    throw new functions.https.HttpsError('internal', 'Activation failed: ' + reason);
  }
  return { ok: true, updated: result.updates, planApplied: result.planApplied };
});

// Ensure only a single active subscription exists for a customer
async function cancelOtherSubs(customerId, keepSubId) {
  if (!customerId) return;
  let subs;
  try {
    subs = await getStripe().subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
  } catch (e) {
    console.error(`[cancelOtherSubs] Failed to list subscriptions for customer ${customerId}:`, e?.message || e);
    throw e;
  }
  for (const s of subs.data) {
    if (s.id === keepSubId) continue;
    const status = String(s.status || '').toLowerCase();
    if (status !== 'canceled' && status !== 'incomplete_expired') {
      try {
        await getStripe().subscriptions.cancel(s.id);
        console.log(`[cancelOtherSubs] Canceled duplicate sub ${s.id} for customer ${customerId}`);
      } catch (e) {
        console.error(`[cancelOtherSubs] Failed to cancel sub ${s.id} for customer ${customerId}:`, e?.message || e);
        throw e;
      }
    }
  }
}

// ===============
// Stripe Webhook for DIRECT Payment Links / Custom Checkout (no extension)
// This uses req.rawBody for signature verification and does not depend on express body parsers.
// NOTE: Secrets are read INSIDE the handler because Firebase injects them at runtime, not at module load time.

async function updateUserByUid(uid, updates) {
  if (!uid) return;
  await db.collection('users').doc(uid).set(updates, { merge: true });
}

// Cache for user lookups to reduce reads within same webhook call
const userCache = new Map();

async function findUidByEmail(email) {
  if (!email) return null;
  const e = String(email).toLowerCase();
  const cacheKey = `email:${e}`;
  if (userCache.has(cacheKey)) return userCache.get(cacheKey);
  
  // Try lowercase first
  let snap = await db.collection('users').where('email', '==', e).limit(1).get();
  
  // If not found, try original case
  if (snap.empty && email !== e) {
    snap = await db.collection('users').where('email', '==', email).limit(1).get();
  }
  
  const uid = !snap.empty ? snap.docs[0].id : null;
  if (uid) userCache.set(cacheKey, uid);
  console.log(`[findUidByEmail] email=${email} -> uid=${uid}`);
  return uid;
}

async function findUidByCustomerId(customerId) {
  if (!customerId) return null;
  const cacheKey = `cust:${customerId}`;
  if (userCache.has(cacheKey)) return userCache.get(cacheKey);
  const snap = await db.collection('users').where('stripe_customer_id', '==', customerId).limit(1).get();
  const uid = !snap.empty ? snap.docs[0].id : null;
  if (uid) userCache.set(cacheKey, uid);
  return uid;
}

export const stripeWebhook = functions
  .https.onRequest(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  
  // Read secrets at runtime (Firebase injects them when function runs, not at module load)
  const STRIPE_KEY = (process.env.STRIPE_SECRET_KEY || '').trim();
  const STRIPE_WEBHOOK_SECRET = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  const stripe = new Stripe(STRIPE_KEY, { apiVersion: '2024-06-20' });
  
  let event;
  try {
    const sig = req.headers['stripe-signature'];
    // Debug: Log what we're working with
    console.log('[stripeWebhook] Debug: rawBody type:', typeof req.rawBody, 'length:', req.rawBody?.length);
    console.log('[stripeWebhook] Debug: sig exists:', !!sig, 'secret length:', STRIPE_WEBHOOK_SECRET?.length);
    
    if (!sig || !STRIPE_WEBHOOK_SECRET) {
      console.error('[stripeWebhook] Missing signature or webhook secret. sig:', !!sig, 'secret:', !!STRIPE_WEBHOOK_SECRET);
      return res.status(400).send('Missing signature or webhook secret');
    }
    
    // Use rawBody if available, otherwise try to stringify body
    const payload = req.rawBody || Buffer.from(JSON.stringify(req.body));
    event = stripe.webhooks.constructEvent(payload, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    const msg = err && err.message ? err.message : 'invalid';
    console.error('[stripeWebhook] Signature verification failed:', msg);
    return res.status(400).send(`Webhook Error: ${msg}`);
  }

  let claim;
  try {
    // Only one integration owns entitlement updates.
    if (usesStripeExtension() && !/^(product|price)\./.test(event.type)) {
      return res.json({ received: true, ignored: true });
    }
    claim = await claimWebhookEvent(db, event);
    if (claim.state === 'completed') {
      return res.json({ received: true, duplicate: true });
    }
    // Do not acknowledge an in-flight delivery: it may still fail.
    if (claim.state === 'busy') return res.status(503).send('Event is still processing');
  } catch (e) {
    console.error('[stripeWebhook] Idempotency check failed:', e?.message || e);
    return res.status(500).send('Idempotency check failed');
  }

  try {
    switch (event.type) {
      case 'product.created':
      case 'product.updated': {
        const product = event.data.object;
        try {
          await db.collection('products').doc(product.id).set({
            name: product.name,
            description: product.description || '',
            active: product.active,
            image: (Array.isArray(product.images) && product.images.length > 0) ? product.images[0] : null,
            metadata: product.metadata || {},
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        } catch (e) {
          console.error('Failed to upsert product', product?.id, e?.message || e);
          throw e;
        }
        break;
      }
      case 'price.created':
      case 'price.updated': {
        const price = event.data.object;
        try {
          await db.collection('products').doc(String(price.product)).collection('prices').doc(price.id).set({
            currency: price.currency,
            unit_amount: price.unit_amount,
            recurring: price.recurring || null,
            active: price.active,
            metadata: price.metadata || {},
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        } catch (e) {
          console.error('Failed to upsert price', price?.id, e?.message || e);
          throw e;
        }
        break;
      }
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        console.log('[checkout.session.completed] EVENT RECEIVED');
        const session = event.data.object;
        const mode = session.mode; // 'subscription' | 'payment'
        const customerId = session.customer;
        const email = session.customer_details?.email || session.customer_email || '';
        const clientRef = session.client_reference_id || '';
        
        console.log(`[checkout] mode=${mode}, email=${email}, clientRef=${clientRef}, customerId=${customerId}`);
        
        // IMPORTANT: Only use clientRef (Firebase UID) to link customer ID
        // Email-based lookup should NOT link stripe_customer_id to prevent cross-account issues
        let uid = null;
        let shouldLinkCustomerId = false;
        
        // Try clientRef first - this is the Firebase UID passed from checkout (MOST RELIABLE)
        if (clientRef) {
          const userDoc = await db.collection('users').doc(clientRef).get();
          if (userDoc.exists) {
            uid = clientRef;
            shouldLinkCustomerId = true; // Safe to link - we have the actual Firebase UID
            console.log(`[checkout] Found user by clientRef: ${uid}`);
          }
        }
        
        // Fallback: try customerId lookup (only if already linked from previous checkout)
        if (!uid && customerId) {
          uid = await findUidByCustomerId(customerId);
          if (uid) {
            shouldLinkCustomerId = true; // Already linked, safe to update
            console.log(`[checkout] Found user by customerId: ${uid}`);
          }
        }
        
        // Last resort: email lookup (but DON'T link customer ID - could be wrong account)
        if (!uid && email) {
          uid = await findUidByEmail(email);
          if (uid) {
            console.log(`[checkout] Found user by email: ${uid} (NOT linking customerId - use Sync Plan)`);
            // DO NOT set shouldLinkCustomerId - email might not match the Firebase account
          }
        }
        
        if (!uid) {
          console.error(`[checkout] FAILED: No user found for email=${email}, ref=${clientRef}, cust=${customerId}`);
          break;
        }

        console.log(`[checkout] Processing for uid=${uid}, linkCustomer=${shouldLinkCustomerId}`);

        // Only persist customer ID if we're confident about the user identity
        if (customerId && shouldLinkCustomerId) {
          await updateUserByUid(uid, { stripe_customer_id: customerId });
          console.log(`[checkout] Saved stripe_customer_id for uid=${uid}`);
        } else if (customerId && !shouldLinkCustomerId) {
          console.warn(`[checkout] NOT linking customerId=${customerId} to uid=${uid} - found by email only`);
        }

        if (mode === 'subscription') {
          // Retrieve subscription to access items and period end
          let priceId = null;
          let renews_at = null;
          let subId = null;
          let priceMetadata = null;
          let productName = null;
          try {
            subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
            if (subId) {
              const sub = await stripe.subscriptions.retrieve(subId, { expand: ['items.data.price.product'] });
              priceId = sub?.items?.data?.[0]?.price?.id || null;
              priceMetadata = sub?.items?.data?.[0]?.price?.metadata || null;
              const product = sub?.items?.data?.[0]?.price?.product;
              productName = typeof product === 'object' ? product?.name : null;
              renews_at = sub?.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
            }
          } catch (e) {
            console.error('[checkout] Sub retrieve error:', e?.message);
            throw e;
          }
          
          // Try direct price mapping first
          let applied = mapPlanByPriceId(priceId);
          
          // Fallback: check price metadata for role
          if (!applied && priceMetadata) {
            const role = String(priceMetadata.role || priceMetadata.plan || '').toLowerCase();
            if (role === 'basic') applied = PLAN_CONFIG.BASIC;
            else if (role === 'advanced') applied = PLAN_CONFIG.ADVANCED;
            else if (role === 'pro') applied = PLAN_CONFIG.PRO;
          }
          
          // Fallback: check product name
          if (!applied && productName) {
            const pn = productName.toLowerCase();
            if (pn.includes('basic')) applied = PLAN_CONFIG.BASIC;
            else if (pn.includes('advanced')) applied = PLAN_CONFIG.ADVANCED;
            else if (pn.includes('pro')) applied = PLAN_CONFIG.PRO;
          }
          
          // Fallback: try to get price from Stripe directly (only if needed)
          if (!applied && priceId) {
            try {
              const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
              const role = String(price.metadata?.role || '').toLowerCase();
              const pName = typeof price.product === 'object' ? price.product?.name?.toLowerCase() : '';
              if (role === 'basic' || pName.includes('basic')) applied = PLAN_CONFIG.BASIC;
              else if (role === 'advanced' || pName.includes('advanced')) applied = PLAN_CONFIG.ADVANCED;
              else if (role === 'pro' || pName.includes('pro')) applied = PLAN_CONFIG.PRO;
            } catch (e) {
              console.error('[checkout] Price retrieve error:', e?.message);
              throw e;
            }
          }
          
          console.log(`[checkout] uid=${uid} price=${priceId} plan=${applied?.plan || 'none'}`);
          
          if (applied) {
            await updateUserByUid(uid, { ...applied, renews_at, subscription_cancelled: false, stripe_subscription_id: subId });
            // Set custom claims for auth
            try {
              await getAuth().setCustomUserClaims(uid, { stripeRole: applied.plan });
            } catch (e) {
              console.error('[checkout.session.completed] Failed to set claims:', e?.message);
            }
          } else {
            console.warn(`[checkout.session.completed] No plan for priceId=${priceId}, product=${productName}`);
          }
          
          // Enforce single-active-subscription immediately after new sub
          if (customerId && subId) {
            await cancelOtherSubs(customerId, subId);
          }
        } else if (mode === 'payment') {
          await creditAddonSession(db, stripe, session, uid, PRICE_MAP.ADDON_10);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        // Stripe does not guarantee event order; resolve the current state.
        const sub = await stripe.subscriptions.retrieve(event.data.object.id);
        const customerId = sub.customer;
        
        // OPTIMIZED: Find user with cached lookups
        let uid = await findUidByCustomerId(customerId);
        if (!uid) {
          const email = sub?.latest_invoice?.customer_email || '';
          uid = await findUidByEmail(email);
        }
        if (!uid && customerId) {
          try {
            const cust = await stripe.customers.retrieve(customerId);
            const cemail = (cust && typeof cust === 'object' && 'email' in cust) ? (cust.email || '') : '';
            if (cemail) uid = await findUidByEmail(String(cemail));
          } catch {}
        }
        if (!uid) break;

        const status = String(sub.status || '').toLowerCase();
        const item = sub?.items?.data?.[0] || null;
        const priceId = item?.price?.id;
        let applied = mapPlanByPriceId(priceId);
        if (!applied) {
          const role = String(item?.price?.metadata?.role || '').toLowerCase();
          if (role === 'basic') applied = PLAN_CONFIG.BASIC;
          else if (role === 'advanced') applied = PLAN_CONFIG.ADVANCED;
          else if (role === 'pro') applied = PLAN_CONFIG.PRO;
        }
        const renews_at = sub?.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
        const isActive = ['active', 'trialing'].includes(status);
        const isCancelledButActive = Boolean(sub?.cancel_at_period_end);
        
        // Detect plan changes
        const previousAttributes = event.data?.previous_attributes || {};
        const previousPriceId = previousAttributes?.items?.data?.[0]?.price?.id || previousAttributes?.plan?.id || null;
        const isActualPlanChange = previousPriceId && priceId && previousPriceId !== priceId;
        
        const userRef = db.collection('users').doc(uid);
        const countersRef = userRef.collection('meta').doc('counters');
        const effectRef = db.collection('billing_effects').doc(event.id);
        await db.runTransaction(async (tx) => {
          const [receipt, user, counters] = await Promise.all([tx.get(effectRef), tx.get(userRef), tx.get(countersRef)]);
          if (receipt.exists || !user.exists) return;
          const profile = user.data();
          // Cancellation of an old duplicate must not remove the new plan.
          if (!isActive && profile.stripe_subscription_id && profile.stripe_subscription_id !== sub.id) return;
          if (Number(profile.stripe_event_created || 0) > event.created) return;
          const tracking = { stripe_subscription_id: sub.id, stripe_event_created: event.created };
          if (isActive && applied) {
            tx.set(userRef, { ...applied, ...tracking, renews_at, subscription_cancelled: isCancelledButActive, stripe_customer_id: customerId }, { merge: true });
            const oldEnd = Date.parse(counters.data()?.usage_period_end || '');
            const nextEnd = Date.parse(renews_at || '');
            const reset = isActualPlanChange || (Number.isFinite(nextEnd) && (!Number.isFinite(oldEnd) || nextEnd > oldEnd));
            tx.set(countersRef, {
              ...(reset ? { uses_this_month: 0, extra_uses_used: 0 } : {}),
              usage_period_end: renews_at,
            }, { merge: true });
          } else if (!isActive) {
            tx.set(userRef, { ...PLAN_CONFIG.FREE, ...tracking, renews_at: null, subscription_cancelled: false }, { merge: true });
            tx.set(countersRef, { usage_period_end: null }, { merge: true });
          }
          tx.create(effectRef, { uid, createdAt: FieldValue.serverTimestamp() });
        });
        break;
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        // Only process for subscription renewals/payments, not one-time payments
        if (!invoice.subscription) break;
        
        const customerId = invoice.customer;
        let uid = await findUidByCustomerId(customerId);
        if (!uid && invoice.customer_email) {
          uid = await findUidByEmail(invoice.customer_email);
        }
        if (!uid) break;

        // Get subscription to check if this is a renewal (not the first payment)
        try {
          const sub = await stripe.subscriptions.retrieve(invoice.subscription);
          const periodStart = sub?.current_period_start;
          const periodEnd = sub?.current_period_end;
          
          // Reset usage counters when entering a new billing period
          if (periodStart && periodEnd) {
            const newPeriodEnd = new Date(periodEnd * 1000).toISOString();
            const countersRef = db.collection('users').doc(uid).collection('meta').doc('counters');
            
            await db.runTransaction(async (tx) => {
              const counters = await tx.get(countersRef);
              const previousEnd = Date.parse(counters.data()?.usage_period_end || '');
              if (previousEnd >= periodEnd * 1000) return;
              tx.set(countersRef, {
                uses_this_month: 0,
                extra_uses_used: 0,
                usage_period_end: newPeriodEnd,
              }, { merge: true });
            });

            console.log(`Reset usage counters for user ${uid}, new period ends: ${newPeriodEnd}`);
          }
        } catch (e) {
          console.error('Failed to reset counters on invoice.payment_succeeded:', e?.message || e);
          throw e;
        }
        break;
      }
      default:
        break;
    }
    await finishWebhookEvent(db, claim, true);
    res.json({ received: true });
  } catch (e) {
    const msg = e && e.message ? e.message : 'Webhook handler failed';
    try { await finishWebhookEvent(db, claim, false); } catch (receiptError) {
      console.error('[stripeWebhook] Failed to release event lease:', receiptError);
    }
    res.status(500).send(msg);
  }
});

// Sync renews_at from Stripe subscription
export const syncRenewsAtFromStripe = functions
  .https.onCall(async (data, context) => {
  const uid = context?.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  
  try {
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    
    if (!userSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'User not found');
    }
    
    const userData = userSnap.data() || {};
    const customerId = userData.stripe_customer_id;
    
    if (!customerId) {
      return { 
        synced: false, 
        message: 'No Stripe customer ID found. You may not have a subscription yet.' 
      };
    }
    
    // Get active subscriptions from Stripe
    const subscriptions = await getStripe().subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 1
    });
    
    if (subscriptions.data.length === 0) {
      return { 
        synced: false, 
        message: 'No active subscription found in Stripe' 
      };
    }
    
    const sub = subscriptions.data[0];
    const renewsAt = new Date(sub.current_period_end * 1000).toISOString();
    const countersRef = userRef.collection('meta').doc('counters');
    const countersSnap = await countersRef.get();
    const countersData = countersSnap.exists ? (countersSnap.data() || {}) : {};
    const previousPeriodEnd = typeof countersData.usage_period_end === 'string' ? countersData.usage_period_end : null;
    const prevMs = previousPeriodEnd ? new Date(previousPeriodEnd).getTime() : NaN;
    const nextMs = new Date(renewsAt).getTime();
    const shouldResetCounters = !isNaN(nextMs) && (!previousPeriodEnd || isNaN(prevMs) || nextMs > prevMs);
    
    // Update user document with renews_at
    await userRef.set({
      renews_at: renewsAt
    }, { merge: true });
    
    // Also sync counters and reset when a new period is detected
    if (shouldResetCounters) {
      await countersRef.set({
        uses_this_month: 0,
        extra_uses_used: 0,
        usage_period_end: renewsAt
      }, { merge: true });
    } else {
      await countersRef.set({
        usage_period_end: renewsAt
      }, { merge: true });
    }
    
    console.log(`Synced renews_at for user ${uid}: ${renewsAt}`);
    
    return {
      synced: true,
      message: `Renewal date synced: ${new Date(renewsAt).toLocaleDateString()}`,
      renewsAt,
      subscriptionId: sub.id
    };
    
  } catch (e) {
    console.error('Failed to sync renews_at:', e);
    throw new functions.https.HttpsError('internal', e?.message || 'Failed to sync renewal date');
  }
});

// Sync full plan from Stripe subscription (callable replacement for REST /billing/force-sync)
export const syncPlanFromStripe = functions
  .https.onCall(async (data, context) => {
  const uid = context?.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  
  try {
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    
    if (!userSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'User not found');
    }
    
    const userData = userSnap.data() || {};
    const customerId = userData.stripe_customer_id;
    
    if (!customerId) {
      // No Stripe customer - ensure user is on free plan
      const currentPlan = String(userData.plan || 'free').toLowerCase();
      if (currentPlan !== 'free') {
        await userRef.set({ ...PLAN_CONFIG.FREE, renews_at: null, subscription_cancelled: false }, { merge: true });
        return { success: true, plan: 'free', message: 'No Stripe customer found. Plan set to free.' };
      }
      return { success: true, plan: 'free', message: 'No Stripe customer ID found. Already on free plan.' };
    }
    
    // Get active subscriptions from Stripe
    const subscriptions = await getStripe().subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 10
    });
    
    if (subscriptions.data.length === 0) {
      // Check for canceled subscriptions that might still have time remaining
      const canceledSubs = await getStripe().subscriptions.list({
        customer: customerId,
        status: 'canceled',
        limit: 1
      });
      
      if (canceledSubs.data.length > 0) {
        const sub = canceledSubs.data[0];
        const periodEndMs = sub.current_period_end ? sub.current_period_end * 1000 : 0;
        if (periodEndMs > Date.now()) {
          // Still has paid time remaining
          const priceId = sub.items?.data?.[0]?.price?.id;
          const applied = mapPlanByPriceId(priceId) || PLAN_CONFIG.FREE;
          const renewsAt = new Date(periodEndMs).toISOString();
          await userRef.set({ ...applied, renews_at: renewsAt, subscription_cancelled: true }, { merge: true });
          return { success: true, plan: applied.plan, message: `Subscription cancelled but active until ${new Date(renewsAt).toLocaleDateString()}` };
        }
      }
      
      // No active subscription - downgrade to free
      await userRef.set({ ...PLAN_CONFIG.FREE, renews_at: null, subscription_cancelled: false }, { merge: true });
      const countersRef = userRef.collection('meta').doc('counters');
      await countersRef.set({ usage_period_end: null }, { merge: true });
      return { success: true, plan: 'free', message: 'No active subscription found. Plan set to free.' };
    }
    
    // Process active subscription
    const sub = subscriptions.data[0];
    const priceId = sub.items?.data?.[0]?.price?.id;
    let applied = mapPlanByPriceId(priceId);
    
    // Fallback: check price metadata
    if (!applied) {
      const priceMetadata = sub.items?.data?.[0]?.price?.metadata || {};
      const role = String(priceMetadata.role || priceMetadata.plan || '').toLowerCase();
      if (role === 'basic') applied = PLAN_CONFIG.BASIC;
      else if (role === 'advanced') applied = PLAN_CONFIG.ADVANCED;
      else if (role === 'pro') applied = PLAN_CONFIG.PRO;
    }
    
    // Fallback: check product name
    if (!applied) {
      try {
        const price = await getStripe().prices.retrieve(priceId, { expand: ['product'] });
        const productName = typeof price.product === 'object' ? price.product?.name?.toLowerCase() : '';
        if (productName.includes('basic')) applied = PLAN_CONFIG.BASIC;
        else if (productName.includes('advanced')) applied = PLAN_CONFIG.ADVANCED;
        else if (productName.includes('pro')) applied = PLAN_CONFIG.PRO;
      } catch {}
    }
    
    if (!applied) {
      return { success: false, error: 'Could not determine plan from subscription' };
    }
    
    const renewsAt = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
    const isCancelledButActive = Boolean(sub.cancel_at_period_end);
    
    // Check if we need to reset counters (new billing period)
    const countersRef = userRef.collection('meta').doc('counters');
    const countersSnap = await countersRef.get();
    const countersData = countersSnap.exists ? (countersSnap.data() || {}) : {};
    const previousPeriodEnd = typeof countersData.usage_period_end === 'string' ? countersData.usage_period_end : null;
    const prevMs = previousPeriodEnd ? new Date(previousPeriodEnd).getTime() : NaN;
    const nextMs = renewsAt ? new Date(renewsAt).getTime() : NaN;
    const shouldResetCounters = !isNaN(nextMs) && (!previousPeriodEnd || isNaN(prevMs) || nextMs > prevMs);
    
    // Update user document
    await userRef.set({ ...applied, renews_at: renewsAt, subscription_cancelled: isCancelledButActive }, { merge: true });
    
    // Update counters
    if (shouldResetCounters) {
      await countersRef.set({
        uses_this_month: 0,
        extra_uses_used: 0,
        usage_period_end: renewsAt
      }, { merge: true });
      console.log(`[syncPlanFromStripe] Reset counters for uid=${uid}, new period ends: ${renewsAt}`);
    } else {
      await countersRef.set({ usage_period_end: renewsAt }, { merge: true });
    }
    
    // Set custom claims
    try {
      await getAuth().setCustomUserClaims(uid, { stripeRole: applied.plan });
    } catch (e) {
      console.error('[syncPlanFromStripe] Failed to set claims:', e?.message);
    }
    
    console.log(`[syncPlanFromStripe] Synced plan for uid=${uid}: ${applied.plan}`);
    return { 
      success: true, 
      plan: applied.plan, 
      message: `Plan synced: ${applied.plan.toUpperCase()}${isCancelledButActive ? ' (cancels at period end)' : ''}`,
      renewsAt,
      countersReset: shouldResetCounters
    };
    
  } catch (e) {
    console.error('[syncPlanFromStripe] Error:', e);
    throw new functions.https.HttpsError('internal', e?.message || 'Failed to sync plan');
  }
});
