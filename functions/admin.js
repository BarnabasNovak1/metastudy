import { functions, db, getStripe, ROLE_LEVELS, SUPPORT_REPORT_METRICS_REF, normalizeReportType, getReportCategory, verifyRoleLevel, Resend, crypto, Stripe, mapPlanByPriceId } from './lib/shared.js';
import { getFirestore, FieldValue, FieldPath, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';


// Admin: One-time backfill of public_profiles for existing users.
// Run once after deploying the public_profiles mirror triggers + rules.
export const backfillPublicProfiles = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onCall(async (data, context) => {
    const callerUid = context?.auth?.uid;
    if (!callerUid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
    const { valid } = await verifyRoleLevel(callerUid, ROLE_LEVELS.admin);
    if (!valid) throw new functions.https.HttpsError('permission-denied', 'Admin access required');

    const isCompleted = (d) => !!d && d.score !== null && d.score !== undefined && !!d.completedAt;

    let processed = 0;
    let lastDoc = null;
    while (true) {
      let q = db.collection('users').orderBy(FieldPath.documentId()).limit(100);
      if (lastDoc) q = q.startAfter(lastDoc);
      const snap = await q.get();
      if (snap.empty) break;
      for (const userDoc of snap.docs) {
        const uid = userDoc.id;
        const u = userDoc.data() || {};
        try {
          const [countersSnap, achSnap, runsSnap, friendsCount] = await Promise.all([
            userDoc.ref.collection('meta').doc('counters').get().catch(() => null),
            userDoc.ref.collection('meta').doc('achievements').get().catch(() => null),
            userDoc.ref.collection('runs').get().catch(() => null),
            userDoc.ref.collection('friends').count().get().then((s) => s.data().count).catch(() => 0),
          ]);
          const counters = countersSnap?.exists ? (countersSnap.data() || {}) : {};
          const ach = achSnap?.exists ? (achSnap.data() || {}) : {};
          let joined = 0, completed = 0;
          (runsSnap?.docs || []).forEach((d) => {
            joined += 1;
            if (isCompleted(d.data())) completed += 1;
          });
          await db.collection('public_profiles').doc(uid).set({
            username: (u.username || '').toLowerCase() || null,
            photo_url: u.photo_url || u.photoURL || null,
            bio: u.bio || null,
            education_level: u.education_level || null,
            xp: Number(counters.xp || 0),
            quizzes: Number(counters.quizzes || 0),
            chats: Number(counters.chats || 0),
            flashcards: Number(counters.flashcards || 0),
            days_total: Number(ach.days_total || 0),
            streak_current: Number(ach.streak_current || 0),
            streak_longest: Number(ach.streak_longest || 0),
            challenges_joined: joined,
            challenges_completed: completed,
            friends_count: Number(friendsCount || 0),
            updated_at: FieldValue.serverTimestamp(),
          }, { merge: true });
          processed += 1;
        } catch (e) {
          console.error(`[backfillPublicProfiles] Failed for ${uid}:`, e?.message || e);
        }
      }
      lastDoc = snap.docs[snap.docs.length - 1];
      if (snap.size < 100) break;
    }
    console.log(`[backfillPublicProfiles] processed=${processed}`);
    return { ok: true, processed };
  });

// Admin: One-time backfill for private-by-default rules migration.
// Marks source content referenced by existing feed posts as shared:true so
// old challenges keep working after quizzes/flashcard_sets/summaries/lessons
// became owner-only by default.
export const backfillSharedFlags = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onCall(async (data, context) => {
    const callerUid = context?.auth?.uid;
    if (!callerUid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
    const { valid } = await verifyRoleLevel(callerUid, ROLE_LEVELS.admin);
    if (!valid) throw new functions.https.HttpsError('permission-denied', 'Admin access required');

    const typeToCollection = (t) => (
      t === 'flashcards' ? 'flashcard_sets'
      : t === 'quiz' ? 'quizzes'
      : t === 'lesson' ? 'lessons'
      : 'summaries'
    );

    let updated = 0;
    let skipped = 0;
    let lastDoc = null;
    while (true) {
      let q = db.collection('feed_posts').orderBy(FieldPath.documentId()).limit(200);
      if (lastDoc) q = q.startAfter(lastDoc);
      const snap = await q.get();
      if (snap.empty) break;
      for (const postDoc of snap.docs) {
        const post = postDoc.data() || {};
        const src = post.sourceRef;
        const ownerId = post.ownerId;
        if (!src?.docId || !ownerId) { skipped += 1; continue; }
        const colName = typeToCollection(src.type || post.type);
        const srcRef = db.collection('users').doc(ownerId).collection(colName).doc(src.docId);
        try {
          const srcSnap = await srcRef.get();
          if (srcSnap.exists && srcSnap.data()?.shared !== true) {
            await srcRef.set({ shared: true }, { merge: true });
            updated += 1;
          } else if (!srcSnap.exists && (src.type === 'flashcards' || post.type === 'flashcards')) {
            // Legacy flashcards collection fallback
            const legacyRef = db.collection('users').doc(ownerId).collection('flashcards').doc(src.docId);
            const legacySnap = await legacyRef.get();
            if (legacySnap.exists && legacySnap.data()?.shared !== true) {
              await legacyRef.set({ shared: true }, { merge: true });
              updated += 1;
            } else {
              skipped += 1;
            }
          } else {
            skipped += 1;
          }
        } catch (e) {
          console.error(`[backfillSharedFlags] Failed for post ${postDoc.id}:`, e?.message || e);
          skipped += 1;
        }
      }
      lastDoc = snap.docs[snap.docs.length - 1];
      if (snap.size < 200) break;
    }
    console.log(`[backfillSharedFlags] updated=${updated} skipped=${skipped}`);
    return { ok: true, updated, skipped };
  });

// Admin: Clean up orphaned user documents (for documents that exist but have no data)
// This requires the caller to be an admin (check email domain or custom claim)
export const cleanupOrphanedUserDoc = functions.https.onCall(async (data, context) => {
  const callerUid = context?.auth?.uid;
  if (!callerUid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  
  const { valid } = await verifyRoleLevel(callerUid, ROLE_LEVELS.admin);
  if (!valid) throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  
  const targetUid = String(data?.uid || '').trim();
  if (!targetUid) throw new functions.https.HttpsError('invalid-argument', 'Missing uid');
  
  // Recursively delete a document and all its subcollections
  async function deleteDocRecursively(docRef) {
    try {
      const subcols = await docRef.listCollections();
      for (const col of subcols) {
        const batchSize = 100;
        let snap = await col.limit(batchSize).get();
        while (!snap.empty) {
          for (const docSnap of snap.docs) {
            await deleteDocRecursively(docSnap.ref);
          }
          snap = await col.limit(batchSize).get();
        }
      }
      await docRef.delete();
    } catch (e) {
      console.error(`Failed to delete doc ${docRef.path}:`, e?.message || e);
    }
  }
  
  // Delete from users collection
  try {
    const userRef = db.collection('users').doc(targetUid);
    await deleteDocRecursively(userRef);
    console.log(`Cleaned up users/${targetUid}`);
  } catch (e) {
    console.error('Error cleaning up user doc:', e?.message || e);
  }
  
  // Delete from customers collection
  try {
    const custRef = db.collection('customers').doc(targetUid);
    await deleteDocRecursively(custRef);
    console.log(`Cleaned up customers/${targetUid}`);
  } catch (e) {
    console.error('Error cleaning up customer doc:', e?.message || e);
  }
  
  return { ok: true, cleaned: targetUid };
});

// Admin: Clean up orphaned feed content from deleted users (posts, comments, reactions)
export const cleanupOrphanedFeedContent = functions.https.onCall(async (data, context) => {
  const callerUid = context?.auth?.uid;
  if (!callerUid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  
  const { valid } = await verifyRoleLevel(callerUid, ROLE_LEVELS.admin);
  if (!valid) throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  
  let deletedPosts = 0;
  let deletedComments = 0;
  let deletedReactions = 0;
  
  // 1) Find and delete posts from users who no longer exist
  try {
    const postsSnap = await db.collection('feed_posts').get();
    for (const postDoc of postsSnap.docs) {
      const ownerId = postDoc.data()?.ownerId;
      if (!ownerId) continue;
      
      // Check if user exists
      const userSnap = await db.collection('users').doc(ownerId).get();
      if (!userSnap.exists) {
        // Delete post subcollections first
        const subcols = await postDoc.ref.listCollections();
        for (const subcol of subcols) {
          const subSnap = await subcol.get();
          const batch = db.batch();
          subSnap.docs.forEach((d) => batch.delete(d.ref));
          if (!subSnap.empty) await batch.commit();
        }
        // Delete the post
        await postDoc.ref.delete();
        deletedPosts++;
      }
    }
  } catch (e) {
    console.error('Error cleaning up orphaned posts:', e?.message || e);
  }
  
  // 2) Find and delete comments from users who no longer exist
  try {
    const commentsSnap = await db.collectionGroup('comments').get();
    const batch = db.batch();
    let batchCount = 0;
    
    for (const commentDoc of commentsSnap.docs) {
      const userId = commentDoc.data()?.userId;
      if (!userId) continue;
      
      const userSnap = await db.collection('users').doc(userId).get();
      if (!userSnap.exists) {
        batch.delete(commentDoc.ref);
        batchCount++;
        deletedComments++;
        
        // Commit batch every 400 operations (Firestore limit is 500)
        if (batchCount >= 400) {
          await batch.commit();
          batchCount = 0;
        }
      }
    }
    
    if (batchCount > 0) await batch.commit();
  } catch (e) {
    console.error('Error cleaning up orphaned comments:', e?.message || e);
  }
  
  // 3) Find and delete reactions from users who no longer exist
  try {
    const reactionsSnap = await db.collectionGroup('reactions').get();
    const batch = db.batch();
    let batchCount = 0;
    
    for (const reactionDoc of reactionsSnap.docs) {
      const userId = reactionDoc.id; // Reactions are stored with doc ID = userId
      
      const userSnap = await db.collection('users').doc(userId).get();
      if (!userSnap.exists) {
        batch.delete(reactionDoc.ref);
        batchCount++;
        deletedReactions++;
        
        if (batchCount >= 400) {
          await batch.commit();
          batchCount = 0;
        }
      }
    }
    
    if (batchCount > 0) await batch.commit();
  } catch (e) {
    console.error('Error cleaning up orphaned reactions:', e?.message || e);
  }
  
  console.log(`Cleanup complete: ${deletedPosts} posts, ${deletedComments} comments, ${deletedReactions} reactions`);
  return { ok: true, deletedPosts, deletedComments, deletedReactions };
});

// OPTIMIZED: Fix/sync usage counters - parallel reads, minimal writes
export const fixExpiredCounters = functions.https.onCall(async (data, context) => {
  const uid = context?.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  
  try {
    const userRef = db.collection('users').doc(uid);
    const countersRef = userRef.collection('meta').doc('counters');
    
    // OPTIMIZED: Parallel reads instead of sequential
    const [userSnap, countersSnap] = await Promise.all([userRef.get(), countersRef.get()]);
    
    if (!userSnap.exists) {
      return { fixed: false, message: 'User not found' };
    }
    
    const userData = userSnap.data() || {};
    const countersData = countersSnap.exists ? (countersSnap.data() || {}) : {};
    
    const usagePeriodEnd = countersData.usage_period_end;
    const renewsAt = userData.renews_at;
    const usageCycleDay = userData.usage_cycle_day;
    const createdAt = userData.created_at;
    const plan = userData.plan || 'free';
    const now = new Date();
    const nowMs = now.getTime();
    
    // Helper: compute next reset date from a day-of-month anchor
    const computeNextPeriodEnd = (anchorDay) => {
      const day = Math.min(28, Math.max(1, anchorDay));
      const y = now.getFullYear();
      const m = now.getMonth();
      const d = now.getDate();
      const next = d < day ? new Date(y, m, day) : new Date(y, m + 1, day);
      return next.toISOString();
    };
    
    // Check if usage_period_end exists and is expired
    if (usagePeriodEnd) {
      const periodEndTime = new Date(usagePeriodEnd).getTime();
      
      if (!isNaN(periodEndTime) && nowMs >= periodEndTime) {
        // Period has expired - compute new period end
        let newPeriodEnd;
        if (renewsAt && plan !== 'free') {
          newPeriodEnd = renewsAt;
        } else if (usageCycleDay) {
          newPeriodEnd = computeNextPeriodEnd(usageCycleDay);
        } else {
          const base = new Date(usagePeriodEnd);
          base.setMonth(base.getMonth() + 1);
          newPeriodEnd = base.toISOString();
        }
        
        // 1 WRITE: Reset counters
        await countersRef.set({
          uses_this_month: 0,
          extra_uses_used: 0,
          usage_period_end: newPeriodEnd
        }, { merge: true });
        
        return { 
          fixed: true, 
          message: `Usage reset! Next reset: ${new Date(newPeriodEnd).toLocaleDateString()}`,
          wasExpired: true,
          newPeriodEnd
        };
      } else {
        // NO WRITE: Period not expired
        return { 
          fixed: false, 
          message: `Not expired. Resets: ${new Date(usagePeriodEnd).toLocaleDateString()}`,
          periodEnd: usagePeriodEnd 
        };
      }
    } else if (renewsAt && plan !== 'free') {
      // 1 WRITE: Sync to Stripe renewal
      await countersRef.set({ usage_period_end: renewsAt }, { merge: true });
      return { 
        fixed: true, 
        message: `Synced to renewal: ${new Date(renewsAt).toLocaleDateString()}`,
        syncedTo: renewsAt 
      };
    } else {
      // Free user - initialize usage_period_end (do NOT reset uses_this_month)
      let anchorDay = now.getDate();
      if (usageCycleDay) {
        anchorDay = usageCycleDay;
      } else if (createdAt) {
        anchorDay = new Date(createdAt).getDate();
      }
      
      const newPeriodEnd = computeNextPeriodEnd(anchorDay);
      
      // OPTIMIZED: Parallel writes if both needed
      // IMPORTANT: Do NOT reset uses_this_month - only set usage_period_end
      const writes = [
        countersRef.set({ usage_period_end: newPeriodEnd }, { merge: true })
      ];
      if (!usageCycleDay) {
        writes.push(userRef.set({ usage_cycle_day: anchorDay }, { merge: true }));
      }
      await Promise.all(writes);
      
      return { 
        fixed: true, 
        message: `Initialized! Resets: ${new Date(newPeriodEnd).toLocaleDateString()}`,
        newPeriodEnd,
        cycleDay: anchorDay
      };
    }
  } catch (e) {
    console.error('Failed to fix counters:', e);
    throw new functions.https.HttpsError('internal', e?.message || 'Failed to fix counters');
  }
});

// One-time cleanup: Delete orphaned feed posts where owner no longer exists
// Call this once to clean up existing orphans, then it's no longer needed
export const cleanupOrphanedFeedPosts = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onCall(async (data, context) => {
    const callerUid = context?.auth?.uid;
    if (!callerUid) {
      throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
    }
    const { valid } = await verifyRoleLevel(callerUid, ROLE_LEVELS.admin);
    if (!valid) throw new functions.https.HttpsError('permission-denied', 'Admin access required');
    
    console.log('[cleanupOrphanedFeedPosts] Starting cleanup...');
    const firestore = getFirestore();
    
    // Bound memory and never interpret an unavailable lookup as a missing user.
    let totalPosts = 0;
    let orphanedPosts = 0;
    let deletedCount = 0;
    let cursor = null;
    const ownerIds = new Set();
    const existingOwners = new Set();
    while (true) {
      let query = db.collection('feed_posts').limit(200);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      if (page.empty) break;
      totalPosts += page.size;
      for (const post of page.docs) {
        const uid = post.data().ownerId;
        if (typeof uid !== 'string' || !uid || uid.includes('/')) continue;
        ownerIds.add(uid);
        const user = await db.collection('users').doc(uid).get();
        if (user.exists) {
          existingOwners.add(uid);
          continue;
        }
        // An Auth account without a profile is still a legitimate owner.
        try {
          await getAuth().getUser(uid);
          existingOwners.add(uid);
          continue;
        } catch (e) {
          if (e?.code !== 'auth/user-not-found') throw e;
        }
        orphanedPosts++;
        try {
          await firestore.recursiveDelete(post.ref);
          deletedCount++;
        } catch (e) {
          console.error(`[cleanupOrphanedFeedPosts] Failed to delete post ${post.id}:`, e?.message);
          throw e;
        }
      }
      cursor = page.docs[page.docs.length - 1];
    }
    
    console.log(`[cleanupOrphanedFeedPosts] Cleanup complete. Deleted ${deletedCount} orphaned posts.`);
    
    return {
      success: true,
      totalPosts,
      uniqueOwners: ownerIds.size,
      existingOwners: existingOwners.size,
      orphanedPosts,
      deletedCount
    };
  });

// =============================
// EMAIL REPORTING SYSTEM (Resend)
// =============================

// Send error report/feedback email via Resend
export const sendReportEmail = functions
  .https.onCall(async (data, context) => {
    const uid = context?.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
    if (!context?.app) {
      console.warn('[sendReportEmail] Missing App Check token for uid:', uid);
    }
    
    const { subject, message, type, metadata } = data || {};
    if (!message?.trim()) throw new functions.https.HttpsError('invalid-argument', 'Message is required');
    
    const RESEND_KEY = (process.env.RESEND_API_KEY || '').trim();
    if (!RESEND_KEY) throw new functions.https.HttpsError('internal', 'Email service not configured');
    
    // Get user info
    let userEmail = '';
    let username = '';
    try {
      const userSnap = await db.collection('users').doc(uid).get();
      const userData = userSnap.exists ? userSnap.data() || {} : {};
      userEmail = userData.email || '';
      username = userData.username || '';
    } catch {}
    
    const resend = new Resend(RESEND_KEY);
    const reportType = normalizeReportType(type);
    const reportCategory = getReportCategory(reportType);
    const reportedUser = String(data?.reportedUser || metadata?.reportedUser || '').trim();

    const reportRef = await db.collection('support_reports').add({
      type: reportType,
      category: reportCategory,
      status: 'open',
      message: String(message || '').trim().slice(0, 5000),
      reporterUid: uid,
      reporterUsername: username || null,
      reporterEmail: userEmail || null,
      reportedUser: reportedUser || null,
      metadata: metadata && typeof metadata === 'object' ? metadata : null,
      createdAt: FieldValue.serverTimestamp(),
    });

    try {
      await SUPPORT_REPORT_METRICS_REF.set({
        totalOpen: FieldValue.increment(1),
        byCategory: {
          [reportCategory]: FieldValue.increment(1),
        },
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (metricsError) {
      console.error('[sendReportEmail] Failed to increment support report metrics:', metricsError?.message || metricsError);
    }

    const subjectLine = subject || `[${reportType.toUpperCase()}] Report from ${username || uid}`;
    
    try {
      await resend.emails.send({
        from: 'MetaStudy <noreply@metastudy.com>',
        to: ['support@metastudy.com'],
        replyTo: userEmail || undefined,
        subject: subjectLine,
        html: `
          <h2>Report from MetaStudy User</h2>
          <p><strong>Report ID:</strong> ${reportRef.id}</p>
          <p><strong>Type:</strong> ${reportType}</p>
          <p><strong>Category:</strong> ${reportCategory}</p>
          <p><strong>User ID:</strong> ${uid}</p>
          <p><strong>Username:</strong> ${username || 'N/A'}</p>
          <p><strong>Email:</strong> ${userEmail || 'N/A'}</p>
          ${reportedUser ? `<p><strong>Reported User:</strong> ${reportedUser}</p>` : ''}
          <hr />
          <h3>Message:</h3>
          <p style="white-space: pre-wrap;">${String(message).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
          ${metadata ? `<hr /><h3>Metadata:</h3><pre>${JSON.stringify(metadata, null, 2)}</pre>` : ''}
          <hr />
          <p style="color: #666; font-size: 12px;">Sent at ${new Date().toISOString()}</p>
        `,
      });
      
      return { ok: true, reportId: reportRef.id };
    } catch (e) {
      console.error('Resend email failed:', e?.message || e);
      throw new functions.https.HttpsError('internal', 'Failed to send report');
    }
  });

function isFunctionsEmulator() {
  return String(process.env.FUNCTIONS_EMULATOR || '').toLowerCase() === 'true';
}

function requireAppCheck(context, { allowInEmulator = true } = {}) {
  if (allowInEmulator && isFunctionsEmulator()) return;
  if (!context?.app?.appId) {
    throw new functions.https.HttpsError('failed-precondition', 'App Check token required');
  }
}

// Helper: Log moderation action
async function logModerationAction(action) {
  try {
    await db.collection('moderation_logs').add({
      ...action,
      timestamp: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.error('Failed to log action:', e?.message);
  }
}

// Send role invite (Admin/Superadmin only)
export const sendRoleInvite = functions.https.onCall(async (data, context) => {
  requireAppCheck(context);
  const callerUid = context?.auth?.uid;
  if (!callerUid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  
  const { targetEmail, role } = data || {};
  if (!targetEmail?.trim()) throw new functions.https.HttpsError('invalid-argument', 'Email is required');
  
  const targetRole = String(role || '').toLowerCase();
  if (!['moderator', 'admin'].includes(targetRole)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid role. Must be moderator or admin.');
  }
  
  // Verify caller permissions
  const { valid, role: callerRole, level: callerLevel } = await verifyRoleLevel(callerUid, ROLE_LEVELS.admin);
  if (!valid) throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  
  // Hierarchy check: can only invite roles below your level
  const targetLevel = ROLE_LEVELS[targetRole] || 0;
  if (targetLevel >= callerLevel) {
    throw new functions.https.HttpsError('permission-denied', 'Cannot invite someone to equal or higher role');
  }
  
  // Admin can only invite moderators
  if (callerRole === 'admin' && targetRole !== 'moderator') {
    throw new functions.https.HttpsError('permission-denied', 'Admins can only invite moderators');
  }
  
  // Check if invite already exists
  const existingInvite = await db.collection('role_invites')
    .where('email', '==', targetEmail.toLowerCase().trim())
    .where('status', '==', 'pending')
    .limit(1)
    .get();
  
  if (!existingInvite.empty) {
    throw new functions.https.HttpsError('already-exists', 'An invite already exists for this email');
  }
  
  // Create invite
  const inviteRef = await db.collection('role_invites').add({
    email: targetEmail.toLowerCase().trim(),
    role: targetRole,
    invitedBy: callerUid,
    invitedByRole: callerRole,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
  });
  
  await logModerationAction({
    type: 'invite_sent',
    actorUid: callerUid,
    actorRole: callerRole,
    targetEmail: targetEmail.toLowerCase().trim(),
    targetRole,
    inviteId: inviteRef.id,
  });
  
  return { ok: true, inviteId: inviteRef.id };
});

// Accept role invite
export const acceptRoleInvite = functions.https.onCall(async (data, context) => {
  requireAppCheck(context);
  const uid = context?.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  
  // Get user email
  let userEmail = '';
  try {
    const authUser = await getAuth().getUser(uid);
    userEmail = (authUser.email || '').toLowerCase();
  } catch {}
  
  if (!userEmail) throw new functions.https.HttpsError('failed-precondition', 'No email associated with account');
  
  // Find pending invite for this email
  const inviteSnap = await db.collection('role_invites')
    .where('email', '==', userEmail)
    .where('status', '==', 'pending')
    .limit(1)
    .get();
  
  if (inviteSnap.empty) {
    return { ok: false, message: 'No pending invite found' };
  }
  
  const inviteDoc = inviteSnap.docs[0];
  const inviteData = inviteDoc.data();
  
  // Check expiration
  const expiresAt = inviteData.expiresAt?.toDate?.() || new Date(inviteData.expiresAt);
  if (expiresAt < new Date()) {
    await inviteDoc.ref.update({ status: 'expired' });
    throw new functions.https.HttpsError('failed-precondition', 'Invite has expired');
  }
  
  const newRole = inviteData.role;
  
  // Update user role
  await db.collection('users').doc(uid).update({
    role: newRole,
    roleUpdatedAt: FieldValue.serverTimestamp(),
    roleInvitedBy: inviteData.invitedBy,
  });
  
  // Update invite status
  await inviteDoc.ref.update({
    status: 'accepted',
    acceptedAt: FieldValue.serverTimestamp(),
    acceptedBy: uid,
  });
  
  // Set custom claim for role
  try {
    const existingClaims = (await getAuth().getUser(uid)).customClaims || {};
    await getAuth().setCustomUserClaims(uid, { ...existingClaims, role: newRole });
  } catch {}
  
  await logModerationAction({
    type: 'invite_accepted',
    actorUid: uid,
    newRole,
    inviteId: inviteDoc.id,
    invitedBy: inviteData.invitedBy,
  });
  
  return { ok: true, role: newRole };
});

// Check for pending role invite (called on login)
export const checkRoleInvite = functions.https.onCall(async (data, context) => {
  requireAppCheck(context);
  const uid = context?.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  
  let userEmail = '';
  try {
    const authUser = await getAuth().getUser(uid);
    userEmail = (authUser.email || '').toLowerCase();
  } catch {}
  
  if (!userEmail) return { hasPendingInvite: false };
  
  const inviteSnap = await db.collection('role_invites')
    .where('email', '==', userEmail)
    .where('status', '==', 'pending')
    .limit(1)
    .get();
  
  if (inviteSnap.empty) return { hasPendingInvite: false };
  
  const inviteData = inviteSnap.docs[0].data();
  const expiresAt = inviteData.expiresAt?.toDate?.() || new Date(inviteData.expiresAt);
  
  if (expiresAt < new Date()) {
    await inviteSnap.docs[0].ref.update({ status: 'expired' });
    return { hasPendingInvite: false };
  }
  
  return {
    hasPendingInvite: true,
    inviteId: inviteSnap.docs[0].id,
    role: inviteData.role,
    invitedBy: inviteData.invitedBy,
  };
});

// Remove role (downgrade to user)
export const removeUserRole = functions.https.onCall(async (data, context) => {
  requireAppCheck(context);
  const callerUid = context?.auth?.uid;
  if (!callerUid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  
  const { targetUid } = data || {};
  if (!targetUid) throw new functions.https.HttpsError('invalid-argument', 'Target user ID required');
  
  // Verify caller permissions
  const { valid, role: callerRole, level: callerLevel } = await verifyRoleLevel(callerUid, ROLE_LEVELS.admin);
  if (!valid) throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  
  // Get target user role
  const targetSnap = await db.collection('users').doc(targetUid).get();
  const targetData = targetSnap.exists ? targetSnap.data() || {} : {};
  const targetRole = String(targetData.role || 'user').toLowerCase();
  const targetLevel = ROLE_LEVELS[targetRole] || 0;
  
  // Hierarchy check
  if (targetLevel >= callerLevel) {
    throw new functions.https.HttpsError('permission-denied', 'Cannot remove role from equal or higher role');
  }
  
  // Admin can only remove moderators
  if (callerRole === 'admin' && targetRole !== 'moderator') {
    throw new functions.https.HttpsError('permission-denied', 'Admins can only remove moderator roles');
  }
  
  // Downgrade to user
  await db.collection('users').doc(targetUid).update({
    role: 'user',
    previousRole: targetRole,
    roleRemovedAt: FieldValue.serverTimestamp(),
    roleRemovedBy: callerUid,
  });
  
  // Update custom claims
  try {
    const existingClaims = (await getAuth().getUser(targetUid)).customClaims || {};
    await getAuth().setCustomUserClaims(targetUid, { ...existingClaims, role: 'user' });
  } catch {}
  
  await logModerationAction({
    type: 'role_removed',
    actorUid: callerUid,
    actorRole: callerRole,
    targetUid,
    previousRole: targetRole,
    newRole: 'user',
  });
  
  return { ok: true };
});

// Ban user (moderator+ can ban users)
export const banUser = functions.https.onCall(async (data, context) => {
  requireAppCheck(context);
  const callerUid = context?.auth?.uid;
  if (!callerUid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  
  const { targetUid, banType, reason } = data || {};
  if (!targetUid) throw new functions.https.HttpsError('invalid-argument', 'Target user ID required');
  
  const validBanTypes = ['cannot_post', 'cannot_comment', 'full'];
  if (!validBanTypes.includes(banType)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid ban type');
  }
  
  // Verify caller permissions
  const { valid, role: callerRole, level: callerLevel } = await verifyRoleLevel(callerUid, ROLE_LEVELS.moderator);
  if (!valid) throw new functions.https.HttpsError('permission-denied', 'Moderator access required');
  
  // Get target user role
  const targetSnap = await db.collection('users').doc(targetUid).get();
  const targetData = targetSnap.exists ? targetSnap.data() || {} : {};
  const targetRole = String(targetData.role || 'user').toLowerCase();
  const targetLevel = ROLE_LEVELS[targetRole] || 0;
  
  // Hierarchy check: can only ban lower roles
  if (targetLevel >= callerLevel) {
    throw new functions.https.HttpsError('permission-denied', 'Cannot ban equal or higher role');
  }
  
  // Apply ban
  const banData = {
    [`banned.${banType}`]: true,
    [`banned.${banType}_at`]: FieldValue.serverTimestamp(),
    [`banned.${banType}_by`]: callerUid,
    [`banned.${banType}_reason`]: reason || '',
  };
  
  await db.collection('users').doc(targetUid).update(banData);
  
  await logModerationAction({
    type: 'user_banned',
    actorUid: callerUid,
    actorRole: callerRole,
    targetUid,
    banType,
    reason: reason || '',
  });
  
  return { ok: true };
});

// Unban user
export const unbanUser = functions.https.onCall(async (data, context) => {
  requireAppCheck(context);
  const callerUid = context?.auth?.uid;
  if (!callerUid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  
  const { targetUid, banType } = data || {};
  if (!targetUid) throw new functions.https.HttpsError('invalid-argument', 'Target user ID required');
  
  const validBanTypes = ['cannot_post', 'cannot_comment', 'full'];
  if (!validBanTypes.includes(banType)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid ban type');
  }
  
  // Verify caller permissions
  const { valid, role: callerRole, level: callerLevel } = await verifyRoleLevel(callerUid, ROLE_LEVELS.moderator);
  if (!valid) throw new functions.https.HttpsError('permission-denied', 'Moderator access required');
  
  // Get target's ban info to check who applied it
  const targetSnap = await db.collection('users').doc(targetUid).get();
  const targetData = targetSnap.exists ? targetSnap.data() || {} : {};
  const banned = targetData.banned || {};
  const bannedBy = banned[`${banType}_by`];
  
  // Check if the ban was applied by someone higher - only they or higher can remove
  if (bannedBy) {
    const bannerSnap = await db.collection('users').doc(bannedBy).get();
    const bannerData = bannerSnap.exists ? bannerSnap.data() || {} : {};
    const bannerRole = String(bannerData.role || 'user').toLowerCase();
    const bannerLevel = ROLE_LEVELS[bannerRole] || 0;
    
    // Need to be same level or higher than who applied the ban
    if (callerLevel < bannerLevel) {
      throw new functions.https.HttpsError('permission-denied', 'Cannot reverse ban applied by higher role');
    }
  }
  
  // Remove ban
  await db.collection('users').doc(targetUid).update({
    [`banned.${banType}`]: FieldValue.delete(),
    [`banned.${banType}_at`]: FieldValue.delete(),
    [`banned.${banType}_by`]: FieldValue.delete(),
    [`banned.${banType}_reason`]: FieldValue.delete(),
    [`banned.${banType}_unbanned_at`]: FieldValue.serverTimestamp(),
    [`banned.${banType}_unbanned_by`]: callerUid,
  });
  
  await logModerationAction({
    type: 'user_unbanned',
    actorUid: callerUid,
    actorRole: callerRole,
    targetUid,
    banType,
    previouslyBannedBy: bannedBy,
  });
  
  return { ok: true };
});

// Delete content (post/comment) - moderator+
export const moderateContent = functions.https.onCall(async (data, context) => {
  requireAppCheck(context);
  const callerUid = context?.auth?.uid;
  if (!callerUid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  
  const { contentType, contentId, reason, postId } = data || {};
  if (!contentType || !contentId) {
    throw new functions.https.HttpsError('invalid-argument', 'Content type and ID required');
  }
  
  if (!['post', 'comment'].includes(contentType)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid content type');
  }
  
  // Verify caller permissions
  const { valid, role: callerRole } = await verifyRoleLevel(callerUid, ROLE_LEVELS.moderator);
  if (!valid) throw new functions.https.HttpsError('permission-denied', 'Moderator access required');
  
  // Get content reference
  let contentRef;
  let contentData;
  
  if (contentType === 'post') {
    contentRef = db.collection('feed_posts').doc(contentId);
    const snap = await contentRef.get();
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Post not found');
    contentData = snap.data();
  } else if (contentType === 'comment') {
    if (!postId) throw new functions.https.HttpsError('invalid-argument', 'Post ID required for comments');
    contentRef = db.collection('feed_posts').doc(postId).collection('comments').doc(contentId);
    const snap = await contentRef.get();
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Comment not found');
    contentData = snap.data();
  }
  
  // Archive content before deleting (for potential reversal)
  await db.collection('moderated_content').add({
    contentType,
    contentId,
    postId: postId || contentId,
    originalData: contentData,
    moderatedBy: callerUid,
    moderatorRole: callerRole,
    reason: reason || '',
    moderatedAt: FieldValue.serverTimestamp(),
    status: 'deleted',
  });
  
  // Delete content
  await contentRef.delete();
  
  await logModerationAction({
    type: 'content_deleted',
    actorUid: callerUid,
    actorRole: callerRole,
    contentType,
    contentId,
    postId: postId || contentId,
    reason: reason || '',
    ownerId: contentData?.ownerId || contentData?.authorId,
  });
  
  return { ok: true };
});

// Restore deleted content (higher role reversal)
export const restoreContent = functions.https.onCall(async (data, context) => {
  requireAppCheck(context);
  const callerUid = context?.auth?.uid;
  if (!callerUid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  
  const { archiveId } = data || {};
  if (!archiveId) throw new functions.https.HttpsError('invalid-argument', 'Archive ID required');
  
  // Verify caller permissions (admin+ for reversal)
  const { valid, role: callerRole, level: callerLevel } = await verifyRoleLevel(callerUid, ROLE_LEVELS.admin);
  if (!valid) throw new functions.https.HttpsError('permission-denied', 'Admin access required for reversal');
  
  // Get archived content
  const archiveRef = db.collection('moderated_content').doc(archiveId);
  const archiveSnap = await archiveRef.get();
  
  if (!archiveSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Archived content not found');
  }
  
  const archiveData = archiveSnap.data();
  
  // Check if caller can reverse (must be higher than who deleted it)
  const moderatorSnap = await db.collection('users').doc(archiveData.moderatedBy).get();
  const moderatorData = moderatorSnap.exists ? moderatorSnap.data() || {} : {};
  const moderatorRole = String(moderatorData.role || 'user').toLowerCase();
  const moderatorLevel = ROLE_LEVELS[moderatorRole] || 0;
  
  if (callerLevel <= moderatorLevel && callerUid !== archiveData.moderatedBy) {
    throw new functions.https.HttpsError('permission-denied', 'Cannot reverse action by equal or higher role');
  }
  
  // Restore content
  const { contentType, contentId, postId, originalData } = archiveData;
  
  if (contentType === 'post') {
    await db.collection('feed_posts').doc(contentId).set(originalData);
  } else if (contentType === 'comment') {
    await db.collection('feed_posts').doc(postId).collection('comments').doc(contentId).set(originalData);
  }
  
  // Update archive status
  await archiveRef.update({
    status: 'restored',
    restoredBy: callerUid,
    restoredAt: FieldValue.serverTimestamp(),
  });
  
  await logModerationAction({
    type: 'content_restored',
    actorUid: callerUid,
    actorRole: callerRole,
    contentType,
    contentId,
    archiveId,
    originalModerator: archiveData.moderatedBy,
  });
  
  return { ok: true };
});

// Get moderation logs (admin+ only)
export const getModerationLogs = functions.https.onCall(async (data, context) => {
  if (!context?.app?.appId) {
    console.log('getModerationLogs: missing App Check token, continuing with auth+rbac gate');
  }
  const callerUid = context?.auth?.uid;
  if (!callerUid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  
  // Verify caller permissions
  const { valid } = await verifyRoleLevel(callerUid, ROLE_LEVELS.moderator);
  if (!valid) throw new functions.https.HttpsError('permission-denied', 'Moderator access required');
  
  const { limitCount, startAfter } = data || {};
  const queryLimit = Math.min(limitCount || 50, 100);
  
  let logsQuery = db.collection('moderation_logs')
    .orderBy('timestamp', 'desc')
    .limit(queryLimit);
  
  if (startAfter) {
    const startDoc = await db.collection('moderation_logs').doc(startAfter).get();
    if (startDoc.exists) {
      logsQuery = logsQuery.startAfter(startDoc);
    }
  }
  
  const logsSnap = await logsQuery.get();
  const logs = logsSnap.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    timestamp: doc.data().timestamp?.toDate?.()?.toISOString() || null,
  }));
  const nextCursor = logsSnap.size === queryLimit ? logsSnap.docs[logsSnap.docs.length - 1]?.id || null : null;
  
  return { logs, nextCursor };
});

// Get pending invites (admin+ only)
export const getPendingInvites = functions.https.onCall(async (data, context) => {
  if (!context?.app?.appId) {
    console.log('getPendingInvites: missing App Check token, continuing with auth+rbac gate');
  }
  const callerUid = context?.auth?.uid;
  if (!callerUid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  
  const { valid } = await verifyRoleLevel(callerUid, ROLE_LEVELS.admin);
  if (!valid) throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  
  let invitesSnap = null;
  let inviteDocs = [];
  try {
    invitesSnap = await db.collection('role_invites')
      .where('status', '==', 'pending')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    inviteDocs = invitesSnap.docs;
  } catch (e) {
    const details = String(e?.details || e?.message || '');
    const code = Number(e?.code || 0);
    const needsIndex = code === 9 || /requires an index/i.test(details);
    if (!needsIndex) throw e;

    const fallbackSnap = await db.collection('role_invites')
      .where('status', '==', 'pending')
      .limit(200)
      .get();
    inviteDocs = fallbackSnap.docs
      .sort((a, b) => {
        const aTs = a.data()?.createdAt?.toMillis?.() || 0;
        const bTs = b.data()?.createdAt?.toMillis?.() || 0;
        return bTs - aTs;
      })
      .slice(0, 50);
  }
  
  const invites = inviteDocs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || null,
    expiresAt: doc.data().expiresAt?.toDate?.()?.toISOString() || doc.data().expiresAt,
  }));
  
  return { invites };
});

// Cancel invite (admin+ only)
export const cancelRoleInvite = functions.https.onCall(async (data, context) => {
  requireAppCheck(context);
  const callerUid = context?.auth?.uid;
  if (!callerUid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  
  const { inviteId } = data || {};
  if (!inviteId) throw new functions.https.HttpsError('invalid-argument', 'Invite ID required');
  
  const { valid, role: callerRole } = await verifyRoleLevel(callerUid, ROLE_LEVELS.admin);
  if (!valid) throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  
  const inviteRef = db.collection('role_invites').doc(inviteId);
  const inviteSnap = await inviteRef.get();
  
  if (!inviteSnap.exists) throw new functions.https.HttpsError('not-found', 'Invite not found');
  
  const inviteData = inviteSnap.data();
  
  await inviteRef.update({
    status: 'cancelled',
    cancelledBy: callerUid,
    cancelledAt: FieldValue.serverTimestamp(),
  });
  
  await logModerationAction({
    type: 'invite_cancelled',
    actorUid: callerUid,
    actorRole: callerRole,
    inviteId,
    targetEmail: inviteData.email,
    targetRole: inviteData.role,
  });
  
  return { ok: true };
});

// Get all users with roles (for admin dashboard)
export const getUsersWithRoles = functions.https.onCall(async (data, context) => {
  if (!context?.app?.appId) {
    console.log('getUsersWithRoles: missing App Check token, continuing with auth+rbac gate');
  }
  const callerUid = context?.auth?.uid;
  if (!callerUid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  
  const { valid, level: callerLevel } = await verifyRoleLevel(callerUid, ROLE_LEVELS.moderator);
  if (!valid) throw new functions.https.HttpsError('permission-denied', 'Moderator access required');
  
  const usersSnap = await db.collection('users')
    .where('role', 'in', ['moderator', 'admin', 'superadmin'])
    .limit(100)
    .get();
  
  const users = usersSnap.docs.map(doc => {
    const data = doc.data();
    return {
      uid: doc.id,
      username: data.username || '',
      email: data.email || '',
      role: data.role || 'user',
      roleUpdatedAt: data.roleUpdatedAt?.toDate?.()?.toISOString() || null,
      photo_url: data.photo_url || null,
    };
  });
  
  return { users };
});

// Get open support reports (moderator+)
export const getOpenReports = functions.https.onCall(async (data, context) => {
  if (!context?.app?.appId) {
    console.log('getOpenReports: missing App Check token, continuing with auth+rbac gate');
  }
  const callerUid = context?.auth?.uid;
  if (!callerUid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');

  const { valid } = await verifyRoleLevel(callerUid, ROLE_LEVELS.moderator);
  if (!valid) throw new functions.https.HttpsError('permission-denied', 'Moderator access required');

  const { limitCount, startAfter } = data || {};
  const queryLimit = Math.min(Number(limitCount || 50), 100);

  let reportDocs = [];
  try {
    let reportsQuery = db.collection('support_reports')
      .where('status', '==', 'open')
      .orderBy('createdAt', 'desc')
      .limit(queryLimit);

    if (startAfter) {
      const startDoc = await db.collection('support_reports').doc(String(startAfter)).get();
      if (startDoc.exists) {
        reportsQuery = reportsQuery.startAfter(startDoc);
      }
    }

    const reportsSnap = await reportsQuery.get();
    reportDocs = reportsSnap.docs;
  } catch (e) {
    const details = String(e?.details || e?.message || '');
    const code = Number(e?.code || 0);
    const needsIndex = code === 9 || /requires an index/i.test(details);
    if (!needsIndex) throw e;

    const fallbackSnap = await db.collection('support_reports')
      .where('status', '==', 'open')
      .limit(200)
      .get();
    reportDocs = fallbackSnap.docs
      .sort((a, b) => {
        const aTs = a.data()?.createdAt?.toMillis?.() || 0;
        const bTs = b.data()?.createdAt?.toMillis?.() || 0;
        return bTs - aTs;
      })
      .slice(0, queryLimit);
  }

  const reports = reportDocs.map((doc) => {
    const raw = doc.data() || {};
    return {
      id: doc.id,
      ...raw,
      type: normalizeReportType(raw.type),
      category: raw.category || getReportCategory(raw.type),
      createdAt: raw.createdAt?.toDate?.()?.toISOString() || null,
      assignedTo: raw.assignedTo || null,
      assignedBy: raw.assignedBy || null,
      assignedAt: raw.assignedAt?.toDate?.()?.toISOString() || null,
    };
  });

  const nextCursor = reportDocs.length === queryLimit ? reportDocs[reportDocs.length - 1]?.id || null : null;

  return { reports, nextCursor };
});

// Get support report queue counters (moderator+)
export const getSupportReportSummary = functions.https.onCall(async (data, context) => {
  if (!context?.app?.appId) {
    console.log('getSupportReportSummary: missing App Check token, continuing with auth+rbac gate');
  }
  const callerUid = context?.auth?.uid;
  if (!callerUid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');

  const { valid } = await verifyRoleLevel(callerUid, ROLE_LEVELS.moderator);
  if (!valid) throw new functions.https.HttpsError('permission-denied', 'Moderator access required');

  const snap = await SUPPORT_REPORT_METRICS_REF.get();
  const metrics = snap.exists ? (snap.data() || {}) : {};
  const byCategory = metrics.byCategory || {};

  return {
    totalOpen: Number(metrics.totalOpen || 0),
    systemicOpen: Number(byCategory.systemic || 0),
    userRelatedOpen: Number(byCategory.user_related || 0),
    generalOpen: Number(byCategory.general || 0),
    updatedAt: metrics.updatedAt?.toDate?.()?.toISOString() || null,
  };
});

// Assign or unassign support report owner (moderator+)
export const assignReportToMe = functions.https.onCall(async (data, context) => {
  if (!context?.app?.appId) {
    console.log('assignReportToMe: missing App Check token, continuing with auth+rbac gate');
  }
  const callerUid = context?.auth?.uid;
  if (!callerUid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');

  const reportId = String(data?.reportId || '').trim();
  const action = String(data?.action || 'assign').trim().toLowerCase();
  if (!reportId) throw new functions.https.HttpsError('invalid-argument', 'Report ID is required');
  if (!['assign', 'unassign'].includes(action)) {
    throw new functions.https.HttpsError('invalid-argument', 'Action must be assign or unassign');
  }

  const { valid, role: callerRole, level: callerLevel } = await verifyRoleLevel(callerUid, ROLE_LEVELS.moderator);
  if (!valid) throw new functions.https.HttpsError('permission-denied', 'Moderator access required');

  const reportRef = db.collection('support_reports').doc(reportId);

  await db.runTransaction(async (tx) => {
    const reportSnap = await tx.get(reportRef);
    if (!reportSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Report not found');
    }

    const report = reportSnap.data() || {};
    const currentlyAssignedTo = String(report.assignedTo || '');

    if (action === 'assign') {
      tx.set(reportRef, {
        assignedTo: callerUid,
        assignedBy: callerUid,
        assignedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      const logRef = db.collection('moderation_logs').doc();
      tx.set(logRef, {
        type: 'report_assigned',
        actorUid: callerUid,
        actorRole: callerRole,
        reportId,
        previousAssignee: currentlyAssignedTo || null,
        assignedTo: callerUid,
        timestamp: FieldValue.serverTimestamp(),
      });
      return;
    }

    const isSelfAssigned = currentlyAssignedTo && currentlyAssignedTo === callerUid;
    const isAdminOrHigher = callerLevel >= ROLE_LEVELS.admin;
    if (!isSelfAssigned && !isAdminOrHigher) {
      throw new functions.https.HttpsError('permission-denied', 'Only assignee or admin can unassign this report');
    }

    tx.set(reportRef, {
      assignedTo: FieldValue.delete(),
      assignedBy: FieldValue.delete(),
      assignedAt: FieldValue.delete(),
    }, { merge: true });

    const logRef = db.collection('moderation_logs').doc();
    tx.set(logRef, {
      type: 'report_unassigned',
      actorUid: callerUid,
      actorRole: callerRole,
      reportId,
      previousAssignee: currentlyAssignedTo || null,
      timestamp: FieldValue.serverTimestamp(),
    });
  });

  return { ok: true };
});

// Resolve an open support report (moderator+ for user/general, admin+ for systemic)
export const resolveReport = functions.https.onCall(async (data, context) => {
  if (!context?.app?.appId) {
    console.log('resolveReport: missing App Check token, continuing with auth+rbac gate');
  }
  const callerUid = context?.auth?.uid;
  if (!callerUid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');

  const reportId = String(data?.reportId || '').trim();
  const resolutionNote = String(data?.resolutionNote || '').trim().slice(0, 1000);
  if (!reportId) throw new functions.https.HttpsError('invalid-argument', 'Report ID is required');

  const { valid, role: callerRole, level: callerLevel } = await verifyRoleLevel(callerUid, ROLE_LEVELS.moderator);
  if (!valid) throw new functions.https.HttpsError('permission-denied', 'Moderator access required');

  const reportRef = db.collection('support_reports').doc(reportId);
  const retentionUntil = Timestamp.fromDate(new Date(Date.now() + (2 * 365 * 24 * 60 * 60 * 1000)));
  const metricsRef = SUPPORT_REPORT_METRICS_REF;

  await db.runTransaction(async (tx) => {
    const reportSnap = await tx.get(reportRef);
    if (!reportSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Report not found');
    }

    const report = reportSnap.data() || {};
    const reportType = normalizeReportType(report.type);
    const reportCategory = String(report.category || getReportCategory(reportType));

    if (reportCategory === 'systemic' && callerLevel < ROLE_LEVELS.admin) {
      throw new functions.https.HttpsError('permission-denied', 'Only admin or superadmin can resolve systemic reports');
    }

    const logRef = db.collection('moderation_logs').doc();
    tx.set(logRef, {
      type: 'report_resolved',
      actorUid: callerUid,
      actorRole: callerRole,
      reportId,
      reportType,
      reportCategory,
      reporterUid: report.reporterUid || null,
      reportedUser: report.reportedUser || null,
      resolutionNote: resolutionNote || null,
      retentionUntil,
      timestamp: FieldValue.serverTimestamp(),
    });

    const metricsSnap = await tx.get(metricsRef);
    const metrics = metricsSnap.exists ? (metricsSnap.data() || {}) : {};
    const byCategory = metrics.byCategory || {};
    const currentTotal = Number(metrics.totalOpen || 0);
    const currentCategory = Number(byCategory[reportCategory] || 0);
    tx.set(metricsRef, {
      totalOpen: Math.max(0, currentTotal - 1),
      byCategory: {
        ...byCategory,
        [reportCategory]: Math.max(0, currentCategory - 1),
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    tx.delete(reportRef);
  });

  return { ok: true };
});

// Superadmin only: high-level user performance data for admin dashboard
export const getAdminPerformanceOverview = functions.https.onCall(async (data, context) => {
  const callerUid = context?.auth?.uid;
  if (!callerUid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');

  const { valid } = await verifyRoleLevel(callerUid, ROLE_LEVELS.moderator);
  if (!valid) throw new functions.https.HttpsError('permission-denied', 'Moderator access required');

  const limitCount = Math.min(Math.max(Number(data?.limitCount || 300), 1), 1000);

  // Top users by usage (capped sample for display) + exact counts via
  // aggregation queries (count() is billed ~1 read per 1000 docs indexed).
  const KNOWN_PLANS = ['free', 'basic', 'advanced', 'pro'];
  let ordered = true;
  let usersSnap;
  try {
    usersSnap = await db.collection('users').orderBy('uses_this_month', 'desc').limit(limitCount).get();
  } catch {
    ordered = false;
    usersSnap = await db.collection('users').limit(limitCount).get();
  }
  const [totalCountSnap, ...planCountSnaps] = await Promise.all([
    db.collection('users').count().get(),
    ...KNOWN_PLANS.map((p) => db.collection('users').where('plan', '==', p).count().get()),
  ]);

  const users = usersSnap.docs.map((d) => {
    const u = d.data() || {};
    return {
      uid: d.id,
      username: String(u.username || ''),
      email: String(u.email || ''),
      role: String(u.role || 'user'),
      plan: String(u.plan || 'free'),
      uses_this_month: Number(u.uses_this_month || 0),
      monthly_quota: Number(u.monthly_quota || 0),
      usage_period_end: typeof u.usage_period_end === 'string' ? u.usage_period_end : null,
      created_at: typeof u.created_at === 'string' ? u.created_at : null,
      isDemoUser: !!u.isDemoUser,
    };
  });

  if (!ordered) users.sort((a, b) => b.uses_this_month - a.uses_this_month);

  const plans = {};
  KNOWN_PLANS.forEach((p, i) => {
    plans[p] = planCountSnaps[i]?.data()?.count || 0;
  });
  const totalUsers = totalCountSnap.data()?.count || users.length;
  const counted = KNOWN_PLANS.reduce((s, p) => s + plans[p], 0);
  if (totalUsers > counted) plans.other = totalUsers - counted; // legacy/missing plan values

  return {
    users,
    summary: {
      totalUsers,
      planBreakdown: plans,
      totalUsesThisMonth: users.reduce((sum, u) => sum + Number(u.uses_this_month || 0), 0),
      usersShown: users.length,
    },
  };
});

// Admin/Superadmin: Reset a user's usage counters to 0
export const adminResetUserCounters = functions.https.onCall(async (data, context) => {
  const callerUid = context?.auth?.uid;
  if (!callerUid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');

  const { valid } = await verifyRoleLevel(callerUid, ROLE_LEVELS.admin);
  if (!valid) throw new functions.https.HttpsError('permission-denied', 'Admin access required');

  const { targetUid } = data || {};
  if (!targetUid || typeof targetUid !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'Target user ID required');
  }

  // Verify target user exists
  const userRef = db.collection('users').doc(targetUid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'User not found');
  }

  // Reset counters
  const countersRef = userRef.collection('meta').doc('counters');
  await countersRef.set({
    uses_this_month: 0,
    extra_uses_used: 0,
  }, { merge: true });

  // Log the action
  await logModerationAction({
    type: 'admin_reset_counters',
    actorUid: callerUid,
    targetUid,
    details: 'Reset usage counters to 0',
  });

  console.log(`[adminResetUserCounters] Admin ${callerUid} reset counters for user ${targetUid}`);
  return { ok: true, message: 'Counters reset to 0' };
});

// Admin/Superadmin: Search users by username or email
export const adminSearchUsers = functions.https.onCall(async (data, context) => {
  const callerUid = context?.auth?.uid;
  if (!callerUid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');

  const { valid } = await verifyRoleLevel(callerUid, ROLE_LEVELS.moderator);
  if (!valid) throw new functions.https.HttpsError('permission-denied', 'Moderator access required');

  const { query: searchQuery, limitCount = 50 } = data || {};
  if (!searchQuery || typeof searchQuery !== 'string' || searchQuery.trim().length < 2) {
    throw new functions.https.HttpsError('invalid-argument', 'Search query must be at least 2 characters');
  }

  const q = searchQuery.trim().toLowerCase();
  const limit = Math.min(Math.max(Number(limitCount), 1), 100);

  // Search by username (prefix match)
  const usernameSnap = await db.collection('users')
    .where('username', '>=', q)
    .where('username', '<=', q + '\uf8ff')
    .limit(limit)
    .get();

  // Search by email (prefix match)
  const emailSnap = await db.collection('users')
    .where('email', '>=', q)
    .where('email', '<=', q + '\uf8ff')
    .limit(limit)
    .get();

  // Combine results and dedupe
  const merged = new Map();
  for (const d of [...usernameSnap.docs, ...emailSnap.docs]) {
    if (!merged.has(d.id)) merged.set(d.id, d);
  }
  const matched = [...merged.values()];

  // Batch-fetch all counters docs in one call instead of N sequential reads
  const countersSnaps = matched.length
    ? await db.getAll(...matched.map((d) => d.ref.collection('meta').doc('counters')))
    : [];

  const users = matched.map((d, i) => {
    const u = d.data() || {};
    const counters = countersSnaps[i]?.exists ? (countersSnaps[i].data() || {}) : {};
    return {
      uid: d.id,
      username: String(u.username || ''),
      email: String(u.email || ''),
      role: String(u.role || 'user'),
      plan: String(u.plan || 'free'),
      uses_this_month: Number(counters.uses_this_month || 0),
      monthly_quota: Number(u.monthly_quota || 0),
      usage_period_end: typeof counters.usage_period_end === 'string' ? counters.usage_period_end : null,
      created_at: typeof u.created_at === 'string' ? u.created_at : null,
      isDemoUser: !!u.isDemoUser,
    };
  });

  users.sort((a, b) => b.uses_this_month - a.uses_this_month);

  return { users: users.slice(0, limit) };
});

// =============================
// GROUP MODERATION SYSTEM
// =============================

// Request moderator help for a group (creator only)
export const requestGroupModeratorHelp = functions.https.onCall(async (data, context) => {
  requireAppCheck(context);
  const uid = context?.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  
  const { groupId, reason } = data || {};
  if (!groupId) throw new functions.https.HttpsError('invalid-argument', 'Group ID required');
  
  // Verify caller is group creator
  const groupRef = db.collection('groups').doc(groupId);
  const groupSnap = await groupRef.get();
  
  if (!groupSnap.exists) throw new functions.https.HttpsError('not-found', 'Group not found');
  
  const groupData = groupSnap.data();
  if (groupData.createdBy !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Only group creator can request moderator help');
  }
  
  // Update group to allow moderator access
  await groupRef.update({
    moderatorAccessRequested: true,
    moderatorAccessRequestedAt: FieldValue.serverTimestamp(),
    moderatorAccessReason: reason || '',
  });
  
  // Notify moderators (create notification for all mods)
  const modsSnap = await db.collection('users')
    .where('role', 'in', ['moderator', 'admin', 'superadmin'])
    .limit(50)
    .get();
  
  const batch = db.batch();
  modsSnap.docs.forEach(modDoc => {
    const notifRef = db.collection('users').doc(modDoc.id).collection('notifications').doc();
    batch.set(notifRef, {
      type: 'group_help_request',
      groupId,
      groupName: groupData.name,
      requestedBy: uid,
      reason: reason || '',
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();
  
  return { ok: true };
});

// Revoke moderator access to group (creator only)
export const revokeGroupModeratorAccess = functions.https.onCall(async (data, context) => {
  requireAppCheck(context);
  const uid = context?.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  
  const { groupId } = data || {};
  if (!groupId) throw new functions.https.HttpsError('invalid-argument', 'Group ID required');
  
  // Verify caller is group creator
  const groupRef = db.collection('groups').doc(groupId);
  const groupSnap = await groupRef.get();
  
  if (!groupSnap.exists) throw new functions.https.HttpsError('not-found', 'Group not found');
  
  const groupData = groupSnap.data();
  if (groupData.createdBy !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Only group creator can revoke moderator access');
  }
  
  await groupRef.update({
    moderatorAccessRequested: false,
    moderatorAccessRevokedAt: FieldValue.serverTimestamp(),
  });
  
  return { ok: true };
});

// Sync user role from Firestore to custom claims (for initial setup or manual sync)
export const syncRoleClaim = functions.https.onCall(async (data, context) => {
  const uid = context?.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  
  // Get role from Firestore
  const userSnap = await db.collection('users').doc(uid).get();
  const userData = userSnap.exists ? userSnap.data() || {} : {};
  const role = userData.role || 'user';
  
  // Set custom claim
  const existingClaims = (await getAuth().getUser(uid)).customClaims || {};
  await getAuth().setCustomUserClaims(uid, { ...existingClaims, role });
  console.log(`[syncRoleClaim] Set role claim '${role}' for user ${uid}`);
  return { ok: true, role };
});

// Verify admin access (for hidden admin page)
export const verifyAdminAccess = functions
  .https.onCall(async (data, context) => {
  if (!context?.app?.appId) {
    console.log('verifyAdminAccess: missing App Check token, continuing with auth+password gate');
  }
  const uid = context?.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  
  const { adminPassword } = data || {};
  
  // First sync role claim from Firestore
  const userSnap = await db.collection('users').doc(uid).get();
  const userData = userSnap.exists ? userSnap.data() || {} : {};
  const firestoreRole = userData.role || 'user';
  const roleLevel = ROLE_LEVELS[firestoreRole] || 0;
  
  // Check role from Firestore directly (not claims)
  if (roleLevel < ROLE_LEVELS.moderator) {
    return { authorized: false, reason: 'insufficient_role' };
  }
  
  // Sync role to claims for future use
  try {
    const existingClaims = (await getAuth().getUser(uid)).customClaims || {};
    if (existingClaims.role !== firestoreRole) {
      await getAuth().setCustomUserClaims(uid, { ...existingClaims, role: firestoreRole });
    }
  } catch (e) {
    console.log('Claim sync skipped:', e?.message);
  }
  
  // Verify admin password (stored as env/secret)
  const ADMIN_PASSWORD = (process.env.ADMIN_DASHBOARD_PASSWORD || '').trim();
  if (!ADMIN_PASSWORD) {
    throw new functions.https.HttpsError('failed-precondition', 'Admin dashboard password is not configured');
  }
  const inputPassword = (adminPassword || '').trim();

  const inputBuffer = Buffer.from(inputPassword, 'utf8');
  const expectedBuffer = Buffer.from(ADMIN_PASSWORD, 'utf8');
  const passwordsMatch = inputBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(inputBuffer, expectedBuffer);

  if (!passwordsMatch) {
    return { authorized: false, reason: 'invalid_password' };
  }
  
  return { authorized: true, role: firestoreRole, level: roleLevel };
});


// =============================
// SIGNUP / PROMO CODE USAGE (owner-only superadmin)
// =============================

// The app has no dedicated signup-code field; the only codes users can redeem
// are Stripe promotion codes at checkout. This reports which customers used one.
const PROMO_STATS_EMAIL_ALLOWLIST = new Set([
  'admin@metastudy.com',
  'admin@metastudy.com',
]);

// Full calendar months elapsed between two unix-ms timestamps.
function wholeMonthsBetween(startMs, endMs) {
  const a = new Date(startMs);
  const b = new Date(endMs);
  let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) m -= 1;
  return Math.max(0, m);
}

export const getSignupCodeStats = functions
  .https.onCall(async (data, context) => {
    const callerUid = context?.auth?.uid;
    if (!callerUid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');

    // Both a superadmin role AND the explicit email allowlist are required.
    const { valid, userData } = await verifyRoleLevel(callerUid, ROLE_LEVELS.superadmin);
    const callerEmail = String(userData?.email || '').toLowerCase();
    if (!valid || !PROMO_STATS_EMAIL_ALLOWLIST.has(callerEmail)) {
      throw new functions.https.HttpsError('permission-denied', 'Restricted to account owners');
    }

    const stripe = getStripe();
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new functions.https.HttpsError('failed-precondition', 'Stripe not configured');
    }

    // Scan up to 500 subscriptions for applied discounts (promotion codes).
    const promoByCode = new Map(); // code -> {count, users:[...], tiers:{basic:n,...}, first, last}
    const customerToUser = new Map();
    let startingAfter = undefined;
    let scanned = 0;
    const MAX_SUBS = 500;

    while (scanned < MAX_SUBS) {
      const page = await stripe.subscriptions.list({
        status: 'all',
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
        expand: ['data.discount.promotion_code', 'data.customer'],
      });
      scanned += page.data.length;

      for (const sub of page.data) {
        const promo = sub.discount?.promotion_code;
        if (!promo) continue;
        const code = typeof promo === 'string' ? promo : (promo.code || promo.id);
        const customer = sub.customer && typeof sub.customer === 'object' ? sub.customer : null;
        const customerId = String(customer?.id || sub.customer || '');

        // Tier from the subscription's price, not the user's current plan (they may have upgraded since)
        const priceId = sub.items?.data?.[0]?.price?.id || '';
        const tierCfg = mapPlanByPriceId(priceId);
        const tier = tierCfg?.plan || 'unknown';
        const redeemedAt = sub.created ? sub.created * 1000 : null; // unix ms
        const subStart = (sub.start_date || sub.created) ? (sub.start_date || sub.created) * 1000 : null;
        const renewal = sub.current_period_end ? sub.current_period_end * 1000 : null;
        const subEnd = (sub.ended_at || sub.canceled_at) ? (sub.ended_at || sub.canceled_at) * 1000 : Date.now();
        // Counts the in-progress billing month, so a first-month sub shows 1.
        const months = subStart ? Math.max(1, wholeMonthsBetween(subStart, subEnd) + 1) : null;
        const subStatus = sub.cancel_at_period_end ? 'canceling' : (sub.status || 'unknown');

        let userInfo = customerToUser.get(customerId);
        if (userInfo === undefined) {
          userInfo = null;
          const uSnap = await db.collection('users').where('stripe_customer_id', '==', customerId).limit(1).get();
          if (!uSnap.empty) {
            const u = uSnap.docs[0].data() || {};
            userInfo = {
              uid: uSnap.docs[0].id,
              email: u.email || '',
              username: u.username || '',
              plan: u.plan || 'free',
              firstName: u.first_name || '',
              lastName: u.last_name || '',
            };
          }
          customerToUser.set(customerId, userInfo);
        }

        if (!promoByCode.has(code)) promoByCode.set(code, { count: 0, users: [], tiers: {}, first: null, last: null });
        const entry = promoByCode.get(code);
        entry.count += 1;
        entry.tiers[tier] = (entry.tiers[tier] || 0) + 1;
        if (redeemedAt) {
          if (!entry.first || redeemedAt < entry.first) entry.first = redeemedAt;
          if (!entry.last || redeemedAt > entry.last) entry.last = redeemedAt;
        }
        const userRow = {
          ...(userInfo || {
            customerId,
            email: customer?.email || '(customer not linked to a user)',
            firstName: String(customer?.name || '').split(' ')[0] || '',
            lastName: String(customer?.name || '').split(' ').slice(1).join(' '),
          }),
          tier,
          redeemedAt,
          status: subStatus,
          subStart,
          renewal,
          months,
        };
        entry.users.push(userRow);
      }

      if (!page.has_more || page.data.length === 0) break;
      startingAfter = page.data[page.data.length - 1].id;
    }

    const codes = [...promoByCode.entries()].map(([code, v]) => ({
      code,
      redemptionCount: v.count,
      tierBreakdown: v.tiers,
      firstRedemption: v.first,
      lastRedemption: v.last,
      users: v.users,
    }));
    codes.sort((a, b) => b.redemptionCount - a.redemptionCount);

    return {
      totalRedemptions: codes.reduce((s, c) => s + c.redemptionCount, 0),
      uniqueCodes: codes.length,
      subscriptionsScanned: scanned,
      codes,
    };
  });

// =============================
// ORPHANED USER DOC RECONCILE (owner-only superadmin)
// =============================

// Finds users/{uid} docs whose uid no longer exists in Firebase Auth
// (deleted before onAuthDelete existed, or whose cleanup failed midway).
// data.dryRun === true (default): report counts only. false: actually delete.
export const reconcileDeletedUsers = functions
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .https.onCall(async (data, context) => {
    const callerUid = context?.auth?.uid;
    if (!callerUid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');

    const { valid, userData } = await verifyRoleLevel(callerUid, ROLE_LEVELS.superadmin);
    const callerEmail = String(userData?.email || '').toLowerCase();
    if (!valid || !PROMO_STATS_EMAIL_ALLOWLIST.has(callerEmail)) {
      throw new functions.https.HttpsError('permission-denied', 'Restricted to account owners');
    }

    const dryRun = data?.dryRun !== false;

    // Collect all Firebase Auth uids (paginated, 1000/page)
    const authUids = new Set();
    let pageToken;
    do {
      const page = await getAuth().listUsers(1000, pageToken);
      page.users.forEach((u) => authUids.add(u.uid));
      pageToken = page.pageToken;
    } while (pageToken);

    // Scan users/ doc IDs only (select() = no field data read)
    const orphanUids = [];
    let totalUserDocs = 0;
    let lastDoc = null;
    while (true) {
      let q = db.collection('users').orderBy(FieldPath.documentId()).select().limit(500);
      if (lastDoc) q = q.startAfter(lastDoc);
      const snap = await q.get();
      if (snap.empty) break;
      totalUserDocs += snap.size;
      for (const d of snap.docs) {
        if (!authUids.has(d.id)) orphanUids.push(d.id);
      }
      lastDoc = snap.docs[snap.docs.length - 1];
      if (snap.size < 500) break;
    }

    const result = {
      dryRun,
      authUsers: authUids.size,
      userDocs: totalUserDocs,
      orphanedCount: orphanUids.length,
      orphanedUids: orphanUids.slice(0, 100),
    };

    if (dryRun || orphanUids.length === 0) {
      return { ...result, deleted: 0 };
    }

    // Mirror onAuthDelete cleanup for each orphan
    const firestore = getFirestore();
    let deleted = 0;
    for (const uid of orphanUids) {
      try {
        // Free any username mappings
        const taken = await db.collection('usernames').where('uid', '==', uid).get();
        if (!taken.empty) {
          const batch = db.batch();
          taken.docs.forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
        await firestore.recursiveDelete(db.collection('users').doc(uid));
        await Promise.allSettled([
          db.collection('public_profiles').doc(uid).delete(),
          firestore.recursiveDelete(db.collection('customers').doc(uid)),
        ]);
        deleted++;
      } catch (e) {
        console.error(`[reconcileDeletedUsers] failed to clean ${uid}:`, e?.message || e);
      }
    }

    console.log(`[reconcileDeletedUsers] ${callerUid} deleted ${deleted}/${orphanUids.length} orphaned user docs`);
    return { ...result, deleted };
  });
