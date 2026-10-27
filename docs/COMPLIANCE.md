# MetaStudy - Privacy & Compliance Implementation Map

Last updated: 2026-08-19

This document maps FERPA / COPPA / GDPR requirements to the **actual code** that
implements them, plus documented operational procedures. It is the internal
source of truth for vendor reviews (schools), the public Trust Center, and
future legal review.

> Status legend: ✅ implemented in code · 📄 documented/process · ⚠️ requires
> legal/contractual action outside of code.

---

## 1. Privacy-by-design architecture

| Control | Status | Implementation |
|---|---|---|
| Private by default - chats, quizzes, flashcards, summaries, lessons are owner-only | ✅ | `firestore.rules`: `users/{uid}` and all subcollections readable/writable only by the owner (or admin role claim). Content becomes visible to others **only** when the user explicitly shares it to the feed (`shared: true` + `feed_posts` doc). |
| Minimal public data | ✅ | `public_profiles/{uid}` mirror contains only safe fields (username, photo, bio, education level, XP, streak, challenge/friend counts). Maintained server-side by Cloud Function triggers in `functions/index.js` (`mirrorPublicProfile*`). Clients never read other users' private `users/{uid}` docs. |
| Server-side authorization on every privileged action | ✅ | All admin/moderation callables in `functions/index.js` verify the caller's **role custom claim** server-side on each invocation. The admin dashboard password gate (`verifyAdminAccess`) is defense-in-depth for the UI only. |
| Encryption | ✅ | Firebase/GCP encrypts all data at rest (AES-256) and in transit (TLS 1.2+). No plaintext secrets in the client; API keys are held in Cloud Functions config/env. |
| Least-privilege storage | ✅ | Storage rules restrict `users/{uid}/**` uploads (avatars, note photos) to the owner. |

## 2. User data controls (GDPR Arts. 15-21, CCPA)

| Right | Status | Implementation |
|---|---|---|
| Access / portability (Art. 15, 20) | ✅ | "Download my data" in Account → Settings (`src/components/PrivacyCenter.tsx`) calls the `exportMyData` callable, which returns the user's full dataset (profile, chats, study materials, achievements, posts) as JSON. |
| Erasure (Art. 17) | ✅ | "Delete my account" (`PrivacyCenter` → `deleteAccountFull` callable) permanently deletes the Auth user, `users/{uid}` tree, `public_profiles/{uid}`, feed posts, uploaded Storage files, and cancels any Stripe subscription. |
| Erasure of chats only | ✅ | `deleteAllChats` callable (server-side recursive delete of all chat sessions/messages). |
| Storage limitation (Art. 5(1)(e)) | ✅ | Chat auto-deletion: user-selectable retention (keep / 30 / 90 days) stored as `chat_retention_days`; enforced by the scheduled `enforceChatRetention` Cloud Function. |
| Rectification (Art. 16) | ✅ | Users can edit profile fields, username (once/year), and delete individual items in-app. |
| Objection / restriction / appeal | ✅📄 | Privacy requests (access, correction, deletion, appeal) are accepted via the Report Issue tool (footer, all pages), which has a dedicated **"Privacy Request"** category, and reviewed in the admin dashboard reports queue. |

## 3. COPPA (children under 13)

| Requirement | Status | Implementation |
|---|---|---|
| No collection from under-13s | ✅ | Signup requires an explicit **13+ age attestation** checkbox (`src/pages/Auth.tsx`), for both email and Google signup (Google gate modal). Accounts cannot be created without it. |
| Actual-knowledge handling | 📄 | Procedure: if we obtain actual knowledge a user is under 13, the account is deleted via `deleteAccountFull` and the event is logged. Reports come in via the Report Issue tool. |
| No behavioral advertising | ✅ | The product shows no ads. Google Analytics (GA4) and the Google Ads conversion tag load **only after explicit cookie-banner consent** (`index.html` + `src/components/CookieConsent.tsx` `loadGoogleTags`), always with `allow_ad_personalization_signals: false`. Declining removes and disables both tags; the purchase conversion event (`CheckoutSuccess.tsx`) is also consent-gated. |

## 4. FERPA (US school deployments)

