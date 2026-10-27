// ================================================================
// Account routes + health check.
// Extracted from server.js - register() mounts them on the shared app.
// ================================================================
import { requireAuth, enforceWordLimit, reserveUsage, getWordLimit } from './shared.js';
import { getAuth } from 'firebase-admin/auth';
import { deleteAccountData } from '../privacy.js';

export function register(app) {
  app.post('/usage/consume', requireAuth, async (req, res) => {
    try {
      const words = req.body?.inputWords;
      if (words !== undefined && (!Number.isFinite(words) || words < 0)) {
        return res.status(400).json({ error: 'Invalid word count' });
      }
      const limit = await getWordLimit(req.authUid);
      if (words > limit) return res.status(400).json({ error: `Input too long. Max ${limit} words for your plan.` });
      const result = await reserveUsage(req.authUid);
      if (!result.allowed) return res.status(403).json({ error: result.error });
      const { consumed, ...usage } = result;
      res.json(usage);
    } catch (e) {
      console.error('[usage/consume]', e);
      res.status(503).json({ error: 'Could not record usage. Please try again.' });
    }
  });
  // Account: Delete account (secure) -> verifies Firebase ID token and deletes Stripe customer, Firestore docs, and Auth user
  app.post('/account/delete', requireAuth, enforceWordLimit, async (req, res) => {
    try {
      const authz = req.headers.authorization || '';
      const m = authz.match(/^Bearer\s+(.+)/i);
      if (!m) return res.status(401).json({ error: 'Missing Authorization' });
      const idToken = m[1];
      let decoded;
      try { decoded = await getAuth().verifyIdToken(idToken); } catch { return res.status(401).json({ error: 'Invalid token' }); }
      const tokenUid = decoded.uid;
      const { uid } = req.body ?? {};
      if (!uid || uid !== tokenUid) return res.status(403).json({ error: 'Forbidden' });

      // Run the same full cleanup as the deleteAccountFull callable: demo
      // guard, subscription cancels, Storage files, social-graph cleanup,
      // Firestore trees, and the Auth user.
      try {
        const result = await deleteAccountData(uid);
        return res.json({ ok: true, verified: result?.verified });
      } catch (e) {
        const msg = e?.message || '';
        if (/demo account/i.test(msg)) return res.status(403).json({ error: msg });
        throw e;
      }
    } catch (e) {
      res.status(500).json({ error: e?.message || 'Failed to delete account' });
    }
  });

  // Health
  app.get('/health', (_req, res) => res.json({ ok: true }));
}
