import { functions, db } from './lib/shared.js';
import { FieldValue } from 'firebase-admin/firestore';


// Callable: remove any friends on the caller's list whose user doc no longer exists
export const cleanupMyFriends = functions.https.onCall(async (data, context) => {
  const myUid = context?.auth?.uid;
  if (!myUid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  const myFriendsCol = db.collection('users').doc(myUid).collection('friends');
  const snap = await myFriendsCol.get();
  if (snap.empty) return { ok: true, removed: 0 };
  let removed = 0;
  const batch = db.batch();
  for (const d of snap.docs) {
    const otherUid = d.id;
    try {
      const other = await db.collection('users').doc(otherUid).get();
      if (!other.exists) {
        batch.delete(d.ref);
        removed++;
      }
    } catch {}
  }
  if (removed > 0) await batch.commit();
  return { ok: true, removed };
});

// Accept a friend request: create reciprocal friends and delete both friend_requests docs
export const acceptFriend = functions.https.onCall(async (data, context) => {
  const myUid = context?.auth?.uid;
  if (!myUid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  const otherUid = String(data?.otherUid || '').trim();
  if (!otherUid) throw new functions.https.HttpsError('invalid-argument', 'Missing otherUid');

  const myFriendsRef = db.collection('users').doc(myUid).collection('friends').doc(otherUid);
  const theirFriendsRef = db.collection('users').doc(otherUid).collection('friends').doc(myUid);
  const myReqRef = db.collection('users').doc(myUid).collection('friend_requests').doc(otherUid);
  const theirReqRef = db.collection('users').doc(otherUid).collection('friend_requests').doc(myUid);

  await db.runTransaction(async (tx) => {
    const now = FieldValue.serverTimestamp();
    tx.set(myFriendsRef, { friend_uid: otherUid, since: now }, { merge: true });
    tx.set(theirFriendsRef, { friend_uid: myUid, since: now }, { merge: true });
    tx.delete(myReqRef);
    tx.delete(theirReqRef);
  });
  return { ok: true };
});
