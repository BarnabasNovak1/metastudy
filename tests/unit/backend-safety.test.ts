import { createRequire } from 'node:module';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimWebhookEvent, finishWebhookEvent, creditAddonSession } from '../../functions/lib/billing-safety.js';
import { reserveUserUsage, refundUserUsage } from '../../functions/lib/usage.js';
import { parseStorageSource, validateStorageSource } from '../../functions/lib/storage-source.js';
import { register as registerBilling } from '../../functions/routes/billing.js';

const billingMocks = vi.hoisted(() => ({
  retrieve: vi.fn(),
  create: vi.fn(),
}));
vi.mock('../../functions/routes/shared.js', () => ({
  requireAuth: vi.fn(),
  enforceWordLimit: vi.fn(),
  getStripeCustomerId: vi.fn(),
  db: {},
  fdb: {},
  stripe: { checkout: { sessions: { retrieve: billingMocks.retrieve, create: billingMocks.create } } },
  PRICE_MAP: { BASIC: 'price_basic', ADVANCED: 'price_advanced', PRO: 'price_pro', ADDON_10: 'price_addon' },
  PLAN_CONFIG: { BASIC: { plan: 'basic' }, ADVANCED: { plan: 'advanced' }, PRO: { plan: 'pro' } },
}));

describe('billing route authorization', () => {
  const routes = new Map<string, (req: any, res: any) => Promise<unknown>>();
  registerBilling({ post: (path: string, ...handlers: any[]) => routes.set(path, handlers[handlers.length - 1]) });
  const response = () => {
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    return res;
  };

  beforeEach(() => {
    billingMocks.retrieve.mockReset();
    billingMocks.create.mockReset();
  });

  it('never reveals another account checkout details', async () => {
    billingMocks.retrieve.mockResolvedValue({ client_reference_id: 'bob', status: 'complete', mode: 'subscription', customer: 'cus_bob' });
    const res = response();
    await routes.get('/billing/sync-session')!({ authUid: 'alice', body: { sessionId: 'cs_bob', uid: 'bob' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Session does not belong to this account' });
  });

  it('reports an owned checkout without granting an unpaid add-on', async () => {
    billingMocks.retrieve.mockResolvedValue({
      client_reference_id: 'alice', status: 'complete', mode: 'payment', payment_status: 'unpaid',
      line_items: { data: [{ price: { id: 'price_addon' }, quantity: 1 }] },
    });
    const res = response();
    await routes.get('/billing/sync-session')!({ authUid: 'alice', body: { sessionId: 'cs_owned' } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'addon', add_uses: 0, payment_status: 'unpaid' }));
  });

  it.each([
    ['/billing/create-checkout-session', 'price_addon'],
    ['/billing/create-addon-session', 'price_basic'],
    ['/billing/create-addon-session', 'price_internal'],
  ])('rejects a price from the wrong allowlist at %s', async (path, priceId) => {
    const res = response();
    await routes.get(path)!({ authUid: 'alice', body: { priceId } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(billingMocks.create).not.toHaveBeenCalled();
  });
});

describe('Storage source validation', () => {
  it.each([
    'https://evil.example/own.appspot.com/users/alice/audio.mp3',
    'https://firebasestorage.googleapis.com.evil.example/v0/b/own.appspot.com/o/users%2Falice%2Fa.mp3',
    'http://storage.googleapis.com/own.appspot.com/users/alice/a.mp3',
    'https://user:pass@storage.googleapis.com/own.appspot.com/users/alice/a.mp3',
  ])('rejects an untrusted URL: %s', (url) => {
    expect(() => parseStorageSource('', url)).toThrow();
  });

  it('accepts documented URLs and checks the bucket and owner independently', () => {
    const source = parseStorageSource('', 'https://firebasestorage.googleapis.com/v0/b/own.appspot.com/o/users%2Falice%2Fa.mp3?alt=media');
    expect(source).toEqual({ bucketName: 'own.appspot.com', objectPath: 'users/alice/a.mp3' });
    const allowed = new Set(['own.appspot.com']);
    expect(validateStorageSource(source.bucketName, source.objectPath, 'alice', allowed)).toBeNull();
    expect(validateStorageSource(source.bucketName, source.objectPath, 'bob', allowed)).toBeTruthy();
    expect(validateStorageSource('other.appspot.com', source.objectPath, 'alice', allowed)).toBeTruthy();
    expect(() => parseStorageSource('gs://own.appspot.com', '')).toThrow();
    expect(parseStorageSource('gs://own.appspot.com/users/alice/a.mp3', '')).toEqual(source);
  });
});

// Real Firestore transactions exercise retries/locking rather than a mock that
// assumes serialization. The demo project cannot access production resources.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('billing and usage transactions', { timeout: 30000 }, () => {
  const requireBackend = createRequire(new URL('../../functions/package.json', import.meta.url));
  const { initializeApp, deleteApp } = requireBackend('firebase-admin/app');
  const { getFirestore } = requireBackend('firebase-admin/firestore');
  let app: any;
  let db: any;
  const uid = 'alice';
  const futurePeriod = '2099-01-01T00:00:00.000Z';
  const session = { id: 'cs_test', mode: 'payment', payment_status: 'paid' };
  const stripe = { checkout: { sessions: { listLineItems: vi.fn() } } };
  const countersPath = `users/${uid}/meta/counters`;
  const read = async (path: string) => (await db.doc(path).get()).data();

  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-metastudy-billing' }, 'billing-tests');
    db = getFirestore(app);
  });
  beforeEach(async () => {
    for (const collection of ['users', 'webhook_events', 'billing_purchases']) {
      await db.recursiveDelete(db.collection(collection));
    }
    await db.doc(`users/${uid}`).set({ plan: 'basic', monthly_quota: 1 });
    await db.doc(countersPath).set({ uses_this_month: 0, extra_uses_balance: 0, usage_period_end: futurePeriod });
    stripe.checkout.sessions.listLineItems.mockReset().mockResolvedValue({
      has_more: false, data: [{ price: { id: 'price_addon' }, quantity: 1 }],
    });
  });
  afterAll(async () => { if (app) await deleteApp(app); });

  it('keeps completed events deduplicated beyond ten minutes', async () => {
    const event = { id: 'evt_once', type: 'checkout.session.completed' };
    const claim = await claimWebhookEvent(db, event, 1000);
    await finishWebhookEvent(db, claim, true);
    expect((await claimWebhookEvent(db, event, 1000 + 86400000)).state).toBe('completed');
  });

  it('retries unfinished events and fences out expired workers', async () => {
    const event = { id: 'evt_retry', type: 'checkout.session.completed' };
    const first = await claimWebhookEvent(db, event, 1000);
    expect((await claimWebhookEvent(db, event, 2000)).state).toBe('busy');
    const next = await claimWebhookEvent(db, event, 1000 + 600001);
    expect(next.state).toBe('claimed');
    await finishWebhookEvent(db, first, false);
    expect((await read('webhook_events/evt_retry')).token).toBe(next.token);
    await finishWebhookEvent(db, next, false);
    expect((await claimWebhookEvent(db, event, 1000 + 600002)).state).toBe('claimed');
  });

  it('credits one purchase once across concurrent and later deliveries', async () => {
    await Promise.all(Array.from({ length: 4 }, () => creditAddonSession(db, stripe, session, uid, 'price_addon')));
    await reserveUserUsage(db, uid); // monthly
    await reserveUserUsage(db, uid); // add-on
    await creditAddonSession(db, stripe, session, uid, 'price_addon');
    expect((await read(countersPath)).extra_uses_balance).toBe(9);
    expect((await read('billing_purchases/cs_test')).uses).toBe(10);
  });

  it('does not credit unpaid, unknown-price or failed Stripe lookups', async () => {
    await creditAddonSession(db, stripe, { ...session, payment_status: 'unpaid' }, uid, 'price_addon');
    await creditAddonSession(db, stripe, session, uid, 'price_other');
    stripe.checkout.sessions.listLineItems.mockRejectedValueOnce(new Error('Stripe unavailable'));
    await expect(creditAddonSession(db, stripe, session, uid, 'price_addon')).rejects.toThrow('Stripe unavailable');
    await expect(creditAddonSession(db, stripe, session, uid, '')).rejects.toThrow('not configured');
    expect((await read(countersPath)).extra_uses_balance).toBe(0);
    expect(await read('billing_purchases/cs_test')).toBeUndefined();
  });

  it('uses purchased quantity and never recreates a deleted account', async () => {
    stripe.checkout.sessions.listLineItems.mockResolvedValue({
      has_more: false, data: [{ price: { id: 'price_addon' }, quantity: 3 }],
    });
    await creditAddonSession(db, stripe, session, uid, 'price_addon');
    expect((await read(countersPath)).extra_uses_balance).toBe(30);
    await db.doc(`users/${uid}`).delete();
    await expect(creditAddonSession(db, stripe, { ...session, id: 'cs_deleted' }, uid, 'price_addon')).rejects.toThrow('no longer exists');
  });

  it('allows only the remaining monthly/add-on slots during a burst', async () => {
    await db.doc(countersPath).update({ extra_uses_balance: 1 });
    const results = await Promise.all(Array.from({ length: 6 }, () => reserveUserUsage(db, uid)));
    expect(results.filter((r) => r.allowed)).toHaveLength(2);
    expect(await read(countersPath)).toMatchObject({ uses_this_month: 1, extra_uses_balance: 0, extra_uses_used: 1 });
  });

  it('blocks zero-quota and unavailable accounts', async () => {
    await db.doc(`users/${uid}`).update({ monthly_quota: 0 });
    expect((await reserveUserUsage(db, uid)).allowed).toBe(false);
    await expect(reserveUserUsage(null, uid)).rejects.toThrow('unavailable');
    await expect(reserveUserUsage(db, 'missing')).rejects.toThrow('not ready');
  });

  it('refunds failed AI calls without reducing a new period counter', async () => {
    const first = await reserveUserUsage(db, uid);
    await refundUserUsage(db, uid, first.consumed);
    expect((await read(countersPath)).uses_this_month).toBe(0);
    const second = await reserveUserUsage(db, uid);
    await db.doc(countersPath).update({ usage_period_end: '2099-02-01T00:00:00.000Z', uses_this_month: 5 });
    await refundUserUsage(db, uid, second.consumed);
    expect((await read(countersPath)).uses_this_month).toBe(5);
  });
});