| Requirement | Status | Implementation |
|---|---|---|
| School official / limited-use posture | 📄 | Documented in the public Trust Center (`src/pages/TrustPage.tsx`): data is used only to provide the service, never sold, no ads. |
| Institution accounts with domain control | ✅ | Institution sign-in mode with domain-verified emails and custom email confirmation (`confirmInstitutionEmail`, `EmailVerificationGate`). |
| Data destruction on request | ✅ | `deleteAccountFull` + export tooling satisfy return/destruction of education records for individual accounts. |
| Written agreements (DPA / school contracts) | ⚠️ | Requires a signed Data Processing Agreement per district - legal template needed; not solvable in code. Trust Center provides the vendor-review entry point. |

## 5. GDPR organizational measures

| Requirement | Status | Implementation |
|---|---|---|
| Lawful basis + consent records | ✅ | Signup persists the consent record on `users/{uid}` via the `reserveUsername` Cloud Function (server timestamp; clients cannot write these fields): `tos_accepted_at`, `tos_version`, `age_attested_13_plus`. Applies to both email and Google signup flows (`src/pages/Auth.tsx`). |
| Transparency | ✅ | Public pages: `/privacy`, `/terms`, `/security`, `/responsible-ai`, `/trust` (linked in footer - open in a new tab - and home nav). |
| Data minimization | ✅ | `public_profiles` mirror (see §1); first-party usage counters; GA4/Ads measurement only after cookie consent with ad personalization disabled. |
| Processor inventory | 📄 | Google Firebase/GCP (hosting, auth, database, storage, functions), Stripe (payments), Meta Llama API (content generation + image OCR). Resend (email), Sentry (error monitoring). |
| Image/note uploads not persisted | ✅ | `/vision-extract` (`functions/server.js`) receives images as in-memory base64, forwards them to the Llama API for OCR, and returns only extracted text. Images are never written to Firestore or Cloud Storage; no request-body logging exists. Only the extracted text may be saved (e.g., chat context) subject to normal retention controls. |
| Breach response | 📄 | Documented in `/security` page: incident response commitment; admin logging (`admin_logs` collection) provides an audit trail. |
| DPO / EU representative, RoPA, DPIA | ⚠️ | Organizational/legal steps - pending legal review. |

## 6. Security controls

- **Access control**: Firebase Auth + Firestore rules (owner-only), role custom claims for staff, admin UI double-gated (auth + `verifyAdminAccess` password, session-scoped). The owner-only / share-gated model is verified by automated emulator tests (`tests/rules/firestore.rules.test.ts`, run in CI on every PR).
- **Audit logging**: admin actions written to `admin_logs`.
- **Abuse/reporting**: in-app Report Issue tool; moderation queue in admin dashboard.
- **API security**: all privileged operations are Cloud Functions callables validating `context.auth` and role claims; no client-trusted authorization.
- **Error monitoring**: Sentry on the backend (`@sentry/node` in Cloud Functions) and the client (`@sentry/react`, initialized only when `VITE_SENTRY_DSN` is set, errors only - no session replay or user-content tracing). A React `ErrorBoundary` catches render crashes and reports them.

## 7. Documented procedures (operational runbook)

1. **Privacy request intake**: Report Issue → admin reports queue → resolve within 30 days (GDPR) / 45 days (CCPA). Access/export → point user to self-serve "Download my data". Deletion → self-serve or admin-run `deleteAccountFull`.
2. **Under-13 report**: verify, delete account, log, respond to reporter.
3. **School vendor review**: direct to `/trust`; provide this document and policy PDFs; execute DPA (⚠️ template pending).
4. **Incident response**: contain → assess scope via `admin_logs`/GCP audit logs → notify affected users and authorities within 72h where required.
5. **One-time migrations** (already run 2026-08): `backfillPublicProfiles` (132 processed), `backfillSharedFlags` (5 updated) - both idempotent, re-runnable from Admin → Maintenance.

## 8. Known gaps (honest list)

- ⚠️ DPA / school contract template - needs counsel.
- ⚠️ Formal DPIA + Records of Processing Activities - needs counsel.
- ⚠️ External legal review of policy pages - recommended before marketing to EU schools.
