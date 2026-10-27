# Payment and application review — 2026-10-15

## Deployment boundaries

`src/` is the browser/mobile frontend. Vite emits it to `dist/`, which Firebase
Hosting serves through its CDN. `public/` files retain their names; imported
`src/assets/` files get content hashes and are generally separate HTTP assets,
not bytes embedded in the main JavaScript bundle.

`functions/index.js` exports the deployed Firebase functions. `functions/server.js`
composes the API from `functions/routes/`. `server/server.js` is only a local
wrapper around that same API; it has no independent routes or CORS policy.
The existing GitHub workflows deploy Hosting only. Backend and rules changes need
a separate Firebase deployment.

## Payment flow and ownership

Set the **server** `BILLING_MODE` to `custom` (default) or `extension`. Match it
to the frontend's `VITE_USE_STRIPE_EXTENSION=false` or `true`, respectively.
The inspected production frontend configuration uses custom mode; the local
frontend configuration uses extension mode. Set local backend configuration
explicitly when testing extension mode. Unknown server mode values fail closed.

In custom mode:

1. An authenticated client requests a checkout through `/billing/create-checkout-session`
   or `/billing/create-addon-session`. Each endpoint uses its own price allowlist.
2. Stripe delivers a signed event to `stripeWebhook`. Only the backend grants
   plans or add-ons. `/billing/sync-session` verifies ownership and reports status;
   browser redirects do not grant entitlements.
3. `webhook_events/{event.id}` stores a processing lease or permanent completion
   receipt. Concurrent unfinished deliveries return 503 so Stripe retries.
   A failed or expired lease can be retried; an old worker cannot release a newer
   worker's lease.
4. Paid add-ons are validated against Stripe line items and `PRICE_ADDON_10`.
   Credit is `10 × quantity`. Missing configuration or failed Stripe reads do
   not grant a default credit. Unpaid checkout completion waits for
   `checkout.session.async_payment_succeeded`.
5. `billing_purchases/{stripeSessionId}` and the authoritative
   `users/{uid}/meta/counters.extra_uses_balance` commit together. This prevents
   duplicate credit across different event IDs, retries, and process failures.
6. Subscription effects use transactional receipts; renewal resets compare
   billing periods. Cancellation events for an old subscription cannot downgrade
   a newer recorded subscription. Duplicate-subscription cancellation errors are
   logged and returned for retry.

In extension mode, extension Firestore triggers own entitlement updates and the
direct webhook ignores entitlement events. The add-on trigger retrieves the
session from Stripe, checks its customer, and uses the same purchase ledger.
The deployed rules reject client-created checkout requests while custom billing
is active; extension mode needs an explicit configured-price allowlist before
re-enabling that write path. Custom checkout endpoints reject a mode mismatch.

Required configuration: `PRICE_BASIC`, `PRICE_ADVANCED`, `PRICE_PRO`,
`PRICE_ADDON_10`, and the existing Stripe secrets. Do not expire purchase or
completed webhook receipts. Legacy receipts without a status are treated as
completed to avoid replaying historically non-atomic purchases. Reconcile any
suspected historical missed or duplicated credits against Stripe; this change
does not infer historical balances or replay payments automatically.

The old review's `onAddonPurchase` is not a current function. The payment paths
above supersede that reference; `payments_flow.pdf` is not present in this checkout.

## Review disposition

