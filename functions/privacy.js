import { functions, db, getStripe, SUPPORT_REPORT_METRICS_REF, getReportCategory, Stripe } from './lib/shared.js';
import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';


// Core deletion routine shared by the deleteAccountFull callable and the
// /account/delete REST route so both paths perform identical cleanup.
// Throws an HttpsError('permission-denied') for demo accounts.
export async function deleteAccountData(uid) {
  const firestore = getFirestore();
  const bucket = getStorage().bucket();
  const userRef = db.collection('users').doc(uid);
  const customerRef = db.collection('customers').doc(uid);

  // Read institution membership before wiping the profile so we can decrement
  // the institution's user count after deletion.
  let institutionId = '';
  let wasVerifiedInstitution = false;
  try {
    const usnap = await userRef.get();
    const ud = usnap.exists ? (usnap.data() || {}) : {};
    institutionId = String(ud.institutionId || '');
    wasVerifiedInstitution = !!ud.verifiedInstitution;
  } catch {}

  async function deleteDocRefs(docRefs, chunkSize = 400) {
    if (!Array.isArray(docRefs) || docRefs.length === 0) return 0;
    let deleted = 0;
    for (let i = 0; i < docRefs.length; i += chunkSize) {
      const batch = db.batch();
      const chunk = docRefs.slice(i, i + chunkSize);
      chunk.forEach((ref) => batch.delete(ref));
      await batch.commit();
      deleted += chunk.length;
    }
    return deleted;
  }

  async function recursiveDeleteDoc(docRef) {
    try {
      await firestore.recursiveDelete(docRef);
      return;
    } catch (e) {
      console.log(`[deleteAccountFull] recursiveDelete fallback for ${docRef.path}:`, e?.message || e);
    }

    const subcols = await docRef.listCollections();
    for (const subcol of subcols) {
      while (true) {
        const snap = await subcol.limit(200).get();
        if (snap.empty) break;
        for (const d of snap.docs) {
          await recursiveDeleteDoc(d.ref);
        }
        await deleteDocRefs(snap.docs.map((d) => d.ref));
      }
    }
    await docRef.delete();
  }

  async function deleteMatchingDocs(queryFactory, label) {
    let deleted = 0;
    while (true) {
      const snap = await queryFactory().limit(400).get();
      if (snap.empty) break;
      deleted += await deleteDocRefs(snap.docs.map((d) => d.ref));
      if (snap.size < 400) break;
    }
    if (deleted > 0) console.log(`[deleteAccountFull] Deleted ${deleted} docs for ${label}`);
    return deleted;
  }

  async function deleteMatchingDocsRecursively(queryFactory, label) {
    let deleted = 0;
    while (true) {
      const snap = await queryFactory().limit(100).get();
      if (snap.empty) break;
      for (const docSnap of snap.docs) {
        await recursiveDeleteDoc(docSnap.ref);
        deleted += 1;
      }
      if (snap.size < 100) break;
    }
    if (deleted > 0) console.log(`[deleteAccountFull] Recursively deleted ${deleted} docs for ${label}`);
    return deleted;
  }

  // Collection-group documentId filters require a full document path. A bare
  // UID does not match nested docs; scan in bounded pages for legacy ID-only rows.
  async function deleteGroupDocsById(collectionName) {
    let cursor = null;
    while (true) {
      let query = db.collectionGroup(collectionName).orderBy(FieldPath.documentId()).limit(400);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      if (page.empty) break;
      await deleteDocRefs(page.docs.filter((doc) => doc.id === uid).map((doc) => doc.ref));
      cursor = page.docs[page.docs.length - 1];
    }
  }

  async function deleteStoragePrefix(prefix) {
    let pageToken = undefined;
    let deleted = 0;
    do {
      const [files, nextQuery] = await bucket.getFiles({
        prefix,
        maxResults: 500,
        autoPaginate: false,
        pageToken,
      });
      if (files.length > 0) {
        await Promise.all(files.map((f) => f.delete({ ignoreNotFound: true })));
        deleted += files.length;
      }
      pageToken = nextQuery?.pageToken;
    } while (pageToken);
    if (deleted > 0) console.log(`[deleteAccountFull] Deleted ${deleted} storage files under ${prefix}`);
  }

  const userSnap = await userRef.get();
  const userData = userSnap.exists ? (userSnap.data() || {}) : {};
  if (userData.isDemoUser) {
    throw new functions.https.HttpsError('permission-denied', 'Demo account cannot be deleted');
  }

  let customerId = String(userData.stripe_customer_id || '').trim();
  if (!customerId) {
    const cSnap = await customerRef.get();
    const cData = cSnap.exists ? (cSnap.data() || {}) : {};
    customerId = String(cData.stripeId || cData.customer_id || cData.customerId || cData.stripe_id || '').trim();
  }

  if (customerId) {
    try {
      const stripe = getStripe();
      const customer = await stripe.customers.retrieve(customerId);
      if (!customer.deleted) {
        for await (const sub of stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })) {
          if (!['canceled', 'incomplete_expired'].includes(sub.status)) await stripe.subscriptions.cancel(sub.id);
        }
        await stripe.customers.del(customerId);
      }
    } catch (e) {
      console.error(`[deleteAccountFull] Stripe cleanup failed for ${uid}:`, e?.message || e);
      if (e?.code !== 'resource_missing' || e?.param !== 'customer') throw e;
    }
  }

  // Avatars are already under this prefix. Never delete from a client-editable
  // photo URL: it could point to another user's file.
  await deleteStoragePrefix(`users/${uid}/`);

  const reportCategoryCounts = { systemic: 0, user_related: 0, general: 0 };
  try {
    const reportsSnap = await db.collection('support_reports').where('reporterUid', '==', uid).get();
    for (const d of reportsSnap.docs) {
      const row = d.data() || {};
      const status = String(row.status || '').toLowerCase();
      const category = String(row.category || getReportCategory(row.type));
      if (status === 'open' && Object.prototype.hasOwnProperty.call(reportCategoryCounts, category)) {
        reportCategoryCounts[category] += 1;
      }
    }
    await deleteDocRefs(reportsSnap.docs.map((d) => d.ref));
  } catch (e) {
    console.error('[deleteAccountFull] Failed deleting support reports:', e?.message || e);
    throw e;
  }

  const openReportDelta = reportCategoryCounts.systemic + reportCategoryCounts.user_related + reportCategoryCounts.general;
  if (openReportDelta > 0) {
    await SUPPORT_REPORT_METRICS_REF.set({
      totalOpen: FieldValue.increment(-openReportDelta),
      byCategory: {
        systemic: FieldValue.increment(-reportCategoryCounts.systemic),
        user_related: FieldValue.increment(-reportCategoryCounts.user_related),
        general: FieldValue.increment(-reportCategoryCounts.general),
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => null);
  }

  await Promise.all([
    deleteMatchingDocsRecursively(() => db.collection('feed_posts').where('ownerId', '==', uid), 'feed_posts ownerId'),
    deleteMatchingDocsRecursively(() => db.collection('groups').where('createdBy', '==', uid), 'groups createdBy'),
    deleteMatchingDocs(() => db.collectionGroup('comments').where('userId', '==', uid), 'comments userId'),
    deleteGroupDocsById('reactions'),
    deleteGroupDocsById('runs'),
    deleteGroupDocsById('emoji_reactions'),
    deleteMatchingDocs(() => db.collectionGroup('notifications').where('from', '==', uid), 'notifications from'),
    deleteMatchingDocs(() => db.collectionGroup('notifications').where('requestedBy', '==', uid), 'notifications requestedBy'),
    deleteMatchingDocs(() => db.collectionGroup('friend_requests').where('from', '==', uid), 'friend_requests from'),
    deleteMatchingDocs(() => db.collectionGroup('friend_requests').where('to', '==', uid), 'friend_requests to'),
    deleteGroupDocsById('friends'),
    deleteGroupDocsById('blocks'),
    deleteMatchingDocs(() => db.collection('usernames').where('uid', '==', uid), 'usernames uid'),
    deleteMatchingDocs(() => db.collection('moderation_logs').where('actorUid', '==', uid), 'moderation_logs actorUid'),
    deleteMatchingDocs(() => db.collection('moderation_logs').where('targetUid', '==', uid), 'moderation_logs targetUid'),
    deleteMatchingDocs(() => db.collection('moderation_logs').where('reporterUid', '==', uid), 'moderation_logs reporterUid'),
    deleteMatchingDocs(() => db.collection('role_invites').where('invitedBy', '==', uid), 'role_invites invitedBy'),
  ]);

  // Remove user from groups they joined as a member (but didn't create - those are already deleted above)
  try {
    const memberGroupsSnap = await db.collection('groups').where('members', 'array-contains', uid).get();
    if (!memberGroupsSnap.empty) {
      const chunkSize = 400;
      for (let i = 0; i < memberGroupsSnap.docs.length; i += chunkSize) {
        const batch = db.batch();
        memberGroupsSnap.docs.slice(i, i + chunkSize).forEach((groupDoc) => {
          batch.update(groupDoc.ref, {
            members: FieldValue.arrayRemove(uid),
            admins: FieldValue.arrayRemove(uid),
            [`memberUsernames.${uid}`]: FieldValue.delete(),
          });
        });
        await batch.commit();
      }
      console.log(`[deleteAccountFull] Removed uid=${uid} from ${memberGroupsSnap.size} groups`);
    }
  } catch (e) {
    console.error('[deleteAccountFull] Failed to clean groups membership:', e?.message || e);
    throw e;
  }

  await Promise.all([
    recursiveDeleteDoc(customerRef),
    recursiveDeleteDoc(userRef),
    db.collection('public_profiles').doc(uid).delete(),
  ]);

  try {
    await getAuth().deleteUser(uid);
  } catch (e) {
    if (e?.code !== 'auth/user-not-found') {
      console.error('[deleteAccountFull] Failed to delete auth user:', e?.message || e);
      throw e;
    }
  }

  // Decrement the institution's user count if this was a verified member
  if (institutionId && wasVerifiedInstitution) {
    try {
      await db.collection('institutions').doc(institutionId).update({
        currentUserCount: FieldValue.increment(-1),
      });
    } catch (e) {
      console.warn(`[deleteAccountFull] Could not decrement institution ${institutionId} count:`, e?.message || e);
    }
  }

  const [userCheck, customerCheck, postCheck, unameCheck] = await Promise.all([
    userRef.get(),
    customerRef.get(),
    db.collection('feed_posts').where('ownerId', '==', uid).limit(1).get(),
    db.collection('usernames').where('uid', '==', uid).limit(1).get(),
  ]);

  const verified = !userCheck?.exists && !customerCheck?.exists && !postCheck?.size && !unameCheck?.size;
  if (!verified) throw new functions.https.HttpsError('internal', 'Account cleanup is incomplete');
  console.log(`[deleteAccountFull] Completed for ${uid}. verified=${verified}`);

  return { ok: true, verified };
}

// Full account deletion: cancel Stripe, delete Storage, Firestore, and Auth user
export const deleteAccountFull = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onCall(async (data, context) => {
  // App Check optional - warn but proceed (allows deletion even if client doesn't pass token)
  if (!context?.app) {
    console.warn('[deleteAccountFull] Missing App Check token for uid:', context?.auth?.uid);
  }
  const uid = context?.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  return deleteAccountData(uid);
});

// PRIVACY: Delete all of the caller's chat sessions (including nested messages)
export const deleteAllChats = functions.https.onCall(async (data, context) => {
  const uid = context?.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  const firestore = getFirestore();
  const chatsCol = db.collection('users').doc(uid).collection('chat_sessions');
  let deleted = 0;
  while (true) {
    const snap = await chatsCol.limit(100).get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      await firestore.recursiveDelete(d.ref);
      deleted += 1;
    }
    if (snap.size < 100) break;
  }
  console.log(`[deleteAllChats] Deleted ${deleted} chat sessions for ${uid}`);
  return { ok: true, deleted };
});

