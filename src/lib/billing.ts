import { auth, db, functions } from "../../firebase";
import { addDoc, collection, doc, onSnapshot, setDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { API_BASE, getAuthHeaders } from "@/lib/api-utils";

const API = API_BASE;
const USE_EXT = (() => {
  const v = import.meta.env.VITE_USE_STRIPE_EXTENSION;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes' || s === 'y';
  }
  return false;
})();

const BILLING_MODE = USE_EXT ? 'stripe-extension' : 'custom-api';

export async function createCheckoutSession(priceId: string, uid: string) {
  // Diagnostics: which path are we taking?
  try { console.info(`[billing] createCheckoutSession mode=${BILLING_MODE}`); } catch {}
  if (USE_EXT) {
    return startExtensionCheckout(priceId, uid, { mode: 'subscription' });
  }
  const resp = await fetch(`${API}/billing/create-checkout-session`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ priceId, uid })
  });
  const data = await resp.json();
  if (!resp.ok || data.error) throw new Error(data.error || 'Failed to start checkout');
  if (data.portal_url) {
    window.location.href = data.portal_url;
    return data;
  }
  if (data.url) {
    // Add cache-busting to ensure fresh load with all payment methods
    const url = new URL(data.url);
    url.searchParams.set('_t', Date.now().toString());
    window.location.href = url.toString();
  }
  return data;
}

export async function createPortalSession(customerId: string) {
  try { console.info(`[billing] createPortalSession mode=${BILLING_MODE}`); } catch {}
  if (USE_EXT) {
    const callable = httpsCallable(functions, 'ext-firestore-stripe-payments-createPortalLink');
    const { data } = await callable({ returnUrl: window.location.origin + '/account', locale: 'auto' } as any);
    const url = (data as any)?.url;
    return { url };
  }
  const resp = await fetch(`${API}/billing/create-portal-session`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ customerId })
  });
  const data = await resp.json();
  if (!resp.ok || data.error) throw new Error(data.error || 'Failed to open billing portal');
  return data;
}

export async function createAddonSession(priceId: string, uid: string) {
  try { console.info(`[billing] createAddonSession mode=${BILLING_MODE}`); } catch {}
  if (USE_EXT) {
    return startExtensionCheckout(priceId, uid, { mode: 'payment' });
  }
  const resp = await fetch(`${API}/billing/create-addon-session`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ priceId, uid })
  });
  const data = await resp.json();
  if (!resp.ok || data.error) throw new Error(data.error || 'Failed to start add-on checkout');
  if (data.url) {
    // Add cache-busting to ensure fresh load with all payment methods
    const url = new URL(data.url);
    url.searchParams.set('_t', Date.now().toString());
    window.location.href = url.toString();
  }
  return data;
}

export async function syncCheckoutSession(sessionId: string) {
  const resp = await fetch(`${API}/billing/sync-session`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ sessionId })
  });
  const data = await resp.json();
  if (!resp.ok || data.error) throw new Error(data.error || 'Failed to sync session');
  return data;
}

// Firebase Extension checkout: create a doc under customers/{uid}/checkout_sessions
// and redirect when URL arrives via snapshot listener.
async function startExtensionCheckout(priceId: string, uid: string, opts: { mode: 'subscription' | 'payment' }) {
  const user = auth.currentUser;
  if (!user || user.uid !== uid) throw new Error('User not authenticated');
  // Ensure parent customers/{uid} doc exists with email so the extension can create/link a Stripe customer
  try {
    const parentRef = doc(db, 'customers', uid);
    await setDoc(parentRef, { email: user.email || null }, { merge: true });
  } catch {}
  const ref = collection(db, 'customers', uid, 'checkout_sessions');
  const docRef = await addDoc(ref, {
    price: priceId,
    mode: opts.mode === 'payment' ? 'payment' : 'subscription',
    // Help the extension create/link a Stripe customer if one doesn't exist yet
    customer_email: user.email || undefined,
    client_reference_id: uid,
    allow_promotion_codes: true,
    success_url: window.location.origin + '/checkout/success',
    cancel_url: window.location.origin + '/checkout/cancel',
  } as any);
  return new Promise((resolve, reject) => {
    const unsub = onSnapshot(docRef, (snap) => {
      const d: any = snap.data();
      if (!d) return;
      if (d.error) {
        unsub();
        const msg = d.error.message || d.error.toString?.() || 'Checkout error';
        console.error('[billing] extension checkout error:', d.error);
        reject(new Error(msg));
      }
      if (d.url) {
        unsub();
        window.location.assign(d.url);
        resolve({ url: d.url });
      }
    }, (err) => {
      console.error('[billing] checkout session snapshot error:', err);
      reject(err);
    });
  });
}
