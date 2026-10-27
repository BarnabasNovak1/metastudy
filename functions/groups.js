import { functions, db } from './lib/shared.js';
import { FieldValue } from 'firebase-admin/firestore';

// =============================
// STUDY GROUP MEMBERSHIP (server-side)
// Client-side group doc writes are admin-only by Firestore rules, so all
// join/leave/approve/kick/delete flows go through these callables.
// =============================

const str = (v, max) => String(v || '').slice(0, max);

function requireAuth(context) {
  const uid = context?.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  return uid;
}

async function awardAchievement(uid, id, xpBonus) {
  try {
    const ref = db.collection('users').doc(uid).collection('meta').doc('achievements');
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : {};
    if (data?.earned?.[id]) return;
    await ref.set({ earned: { ...data?.earned, [id]: { earned_at: new Date().toISOString() } } }, { merge: true });
    if (xpBonus > 0) {
      await db.collection('users').doc(uid).collection('meta').doc('counters')
        .set({ xp: FieldValue.increment(xpBonus) }, { merge: true });
    }
  } catch (e) {
    console.warn('[groups] awardAchievement failed:', id, e?.message || e);
  }
}

async function awardMemberCountAchievements(groupRef, newCount, creatorUid) {
  const awards = { 10: 'group_members_10', 50: 'group_members_50', 100: 'group_members_100', 1000: 'group_members_1000' };
  const xp = { 10: 100, 50: 300, 100: 800, 1000: 5000 };
  if (creatorUid && awards[newCount]) await awardAchievement(creatorUid, awards[newCount], xp[newCount]);
}

async function getUsername(uid) {
  try {
    const snap = await db.collection('users').doc(uid).get();
    return String(snap.data()?.username || 'user');
  } catch {
    return 'user';
  }
}

// Join a group using its invite code - works for public AND private groups
// (the code can only be given out by the owner/admins, so no approval needed).
export const joinGroupByCode = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const code = str(data?.inviteCode, 20).trim().toUpperCase();
  if (!code) throw new functions.https.HttpsError('invalid-argument', 'Invite code required');

  const snap = await db.collection('groups').where('inviteCode', '==', code).limit(1).get();
  if (snap.empty) throw new functions.https.HttpsError('not-found', 'No group found with this invite code.');

  const groupDoc = snap.docs[0];
  const group = groupDoc.data() || {};
  if ((group.members || []).includes(uid)) throw new functions.https.HttpsError('already-exists', 'You are already a member of this group.');

  const username = await getUsername(uid);
  const batch = db.batch();
  batch.update(groupDoc.ref, {
    members: FieldValue.arrayUnion(uid),
    [`memberUsernames.${uid}`]: username,
    [`joinRequests.${uid}`]: FieldValue.delete(),
  });
  batch.set(db.collection('users').doc(uid).collection('groups').doc(groupDoc.id), {
    groupId: groupDoc.id,
    groupName: group.name || '',
    role: 'member',
    joinedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  await awardMemberCountAchievements(groupDoc.ref, (group.members || []).length + 1, group.createdBy);
  return { ok: true, groupId: groupDoc.id, groupName: group.name || '' };
});

// Join a discovered group. Public -> joins directly. Private -> creates a
// join request for the owner/admins to approve.
export const requestGroupJoin = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const groupId = str(data?.groupId, 200);
  if (!groupId) throw new functions.https.HttpsError('invalid-argument', 'Group ID required');

  const groupRef = db.collection('groups').doc(groupId);
  const snap = await groupRef.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Group not found');
  const group = snap.data() || {};

  if ((group.members || []).includes(uid)) throw new functions.https.HttpsError('already-exists', 'Already a member');
  if (group.joinRequests?.[uid]) throw new functions.https.HttpsError('already-exists', 'Join request already pending');

  const username = await getUsername(uid);

  if (group.isPrivate) {
    await groupRef.update({
      [`joinRequests.${uid}`]: { username, requestedAt: FieldValue.serverTimestamp() },
    });
    return { ok: true, requested: true };
  }

  const batch = db.batch();
  batch.update(groupRef, {
    members: FieldValue.arrayUnion(uid),
    [`memberUsernames.${uid}`]: username,
  });
  batch.set(db.collection('users').doc(uid).collection('groups').doc(groupId), {
    groupId,
    groupName: group.name || '',
    role: 'member',
    joinedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  await awardMemberCountAchievements(groupRef, (group.members || []).length + 1, group.createdBy);
  return { ok: true, joined: true };
});

