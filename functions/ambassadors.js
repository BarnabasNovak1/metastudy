import { functions, db, Resend, escapeHtml } from './lib/shared.js';
import { FieldValue } from 'firebase-admin/firestore';

// =============================
// AMBASSADOR / AFFILIATE PROGRAM
// =============================

const str = (v, max) => String(v || '').slice(0, max);

const OWNER_EMAIL = 'admin@metastudy.com';

// Submit ambassador application (public - no auth required)
export const submitAmbassadorApplication = functions
  .https.onCall(async (data, context) => {
  const { name, email, roleType, school, socials, audienceSize, message } = data || {};

  // Honeypot: bots fill the hidden 'website' field; humans never see it
  if (data?.website) {
    console.log('[submitAmbassadorApplication] Honeypot triggered, silently ignoring');
    return { ok: true, applicationId: null };
  }

  if (!name?.trim()) {
    throw new functions.https.HttpsError('invalid-argument', 'Name is required');
  }
  if (!email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim()) || String(email).length > 254) {
    throw new functions.https.HttpsError('invalid-argument', 'Valid email is required');
  }

  // Flood control: max 3 applications per email per day
  const normalizedEmail = String(email).trim().toLowerCase();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await db.collection('ambassador_applications')
    .where('email', '==', normalizedEmail)
    .where('submittedAt', '>', dayAgo)
    .count().get()
    .catch(() => null);
  if (recent && recent.data().count >= 3) {
    throw new functions.https.HttpsError('resource-exhausted', 'Too many applications submitted. Please try again later.');
  }

  const appRef = db.collection('ambassador_applications').doc();
  await appRef.set({
    name: str(name, 120).trim(),
    email: normalizedEmail,
    roleType: str(roleType, 60).trim(),
    school: str(school, 200).trim(),
    socials: str(socials, 500).trim(),
    audienceSize: str(audienceSize, 60).trim(),
    message: str(message, 5000).trim(),
    status: 'open',
    submittedAt: FieldValue.serverTimestamp(),
    submittedBy: context?.auth?.uid || null,
  });

  console.log(`[submitAmbassadorApplication] New application from ${normalizedEmail}`);

  // Notify owner (best-effort)
  const RESEND_KEY = (process.env.RESEND_API_KEY || '').trim();
  if (RESEND_KEY) {
    try {
      const resend = new Resend(RESEND_KEY);
      await resend.emails.send({
        from: 'MetaStudy <noreply@metastudy.com>',
        to: [OWNER_EMAIL],
        replyTo: normalizedEmail,
        subject: `New Ambassador Application: ${str(name, 120).trim()}`,
        html: `
          <h2>New Ambassador Application</h2>
          <p><strong>Name:</strong> ${escapeHtml(str(name, 120).trim())} &lt;${escapeHtml(normalizedEmail)}&gt;</p>
          <p><strong>Role:</strong> ${escapeHtml(str(roleType, 60).trim() || 'Not specified')}</p>
          <p><strong>School/Org:</strong> ${escapeHtml(str(school, 200).trim() || 'Not specified')}</p>
          <p><strong>Socials:</strong> ${escapeHtml(str(socials, 500).trim() || 'Not specified')}</p>
          <p><strong>Audience size:</strong> ${escapeHtml(str(audienceSize, 60).trim() || 'Not specified')}</p>
          <hr />
          <h3>Message:</h3>
          <p style="white-space: pre-wrap;">${escapeHtml(str(message, 5000).trim() || '(none)')}</p>
          <hr />
          <p style="color:#666;font-size:12px;">View and reply in the admin dashboard → Applications tab.</p>
        `,
        text: `New Ambassador Application\n\nName: ${str(name, 120).trim()} <${normalizedEmail}>\nRole: ${str(roleType, 60).trim() || '-'}\nSchool: ${str(school, 200).trim() || '-'}\nSocials: ${str(socials, 500).trim() || '-'}\nAudience: ${str(audienceSize, 60).trim() || '-'}\n\nMessage:\n${str(message, 5000).trim() || '(none)'}`,
      });
    } catch (e) {
      console.error('[submitAmbassadorApplication] Owner notification failed:', e?.message || e);
    }
  }

  return { ok: true, applicationId: appRef.id };
});