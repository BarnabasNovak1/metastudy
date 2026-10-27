import { functions } from './lib/shared.js';
import { app } from './server.js';


export const api = functions
  .runWith({
    timeoutSeconds: 540,
    memory: '2GB',
  })
  .https.onRequest(app);
