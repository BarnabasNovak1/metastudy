import { functions, db, verifyRoleLevel } from './lib/shared.js';

const str = (v, max) => String(v || '').slice(0, max);

// Delete a feed post + all subcollections (reactions, comments, runs).
// Caller must be the post owner or a moderator+. Runs server-side so the
// client doesn't pay the subcollection fan-out read/delete cost.
export const deleteFeedPost = functions.https.onCall(async (data, context) => {
  const uid = context?.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');

  const postId = str(data?.postId, 200);
  if (!postId) throw new functions.https.HttpsError('invalid-argument', 'Post ID required');

  const postRef = db.collection('feed_posts').doc(postId);
  const snap = await postRef.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Post not found');

  const post = snap.data() || {};
  if (post.ownerId !== uid) {
    const { valid } = await verifyRoleLevel(uid, 1); // moderator+
    if (!valid) throw new functions.https.HttpsError('permission-denied', 'Only the post owner or a moderator can delete this post');
  }

  await db.recursiveDelete(postRef);
  console.log(`[deleteFeedPost] ${uid} deleted post ${postId}`);
  return { ok: true };
});