// PRIVACY: Export all of the caller's data as JSON (GDPR/state-law data portability)
export const exportMyData = functions
  .runWith({ timeoutSeconds: 300, memory: '1GB' })
  .https.onCall(async (data, context) => {
    const uid = context?.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');

    const MAX_DOCS_PER_COLLECTION = 2000;

    // Serialize Firestore values (Timestamps -> ISO strings)
    function serialize(value) {
      if (value === null || value === undefined) return value;
      if (typeof value?.toDate === 'function') return value.toDate().toISOString();
      if (Array.isArray(value)) return value.map(serialize);
      if (typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) out[k] = serialize(v);
        return out;
      }
      return value;
    }

    async function exportDoc(docRef, depth = 0) {
      const result = {};
      const snap = await docRef.get();
      if (snap.exists) result._data = serialize(snap.data());
      if (depth >= 3) return result;
      const subcols = await docRef.listCollections();
      for (const col of subcols) {
        const colSnap = await col.limit(MAX_DOCS_PER_COLLECTION).get();
        const docs = {};
        for (const d of colSnap.docs) {
          // Only recurse into subcollections for shallow depths to bound cost
          if (depth < 2) {
            const nested = await exportDoc(d.ref, depth + 1);
            docs[d.id] = nested;
          } else {
            docs[d.id] = { _data: serialize(d.data()) };
          }
        }
        result[col.id] = docs;
      }
      return result;
    }

    const userExport = await exportDoc(db.collection('users').doc(uid));

    // Include the user's feed posts
    const posts = {};
    try {
      const postsSnap = await db.collection('feed_posts').where('ownerId', '==', uid).limit(500).get();
      for (const d of postsSnap.docs) posts[d.id] = serialize(d.data());
    } catch {}

    console.log(`[exportMyData] Export generated for ${uid}`);
    return {
      exportedAt: new Date().toISOString(),
      uid,
      account: userExport,
      feed_posts: posts,
    };
  });

