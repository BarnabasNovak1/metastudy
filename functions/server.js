// ================================================================
// server.js - composition root for the Express API.
// The app, global middleware, Firebase Admin, Llama/Stripe clients and
// all shared helpers live in routes/shared.js. Route handlers live in
// routes/*.js and are registered below; global middleware was applied
// first inside routes/shared.js, same as the original monolith.
// ================================================================
import { app as expressApp } from './routes/shared.js';
import { register as registerStudy } from './routes/study.js';
import { register as registerCareer } from './routes/career.js';
import { register as registerBilling } from './routes/billing.js';
import { register as registerAccount } from './routes/account.js';
import { register as registerTutor } from './routes/tutor.js';

export const app = expressApp;

registerStudy(app);
registerCareer(app);
registerBilling(app);
registerAccount(app);
registerTutor(app);

// Only run a local server when explicitly asked; Firebase Functions will handle HTTP in production
if (process.env.EXPRESS_STANDALONE === 'true') {
  const port = process.env.PORT || 4247;
  app.listen(port, () => console.log(`API running on http://localhost:${port}`));
}
