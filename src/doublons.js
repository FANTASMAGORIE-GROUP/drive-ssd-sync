// Doublons de fichiers, dans un même SSD et entre SSD.
// La liste des fichiers de chaque SSD est gardée dans un onglet caché du fichier Google : ainsi un SSD
// lu sur un autre ordinateur est quand même comparé aux autres.
// Doublon = même nom (sans tenir compte des majuscules) et même taille, à partir de 1 Mo.
const zlib = require('zlib');

const SEUIL = 1e6;
const INDEX = 'Index fichiers (app)';
const DOUBLONS = 'Doublons';
const MORCEAU = 45000; // une case Google Sheets contient au plus 50 000 caractères
const DEBUT = 4;       // colonnes A à D : n° de série, n°, date, nombre de fichiers
const MAX_LIGNES = 990;

const go = (octets) => +(octets / 1e9).toFixed(2);

function encoder(fichiers) {
  const b = zlib.gzipSync(JSON.stringify(fichiers.filter(([, t]) => t >= SEUIL))).toString('base64');
  const morceaux = [];
  for (let i = 0; i < b.length; i += MORCEAU) morceaux.push(b.slice(i, i + MORCEAU));
  return morceaux;
}

function decoder(morceaux) {
  try { return JSON.parse(zlib.gunzipSync(Buffer.from(morceaux.join(''), 'base64'))); } catch { return []; }
}

async function onglet(sheets, id, titre, cache, entetes) {
  const t = await sheets.titres(id);
  if (t.onglets.includes(titre)) return { sheetId: t.ids[titre], colonnes: t.colonnes[titre] };
  await sheets.creerOnglet(id, titre, cache);
  const sheetId = (await sheets.titres(id)).ids[titre];
  await sheets.ecrire(id, titre, 'A1', [entetes], 'RAW');
  await sheets.miseEnForme(id, [
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
    { repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
      cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.8, green: 0.8, blue: 0.8 } } },
      fields: 'userEnteredFormat(textFormat,backgroundColor)',
    } },
  ]);
  return { sheetId, colonnes: 26 };
}

// Remplace la liste des fichiers de ce SSD dans l'onglet caché.
async function enregistrer(sheets, id, serial, numero, fichiers) {
  const { sheetId, colonnes } = await onglet(sheets, id, INDEX, true,
    ['SSD (n° de série)', 'N°', 'Lu le', 'Fichiers', "Liste des fichiers de plus de 1 Mo (compressée, lue par l'app)"]);
  const morceaux = encoder(fichiers);
  const besoin = DEBUT + morceaux.length;
  if (besoin > colonnes) {
    await sheets.miseEnForme(id, [{ appendDimension: { sheetId, dimension: 'COLUMNS', length: besoin - colonnes } }]);
  }
  const serials = await sheets.lire(id, INDEX, 'A1:A1000', 'FORMATTED_VALUE');
  let ligne = serials.findIndex((l, i) => i > 0 && String(l[0] ?? '') === serial);
  if (ligne < 0) ligne = Math.max(1, serials.length);
  const n = ligne + 1;
  await sheets.effacer(id, INDEX, `${n}:${n}`);
  await sheets.ecrire(id, INDEX, `A${n}`,
    [[serial, String(numero), new Date().toLocaleDateString('fr-FR'), fichiers.length, ...morceaux]], 'RAW');
}

const lettre = (i) => (i >= 26 ? lettre(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));

async function toutLire(sheets, id) {
  const t = await sheets.titres(id);
  if (!t.onglets.includes(INDEX)) return [];
  // Google refuse une plage plus large que la feuille : on s'arrête à sa dernière colonne.
  const lignes = await sheets.lire(id, INDEX, `A2:${lettre((t.colonnes[INDEX] || 26) - 1)}1000`, 'FORMATTED_VALUE');
  return lignes.filter((l) => l[0]).map((l) => ({
    serial: String(l[0]),
    numero: String(l[1] ?? ''),
    fichiers: decoder(l.slice(DEBUT).filter(Boolean)),
  }));
}

// entrees : [{ serial, numero, fichiers: [[chemin, taille]] }] → groupes de copies, les plus coûteux d'abord.
function calculer(entrees) {
  const groupes = new Map();
  for (const e of entrees) {
    for (const [chemin, taille] of e.fichiers) {
      if (!(taille >= SEUIL)) continue;
      const nom = String(chemin).split('/').pop();
      const cle = `${nom.toLowerCase()}|${taille}`;
      if (!groupes.has(cle)) groupes.set(cle, { nom, taille, copies: [] });
      groupes.get(cle).copies.push({ serial: e.serial, numero: e.numero, chemin });
    }
  }
  return [...groupes.values()]
    .filter((g) => g.copies.length > 1)
    .map((g) => ({ ...g, entreSsd: new Set(g.copies.map((c) => c.serial)).size > 1, perdu: g.taille * (g.copies.length - 1) }))
    .sort((a, b) => b.perdu - a.perdu);
}

async function ecrireOnglet(sheets, id, groupes) {
  const { sheetId } = await onglet(sheets, id, DOUBLONS, false,
    ['Fichier', 'Taille (Go)', 'Copies', 'Où (n° du disque : chemin)', 'Type', 'Place en trop (Go)']);
  await sheets.effacer(id, DOUBLONS, 'A2:F');
  const lignes = groupes.slice(0, MAX_LIGNES).map((g) => [
    g.nom, go(g.taille), g.copies.length,
    g.copies.map((c) => `n°${c.numero || '?'} : ${c.chemin}`).join('\n').slice(0, MORCEAU),
    g.entreSsd ? 'Entre SSD' : 'Dans le même SSD', go(g.perdu),
  ]);
  if (lignes.length) await sheets.ecrire(id, DOUBLONS, 'A2', lignes, 'RAW');
  return sheetId;
}

// Ce qui concerne le SSD branché, pour l'afficher dans l'app.
function resume(groupes, serial) {
  const miens = groupes.filter((g) => g.copies.some((c) => c.serial === serial));
  return {
    memeSsd: miens.filter((g) => g.copies.filter((c) => c.serial === serial).length > 1).length,
    autresSsd: miens.filter((g) => g.entreSsd).length,
    perduGo: +(miens.reduce((s, g) => s + g.perdu, 0) / 1e9).toFixed(1),
    avec: [...new Set(miens.flatMap((g) => g.copies.filter((c) => c.serial !== serial).map((c) => c.numero)))].filter(Boolean),
    total: groupes.length,
  };
}

module.exports = { enregistrer, toutLire, calculer, ecrireOnglet, resume, encoder, decoder, SEUIL };
