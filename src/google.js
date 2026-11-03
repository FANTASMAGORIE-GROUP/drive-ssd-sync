// Connexion Google (OAuth « application de bureau » avec PKCE) et accès à l'API Sheets.
const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');
const secrets = require('./secrets');
const store = require('./store');

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function connecter() {
  return new Promise((resolve, reject) => {
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const serveur = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const code = url.searchParams.get('code');
      if (!code && !url.searchParams.get('error')) { res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<p style="font-family:sans-serif;text-align:center;margin-top:20vh">C\'est bon ! Tu peux revenir dans l\'app 💾</p>');
      serveur.close();
      if (!code) return reject(new Error('Connexion annulée'));
      try {
        const jeton = await demanderJeton({
          code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirect,
        });
        store.set('google', { refresh_token: jeton.refresh_token });
        resolve();
      } catch (e) { reject(e); }
    });
    let redirect;
    serveur.listen(0, '127.0.0.1', () => {
      redirect = `http://127.0.0.1:${serveur.address().port}`;
      const params = new URLSearchParams({
        client_id: secrets.GOOGLE_CLIENT_ID, redirect_uri: redirect, response_type: 'code', scope: SCOPE,
        code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent',
      });
      shell.openExternal(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
    });
  });
}

async function demanderJeton(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: secrets.GOOGLE_CLIENT_ID, client_secret: secrets.GOOGLE_CLIENT_SECRET, ...params }),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.error_description || json.error);
  return json;
}

let cache = { token: null, expire: 0 };
async function accessToken() {
  if (cache.token && Date.now() < cache.expire) return cache.token;
  const g = store.get('google');
  if (!g) throw new Error('Pas connectée à Google');
  const j = await demanderJeton({ refresh_token: g.refresh_token, grant_type: 'refresh_token' });
  cache = { token: j.access_token, expire: Date.now() + (j.expires_in - 60) * 1000 };
  return cache.token;
}

async function api(chemin, options = {}) {
  const r = await fetch(`${API}/${chemin}`, {
    ...options,
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.error?.message || `Erreur Google ${r.status}`);
  return json;
}

const plage = (onglet, cellules) => encodeURIComponent(`'${onglet.replace(/'/g, "''")}'!${cellules}`);

const sheets = {
  idDepuisLien: (lien) => (lien.match(/\/d\/([a-zA-Z0-9_-]+)/) || [])[1],
  titres: async (id) => {
    const j = await api(`${id}?fields=properties.title,sheets.properties.title`);
    return { titre: j.properties.title, onglets: j.sheets.map((s) => s.properties.title) };
  },
  lire: async (id, onglet, cellules, rendu = 'FORMULA') =>
    (await api(`${id}/values/${plage(onglet, cellules)}?valueRenderOption=${rendu}`)).values || [],
  ecrire: (id, onglet, cellules, valeurs) =>
    api(`${id}/values/${plage(onglet, cellules)}?valueInputOption=USER_ENTERED`, {
      method: 'PUT', body: JSON.stringify({ values: valeurs }),
    }),
  ajouterLigne: (id, onglet, ligne) =>
    api(`${id}/values/${plage(onglet, 'A1')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
      method: 'POST', body: JSON.stringify({ values: [ligne] }),
    }),
  creerOnglet: (id, titre) =>
    api(`${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: titre } } }] }) }),
};

module.exports = { connecter, sheets, estConnecte: () => !!store.get('google') };
