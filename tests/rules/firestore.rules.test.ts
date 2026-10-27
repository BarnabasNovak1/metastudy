// Firestore security rules tests. These run against the Firestore emulator -
// locally: `npm run test:rules` (spins up the emulator via firebase CLI), or set
// FIRESTORE_EMULATOR_HOST yourself. Without the emulator the suite is skipped.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';

const EMULATOR_AVAILABLE = !!process.env.FIRESTORE_EMULATOR_HOST;
const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8');

describe.skipIf(!EMULATOR_AVAILABLE)('firestore.rules', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-metastudy',
      firestore: { rules },
    });
  });

  afterAll(async () => {
    await testEnv?.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    // Seed data with rules disabled (clients can never create these directly)
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'users', 'alice'), { first_name: 'Alice', plan: 'free' });
      await setDoc(doc(db, 'users', 'bob'), { first_name: 'Bob', plan: 'pro' });
      await setDoc(doc(db, 'public_profiles', 'alice'), { username: 'alice', xp: 10 });
      await setDoc(doc(db, 'users', 'alice', 'quizzes', 'private-quiz'), { title: 'secret', shared: false });
      await setDoc(doc(db, 'users', 'alice', 'quizzes', 'shared-quiz'), { title: 'public', shared: true });
      await setDoc(doc(db, 'users', 'alice', 'chat_sessions', 'c1'), { title: 'chat' });
    });
  });

  describe('private-by-default user data', () => {
    it('owner can read their own profile doc', async () => {
      const alice = testEnv.authenticatedContext('alice').firestore();
      await assertSucceeds(getDoc(doc(alice, 'users', 'alice')));
    });

    it('other users cannot read a private profile doc', async () => {
      const bob = testEnv.authenticatedContext('bob').firestore();
      await assertFails(getDoc(doc(bob, 'users', 'alice')));
    });

    it('unauthenticated users cannot read profile docs', async () => {
      const anon = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(anon, 'users', 'alice')));
    });

    it('chat subcollections are owner-only', async () => {
      const alice = testEnv.authenticatedContext('alice').firestore();
      const bob = testEnv.authenticatedContext('bob').firestore();
      await assertSucceeds(getDoc(doc(alice, 'users', 'alice', 'chat_sessions', 'c1')));
      await assertFails(getDoc(doc(bob, 'users', 'alice', 'chat_sessions', 'c1')));
    });

    it('non-shared quizzes are owner-only', async () => {
      const bob = testEnv.authenticatedContext('bob').firestore();
      await assertFails(getDoc(doc(bob, 'users', 'alice', 'quizzes', 'private-quiz')));
    });

    it('shared quizzes are readable by other signed-in users', async () => {
      const bob = testEnv.authenticatedContext('bob').firestore();
      await assertSucceeds(getDoc(doc(bob, 'users', 'alice', 'quizzes', 'shared-quiz')));
    });

    it('non-owner cannot write to another user\'s content', async () => {
      const bob = testEnv.authenticatedContext('bob').firestore();
      await assertFails(
        setDoc(doc(bob, 'users', 'alice', 'quizzes', 'evil'), { title: 'x' })
      );
    });
  });

  describe('public_profiles mirror', () => {
    it('any signed-in user can read public profiles', async () => {
      const bob = testEnv.authenticatedContext('bob').firestore();
      await assertSucceeds(getDoc(doc(bob, 'public_profiles', 'alice')));
    });

    it('clients can never write public_profiles (server-maintained)', async () => {
      const alice = testEnv.authenticatedContext('alice').firestore();
      await assertFails(
        setDoc(doc(alice, 'public_profiles', 'alice'), { username: 'hacked' })
      );
    });
  });

  describe('profile field restrictions', () => {
    it('recursive owner rules cannot create or delete the root profile', async () => {
      const alice = testEnv.authenticatedContext('alice').firestore();
      const fresh = testEnv.authenticatedContext('fresh').firestore();
      await assertFails(deleteDoc(doc(alice, 'users', 'alice')));
      await assertFails(setDoc(doc(fresh, 'users', 'fresh'), { plan: 'pro' }));
    });

    it('owners cannot forge, reset, or delete billing counters', async () => {
      const alice = testEnv.authenticatedContext('alice').firestore();
      const ref = doc(alice, 'users', 'alice', 'meta', 'counters');
      await assertFails(setDoc(ref, { extra_uses_balance: 1000 }));
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'users', 'alice', 'meta', 'counters'), { uses_this_month: 5, extra_uses_balance: 0 });
      });
      await assertFails(setDoc(ref, { uses_this_month: 0 }, { merge: true }));
      await assertFails(setDoc(ref, { xp: 1 })); // replacement cannot erase quota fields
      await assertFails(deleteDoc(ref));
      await assertSucceeds(setDoc(ref, { xp: 1, quizzes: 1 }, { merge: true }));
      await assertFails(setDoc(doc(alice, 'users', 'alice', 'meta', 'daily_usage'), { ai_calls: 0 }));
    });

    it('checkout clients cannot start extension sessions or forge completion', async () => {
      const alice = testEnv.authenticatedContext('alice').firestore();
      const ref = doc(alice, 'customers', 'alice', 'checkout_sessions', 'request');
      const request = { price: 'price_test', mode: 'payment', client_reference_id: 'alice', success_url: 'https://metastudy-e1ba2.web.app/checkout/success', cancel_url: 'https://metastudy-e1ba2.web.app/checkout/cancel' };
      await assertFails(setDoc(ref, request));
      await assertFails(setDoc(doc(alice, 'customers', 'alice', 'checkout_sessions', 'fake'), { ...request, status: 'complete' }));
      await assertFails(setDoc(doc(alice, 'billing_purchases', 'cs_fake'), { uid: 'alice' }));
      await assertFails(setDoc(doc(alice, 'webhook_events', 'evt_fake'), { status: 'completed' }));
    });

    it('owner can update safe profile fields', async () => {
      const alice = testEnv.authenticatedContext('alice').firestore();
      await assertSucceeds(
        setDoc(doc(alice, 'users', 'alice'), { bio: 'new bio' }, { merge: true })
      );
    });

    it('owner cannot self-escalate plan or quota fields', async () => {
      const alice = testEnv.authenticatedContext('alice').firestore();
      await assertFails(
        setDoc(doc(alice, 'users', 'alice'), { plan: 'pro' }, { merge: true })
      );
      await assertFails(
        setDoc(doc(alice, 'users', 'alice'), { monthly_quota: 999999 }, { merge: true })
      );
    });

    it('owner cannot set an invalid chat_retention_days', async () => {
      const alice = testEnv.authenticatedContext('alice').firestore();
      await assertFails(
        setDoc(doc(alice, 'users', 'alice'), { chat_retention_days: 7 }, { merge: true })
      );
      await assertSucceeds(
        setDoc(doc(alice, 'users', 'alice'), { chat_retention_days: 30 }, { merge: true })
      );
    });
  });

  describe('feed posts', () => {
    it('users can only create posts as themselves', async () => {
      const bob = testEnv.authenticatedContext('bob').firestore();
      await assertSucceeds(
        setDoc(doc(bob, 'feed_posts', 'p1'), { ownerId: 'bob', text: 'hi' })
      );
      await assertFails(
        setDoc(doc(bob, 'feed_posts', 'p2'), { ownerId: 'alice', text: 'fake' })
      );
    });
  });

  describe('role-based access', () => {
    it('admin role claim can read any user doc and moderation queues', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'support_reports', 'r1'), { issue: 'x' });
      });
      const adminDb = testEnv.authenticatedContext('ops', { role: 'admin' }).firestore();
      await assertSucceeds(getDoc(doc(adminDb, 'users', 'alice')));
      await assertSucceeds(getDoc(doc(adminDb, 'support_reports', 'r1')));
    });

    it('regular users cannot read moderation queues', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'support_reports', 'r1'), { issue: 'x' });
      });
      const bob = testEnv.authenticatedContext('bob').firestore();
      await assertFails(getDoc(doc(bob, 'support_reports', 'r1')));
    });
  });
});
