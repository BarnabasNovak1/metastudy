import { functions, db, Resend, escapeHtml } from './lib/shared.js';
import { FieldValue } from 'firebase-admin/firestore';


// =============================
// INSTITUTION INQUIRY SYSTEM
// =============================

const str = (v, max) => String(v || '').slice(0, max);

// Submit institution pricing inquiry (public - no auth required for initial contact)
export const submitInstitutionInquiry = functions
  .https.onCall(async (data, context) => {
  const { 
    institutionName, 
    contactName, 
    contactEmail, 
    estimatedUsers, 
    preferredPlan, 
    message 
  } = data || {};
  
  // Honeypot: bots fill the hidden 'website' field; humans never see it
  if (data?.website) {
    console.log('[submitInstitutionInquiry] Honeypot triggered, silently ignoring');
    return { ok: true, inquiryId: null };
  }

  if (!institutionName?.trim()) {
    throw new functions.https.HttpsError('invalid-argument', 'Institution name is required');
  }
  if (!contactName?.trim()) {
    throw new functions.https.HttpsError('invalid-argument', 'Contact name is required');
  }
  if (!contactEmail?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(contactEmail).trim()) || String(contactEmail).length > 254) {
    throw new functions.https.HttpsError('invalid-argument', 'Valid contact email is required');
  }
  
  // Cheap flood control: max 5 inquiries per email per day
  const normalizedEmail = String(contactEmail).trim().toLowerCase();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await db.collection('institution_inquiries')
    .where('contactEmail', '==', normalizedEmail)
    .where('submittedAt', '>', dayAgo)
    .count().get()
    .catch(() => null);
  if (recent && recent.data().count >= 5) {
    throw new functions.https.HttpsError('resource-exhausted', 'Too many inquiries submitted. Please try again later.');
  }

  const inquiryRef = db.collection('institution_inquiries').doc();
  await inquiryRef.set({
    institutionName: str(institutionName, 200).trim(),
    contactName: str(contactName, 120).trim(),
    contactEmail: normalizedEmail,
    estimatedUsers: Math.min(Math.max(Number(estimatedUsers) || 0, 0), 1000000),
    preferredPlan: str(preferredPlan, 50).trim(),
    message: str(message, 5000).trim(),
    status: 'open',
    submittedAt: FieldValue.serverTimestamp(),
    submittedBy: context?.auth?.uid || null,
  });
  
  console.log(`[submitInstitutionInquiry] New inquiry from ${contactEmail} for ${institutionName}`);

  // Notify owner that a new inquiry arrived (best-effort; failures don't block the submit)
  const RESEND_KEY = (process.env.RESEND_API_KEY || '').trim();
  if (RESEND_KEY) {
    try {
      const resend = new Resend(RESEND_KEY);
      const planLabel = { basic: 'Basic ($9.99/user/mo)', advanced: 'Advanced ($16.99/user/mo)', pro: 'Pro ($19.99/user/mo)', mixed: 'Mixed', unsure: 'Not sure yet' }[str(preferredPlan, 50).trim()] || str(preferredPlan, 50).trim() || 'Not specified';
      await resend.emails.send({
        from: 'MetaStudy <noreply@metastudy.com>',
        to: ['admin@metastudy.com'],
        replyTo: normalizedEmail,
        subject: `New Institution Inquiry: ${str(institutionName, 200).trim()}`,
        html: `
          <h2>New Institution Inquiry</h2>
          <p><strong>Institution:</strong> ${escapeHtml(str(institutionName, 200).trim())}</p>
          <p><strong>Contact:</strong> ${escapeHtml(str(contactName, 120).trim())} &lt;${escapeHtml(normalizedEmail)}&gt;</p>
          <p><strong>Estimated Users:</strong> ${Number(estimatedUsers) || 'Not specified'}</p>
          <p><strong>Preferred Plan:</strong> ${escapeHtml(planLabel)}</p>
          <hr />
          <h3>Message:</h3>
          <p style="white-space: pre-wrap;">${escapeHtml(str(message, 5000).trim() || '(none)')}</p>
          <hr />
          <p style="color:#666;font-size:12px;">View and reply in the admin dashboard → Inquiries tab.</p>
        `,
        text: `New Institution Inquiry\n\nInstitution: ${str(institutionName, 200).trim()}\nContact: ${str(contactName, 120).trim()} <${normalizedEmail}>\nEstimated Users: ${Number(estimatedUsers) || 'Not specified'}\nPreferred Plan: ${planLabel}\n\nMessage:\n${str(message, 5000).trim() || '(none)'}\n\nReply in the admin dashboard → Inquiries tab.`,
      });
    } catch (e) {
      console.error('[submitInstitutionInquiry] Owner notification email failed:', e?.message || e);
    }
  }

  return { ok: true, inquiryId: inquiryRef.id };
});