// Approve or reject a join request (group owner or admin only).
export const respondToJoinRequest = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const groupId = str(data?.groupId, 200);
  const targetUid = str(data?.targetUid, 200);
  const approve = !!data?.approve;
  if (!groupId || !targetUid) throw new functions.https.HttpsError('invalid-argument', 'Missing fields');

  const groupRef = db.collection('groups').doc(groupId);
  const snap = await groupRef.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Group not found');
  const group = snap.data() || {};
  const isManager = group.createdBy === uid || (group.admins || []).includes(uid);
  if (!isManager) throw new functions.https.HttpsError('permission-denied', 'Only the group owner or admins can manage join requests');

  const request = group.joinRequests?.[targetUid];
  if (!request) throw new functions.https.HttpsError('not-found', 'No pending request for this user');

  const batch = db.batch();
  batch.update(groupRef, { [`joinRequests.${targetUid}`]: FieldValue.delete() });
  if (approve) {
    batch.update(groupRef, {
      members: FieldValue.arrayUnion(targetUid),
      [`memberUsernames.${targetUid}`]: request.username || 'user',
    });
    batch.set(db.collection('users').doc(targetUid).collection('groups').doc(groupId), {
      groupId,
      groupName: group.name || '',
      role: 'member',
      joinedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  if (approve) await awardMemberCountAchievements(groupRef, (group.members || []).length + 1, group.createdBy);
  return { ok: true, approved: approve };
});

// Leave a group (any member). Owner leaving = deleting handled by deleteGroup.
export const leaveGroup = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const groupId = str(data?.groupId, 200);
  if (!groupId) throw new functions.https.HttpsError('invalid-argument', 'Group ID required');

  const groupRef = db.collection('groups').doc(groupId);
  const snap = await groupRef.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Group not found');
  const group = snap.data() || {};
  if (group.createdBy === uid) {
    throw new functions.https.HttpsError('failed-precondition', 'Group owner cannot leave - delete the group instead');
  }

  const batch = db.batch();
  batch.update(groupRef, {
    members: FieldValue.arrayRemove(uid),
    admins: FieldValue.arrayRemove(uid),
    [`memberUsernames.${uid}`]: FieldValue.delete(),
  });
  batch.delete(db.collection('users').doc(uid).collection('groups').doc(groupId));
  await batch.commit();
  return { ok: true };
});

// Kick a member (group owner or admin only).
export const kickGroupMember = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const groupId = str(data?.groupId, 200);
  const memberId = str(data?.memberId, 200);
  if (!groupId || !memberId) throw new functions.https.HttpsError('invalid-argument', 'Missing fields');

  const groupRef = db.collection('groups').doc(groupId);
  const snap = await groupRef.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Group not found');
  const group = snap.data() || {};
  const isManager = group.createdBy === uid || (group.admins || []).includes(uid);
  if (!isManager) throw new functions.https.HttpsError('permission-denied', 'Only the group owner or admins can remove members');
  if (memberId === group.createdBy) throw new functions.https.HttpsError('failed-precondition', 'Cannot remove the group owner');

  const batch = db.batch();
  batch.update(groupRef, {
    members: FieldValue.arrayRemove(memberId),
    admins: FieldValue.arrayRemove(memberId),
    [`memberUsernames.${memberId}`]: FieldValue.delete(),
  });
  batch.delete(db.collection('users').doc(memberId).collection('groups').doc(groupId));
  await batch.commit();
  return { ok: true };
});

// Grant or revoke admin on a member (group owner or admin only).
// Updates both the group doc's admins array and the member's own group ref role.
export const setGroupAdmin = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const groupId = str(data?.groupId, 200);
  const memberId = str(data?.memberId, 200);
  const makeAdmin = !!data?.makeAdmin;
  if (!groupId || !memberId) throw new functions.https.HttpsError('invalid-argument', 'Missing fields');

  const groupRef = db.collection('groups').doc(groupId);
  const snap = await groupRef.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Group not found');
  const group = snap.data() || {};
  const isManager = group.createdBy === uid || (group.admins || []).includes(uid);
  if (!isManager) throw new functions.https.HttpsError('permission-denied', 'Only the group owner or admins can manage admins');
  if (memberId === group.createdBy) throw new functions.https.HttpsError('failed-precondition', 'The group owner is always an admin');
  if (!(group.members || []).includes(memberId)) throw new functions.https.HttpsError('not-found', 'User is not a member of this group');

  const batch = db.batch();
  batch.update(groupRef, { admins: makeAdmin ? FieldValue.arrayUnion(memberId) : FieldValue.arrayRemove(memberId) });
  batch.set(db.collection('users').doc(memberId).collection('groups').doc(groupId),
    { role: makeAdmin ? 'admin' : 'member' }, { merge: true });
  await batch.commit();
  return { ok: true };
});

// Delete a group entirely (owner only): group doc, members' group refs.
export const deleteGroup = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const groupId = str(data?.groupId, 200);
  if (!groupId) throw new functions.https.HttpsError('invalid-argument', 'Group ID required');

  const groupRef = db.collection('groups').doc(groupId);
  const snap = await groupRef.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Group not found');
  const group = snap.data() || {};
  if (group.createdBy !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Only the group owner can delete the group');
  }

  // Remove group refs from all members' user docs
  const memberIds = group.members || [];
  for (let i = 0; i < memberIds.length; i += 400) {
    const batch = db.batch();
    for (const mid of memberIds.slice(i, i + 400)) {
      batch.delete(db.collection('users').doc(mid).collection('groups').doc(groupId));
    }
    await batch.commit();
  }

  await db.recursiveDelete(groupRef);
  console.log(`[deleteGroup] ${uid} deleted group ${groupId}`);
  return { ok: true };
});