| Concern | Current result |
| --- | --- |
| Initial JS and route loading | Routes, including admin, were already lazy. Study tabs now load independently too, with accessible loading feedback. Explicit vendor chunking avoids pulling PDF/charts into the landing page through shared helpers. |
| Static asset freshness | Hosting now requires revalidation by default; only hashed JS/CSS under `/assets/` get immutable caching. A live HEAD request on October 15 found the logo using `Cache-Control: max-age=3600`; the new policy requires deployment. |
| Bucket/CDN migration | Firebase Hosting already provides a CDN. Moving assets to another bucket is optional and needs an asset publishing workflow/domain; no bucket was provisioned. The AI disclosure now links to `/privacy`. |
| Dependencies/name/mobile | Root Stripe and billing packages were already removed; package name is `metastudy`. Capacitor is used by real Android/iOS projects and build scripts, so it stays. |
| TypeScript/environment | Strict TypeScript and typed environment variables were already enabled. Vite's strict env-name option is now enabled; API base normalization removes accidental trailing slashes. |
| SEO | Removed eight global JSON-LD blocks, the unsupported landing-page rating, and a generic Course claim. Route SEO owns structured data and removes its scripts on unmount. |
| Console output | Existing build configuration removes log/debug/info calls and keeps warnings/errors. |
| Draft writes | The named tools save drafts at explicit generation actions, not on every keystroke. A debounce is unnecessary at those call sites. |
| Large components | Backend responsibilities were already split into route/function modules. This change adds focused billing, usage, and Storage helpers and splits Study loading. Large frontend component internals remain maintenance debt; broad modal/state rewrites were not included in this security change. |
| Admin authorization | Reviewed cleanup/backfill callables already use role checks. Orphan post cleanup now paginates, preserves users without usernames or profiles, and aborts on lookup failures. |
| Account deletion | Both entry points already shared the full cleanup. Cleanup now reports failures, preserves the Auth account when prerequisite cleanup fails, paginates legacy social-reference scans, and never deletes files using a client-controlled avatar URL. Large legacy social graphs may still require a background deletion job. |
| Quota enforcement | AI generation reserves before calling the model, in a transaction that reads the current user quota. Failures do not allow free requests; failed calls refund their slot without reducing a new period's counter. Remaining generation endpoints and the OCR daily counter are covered. |
| Firestore protections | Fixed a recursive wildcard that could match the root user document and bypass field restrictions. Clients cannot reset billing counters, forge add-on balances, or write daily AI counters. Achievement writes remain supported. Explicit non-AI usage actions use `/usage/consume`. |
| Storage downloads | Only HTTPS Firebase Storage/GCS URLs or `gs://` paths parse. Handwriting-OCR reads enforce project bucket and caller-owned `users/{uid}/` prefix. |
| Dead routes/auth/helpers | Duplicate quiz routes, unreachable username/demo login bodies, and the null-only plan helper were already removed. Disabled auth endpoints still return explicit errors. |

## Dependency audit

The audio transcription feature (routes, quotas, and the `music-metadata`/`ffmpeg`/`multer` dependencies) was removed.
The frontend gRPC transitive dependency
was updated through a compatible 1.x override, removing its high-severity advisory.
The frontend audit decreased from 17 to **12 advisories (5 high, 7 moderate)**.

Remaining audit paths are `braces` through Tailwind/chokidar/micromatch,
`postcss-selector-parser` through Tailwind tooling, and `sprintf-js` through the
Mammoth CLI's argparse dependency. The registry offers no supported in-range
resolution for these trees. `npm audit fix --force` proposes old Firebase/Mammoth
versions; those breaking downgrades were not applied. Build tools process trusted
project sources, but the advisories remain tracked rather than suppressed.
The existing SheetJS package is the upstream 0.20.3 tarball; it is not the
abandoned npm-registry xlsx version referenced by older advisories.

## Validation and rollout

Local validation uses Node 22, Java 21, and only demo Firestore projects.
All **52 tests passed** with the Firestore emulator. TypeScript compilation,
ESLint error checks, backend syntax checks, and the production build passed.
Existing ESLint warnings remain. A Chromium smoke check rendered the landing,
privacy, auth, and checkout pages without JavaScript runtime errors; client-side
navigation to auth removed landing-page structured data. The landing page made
no requests for PDF, charts, Study, or admin chunks. The Study shell is about
66 kB before gzip, with its tools in separate chunks.

The emulator suite covers real concurrent quota reservations, duplicate/late
webhook delivery, worker leases, paid quantity, Stripe failures, account deletion
before fulfillment, refunds, and client permission boundaries. Stripe itself is
stubbed in these tests; no charges, emails, or production writes are made.

Before deploying:

1. Set matching billing modes and confirm all four server price IDs. Inspect
   Stripe Dashboard and installed Firebase extensions to confirm the selected
   integration and webhook events, including delayed payment success.
2. Deploy the collection-group indexes in `firestore.indexes.json` and wait for
   them to finish building; deletion filters need them in production (the emulator
   does not enforce indexes). Deploy backend functions before releasing the frontend that calls
   `/usage/consume`; publish the frontend and restrictive Firestore rules in the
   same release window. Refresh existing browser sessions. Hosting-only CI does
   not deploy backend functions, indexes, or rules.
3. In Stripe test mode, exercise subscription checkout, plan change, cancellation,
   add-on purchase/replay, a declined or delayed payment, and account deletion.
   Confirm the quota counter receives one credit and that unsupported prices fail.
4. Recheck deployed Cache-Control headers and Firestore permissions. Reconcile
   historical credit discrepancies separately. Monitor webhook retries and cleanup
   failures; neither is silently acknowledged as success.

The reviewed release was deployed to `metastudy-e1ba2`: indexes, functions,
Firestore rules, Storage rules, and Hosting. Stripe Dashboard configuration was
not changed during this review. Asset bucket migration and a full decomposition
of large frontend components remain separate implementation work.
