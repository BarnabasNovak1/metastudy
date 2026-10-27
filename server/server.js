// Local-dev wrapper. All API endpoints live in ../functions/server.js - this
// file only enables standalone mode and imports that app, so local dev and
// Firebase Functions always run the same code.
process.env.EXPRESS_STANDALONE = 'true';
await import('../functions/server.js');