// PRIVACY: Scheduled enforcement of user-selected chat retention.
// Users can set chat_retention_days (30 or 90) on their profile; chats older
// than the selected window are deleted daily.
export const enforceChatRetention = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .pubsub.schedule('every 24 hours')
  .onRun(async () => {
    const firestore = getFirestore();
    const usersSnap = await db.collection('users').where('chat_retention_days', 'in', [30, 90]).get();
    let totalDeleted = 0;
    for (const userDoc of usersSnap.docs) {
      const days = Number(userDoc.data()?.chat_retention_days || 0);
      if (days !== 30 && days !== 90) continue;
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const chatsCol = userDoc.ref.collection('chat_sessions');
      try {
        // Delete sessions whose last activity (updated_at, else created_at) predates the cutoff
        const snap = await chatsCol.limit(500).get();
        for (const chat of snap.docs) {
          const d = chat.data() || {};
          const ts = d.updated_at || d.created_at || d.createdAt || null;
          const when = typeof ts?.toDate === 'function' ? ts.toDate() : (ts ? new Date(ts) : null);
          if (when && when < cutoff) {
            await firestore.recursiveDelete(chat.ref);
            totalDeleted += 1;
          }
        }
      } catch (e) {
        console.error(`[enforceChatRetention] Failed for ${userDoc.id}:`, e?.message || e);
      }
    }
    console.log(`[enforceChatRetention] Deleted ${totalDeleted} expired chat sessions across ${usersSnap.size} users`);
    return null;
  });
