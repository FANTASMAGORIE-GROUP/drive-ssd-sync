// Écrit secrets.json à partir des variables d'environnement (utilisé par la CI avant la compilation).
const fs = require('fs');
const path = require('path');

// La clé OpenAI n'est jamais intégrée : elle est saisie dans l'app au premier lancement.
const cles = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'OPENAI_MODEL'];
const secrets = Object.fromEntries(cles.filter((c) => process.env[c]).map((c) => [c, process.env[c]]));
for (const c of cles.slice(0, 2)) if (!secrets[c]) throw new Error(`Variable manquante : ${c}`);
fs.writeFileSync(path.join(__dirname, '..', 'secrets.json'), JSON.stringify(secrets, null, 2));
console.log('secrets.json écrit');
