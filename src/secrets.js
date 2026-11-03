// Clés injectées au moment de la compilation (secrets.json, jamais commité).
let secrets = {};
try { secrets = require('../secrets.json'); } catch { /* pas encore configuré */ }

module.exports = {
  GOOGLE_CLIENT_ID: secrets.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: secrets.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
  OPENAI_API_KEY: secrets.OPENAI_API_KEY || process.env.OPENAI_API_KEY,
  OPENAI_MODEL: secrets.OPENAI_MODEL || process.env.OPENAI_MODEL || 'gpt-5-mini',
};
