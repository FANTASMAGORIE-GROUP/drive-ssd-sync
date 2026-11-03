// Demande à OpenAI quelles colonnes de la ligne du disque remplir avec les infos mesurées.
const secrets = require('./secrets');

const CONSIGNES = `Tu remplis la ligne d'un disque dur dans un tableau Google Sheets.
On te donne les en-têtes de colonnes, la ligne actuelle et les infos mesurées sur le disque.
Réponds en JSON : {"maj": {"<en-tête exact>": <valeur>}}.
Règles :
- Remplis uniquement les colonnes qui correspondent à une info mesurée (capacité, utilisé, restant, pourcentage, projets/dossiers).
- Capacité, utilisé et restant sont en To : renvoie des nombres. Le pourcentage est un nombre sans le signe %.
- Pour les projets, renvoie la liste des dossiers séparés par des retours à la ligne.
- Ne touche jamais aux colonnes de localisation, contenu, état, sauvegarde ou aux notes écrites à la main.
- Ne renvoie pas une colonne dont la valeur ne change pas.`;

async function proposerMaj(entetes, ligneActuelle, disque) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${secrets.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: secrets.OPENAI_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: CONSIGNES },
        { role: 'user', content: JSON.stringify({ entetes, ligne_actuelle: ligneActuelle, disque }) },
      ],
    }),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.error?.message || `Erreur OpenAI ${r.status}`);
  return JSON.parse(json.choices[0].message.content).maj || {};
}

module.exports = { proposerMaj };
