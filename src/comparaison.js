// Doublons SSD ↔ NAS : quels fichiers d'un dossier (SSD, ordinateur) existent déjà dans un dossier du NAS
// (ou n'importe quel autre dossier), où qu'ils y soient rangés. Lecture seule : readdir et stat, rien n'est
// copié, déplacé ni supprimé.
// Doublon = même nom de fichier (sans tenir compte des majuscules ni de l'écriture des accents) et même taille,
// comme pour les doublons entre SSD.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// Fichiers et dossiers techniques créés par les systèmes ou les NAS (Synology, QNAP…), jamais comparés.
const IGNORES = new Set(['thumbs.db', 'desktop.ini', '$recycle.bin', 'system volume information', '@eadir', '#recycle',
  '#snapshot', '@recycle', '@recently-snapshot', '.@__thumb', 'lost+found']);
const ignore = (nom) => nom.startsWith('.') || IGNORES.has(nom.toLowerCase());

class Annule extends Error {}

// Renvoie la liste [{ chemin, taille, date }] de tous les fichiers sous racine.
async function lister(racine, surProgres = () => {}, estAnnule = () => false) {
  try { await fs.promises.readdir(racine); } catch {
    throw new Error(`Impossible de lire « ${racine} ». Si c'est le NAS, vérifie qu'il est toujours connecté.`);
  }
  const fichiers = [];
  const pile = [''];
  let dernier = 0;
  while (pile.length) {
    if (estAnnule()) throw new Annule('Diagnostic annulé');
    const rel = pile.pop();
    let entrees;
    try { entrees = await fs.promises.readdir(path.join(racine, rel), { withFileTypes: true }); } catch { continue; }
    const aStat = [];
    for (const e of entrees) {
      if (ignore(e.name)) continue;
      const chemin = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) pile.push(chemin);
      else if (e.isFile()) aStat.push(chemin);
      // Les raccourcis (liens symboliques) ne sont pas suivis : pas de boucle possible.
    }
    for (let i = 0; i < aStat.length; i += 64) {
      const lot = aStat.slice(i, i + 64);
      const infos = await Promise.all(lot.map((c) => fs.promises.stat(path.join(racine, c)).then((s) => s, () => null)));
      lot.forEach((c, j) => {
        if (infos[j]) fichiers.push({ chemin: c.normalize('NFC'), taille: infos[j].size, date: infos[j].mtimeMs });
      });
    }
    if (fichiers.length - dernier >= 500) { dernier = fichiers.length; surProgres(fichiers.length); }
  }
  // Déconnecté pendant la lecture : la liste serait incomplète, le résultat serait faux.
  if (!fs.existsSync(racine)) throw new Error(`« ${racine} » a été déconnecté pendant la lecture`);
  surProgres(fichiers.length);
  return fichiers;
}

// Clé d'un doublon : nom du fichier (accents en NFC, minuscules) + taille. Les fichiers vides ne comptent pas.
const cle = (f) => `${f.chemin.split('/').pop().normalize('NFC').toLowerCase()}|${f.taille}`;

function comparer(source, nas) {
  const index = new Map();
  for (const n of nas) {
    if (!n.taille) continue;
    const k = cle(n);
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(n.chemin);
  }
  const doublons = [];
  const uniques = [];
  for (const f of source) {
    const ou = f.taille ? index.get(cle(f)) : null;
    if (ou) doublons.push({ ...f, ou });
    else uniques.push(f);
  }
  doublons.sort((a, b) => b.taille - a.taille);
  uniques.sort((a, b) => b.taille - a.taille);
  return { doublons, uniques, nbNas: nas.length };
}

// Le dossier de référence est-il sur le réseau (NAS) ? Sert seulement à adapter les textes.
function estReseau(dossier) {
  const run = (cmd, args) => new Promise((ok) => execFile(cmd, args, { timeout: 10000 }, (e, out) => ok(e ? '' : out)));
  if (process.platform === 'win32') {
    if (dossier.startsWith('\\\\')) return Promise.resolve(true); // chemin réseau \\serveur\partage
    const lecteur = /^[a-z]:/i.test(dossier) ? dossier.slice(0, 2).toUpperCase() : null;
    if (!lecteur) return Promise.resolve(false);
    return run('powershell', ['-NoProfile', '-Command', `(Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${lecteur}'").DriveType`])
      .then((o) => o.trim() === '4');
  }
  // Mac : on cherche le point de montage du dossier dans la sortie de « mount ».
  return run('mount', []).then((o) => {
    const montages = o.split('\n').map((l) => l.match(/ on (.+) \(([a-z0-9]+)/i)).filter(Boolean);
    const m = montages.filter(([, p]) => dossier === p || dossier.startsWith(`${p}/`)).sort((a, b) => b[1].length - a[1].length)[0];
    return !!m && /^(smbfs|afpfs|nfs|webdav|cifs)$/i.test(m[2]);
  });
}

const octets = (liste) => liste.reduce((s, f) => s + f.taille, 0);
const go = (o) => +(o / 1e9).toFixed(1);
const dossierDe = (chemin) => (chemin.includes('/') ? chemin.split('/')[0] : '(racine)');

function resume(r, source, nas, reseau = false) {
  const total = octets([...r.doublons, ...r.uniques]);
  // Doublons regroupés par dossier de premier niveau du SSD, les plus lourds d'abord.
  const parDossier = new Map();
  for (const f of r.doublons) {
    const d = parDossier.get(dossierDe(f.chemin)) || { dossier: dossierDe(f.chemin), fichiers: 0, octets: 0 };
    d.fichiers += 1;
    d.octets += f.taille;
    parDossier.set(d.dossier, d);
  }
  return {
    source, nas, reseau,
    // « sur le NAS » ou « dans « Archives » », selon le dossier de référence.
    ou: reseau ? 'sur le NAS' : `dans « ${nas} »`,
    fichiers: r.doublons.length + r.uniques.length,
    doublons: r.doublons.length,
    doublonsGo: go(octets(r.doublons)),
    uniques: r.uniques.length,
    uniquesGo: go(octets(r.uniques)),
    totalGo: go(total),
    pourcent: total ? Math.round((octets(r.doublons) / total) * 100) : 0,
    rienEnCommun: !r.doublons.length && r.uniques.length > 0 && r.nbNas > 0,
    parDossier: [...parDossier.values()].sort((a, b) => b.octets - a.octets).slice(0, 5)
      .map((d) => ({ dossier: d.dossier, fichiers: d.fichiers, go: go(d.octets) })),
  };
}

// ---------- Onglet « Doublons NAS » du Google Sheets ----------

const ONGLET = 'Doublons NAS';
const MAX_LIGNES = 3000;
const mo = (o) => +(o / 1e6).toFixed(1);
const date = (ms) => (ms ? new Date(ms).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');

// Couleurs de l'app, en 0–1 pour l'API Google.
const rgb = (h) => ({ red: parseInt(h.slice(1, 3), 16) / 255, green: parseInt(h.slice(3, 5), 16) / 255, blue: parseInt(h.slice(5, 7), 16) / 255 });
const C = {
  prune: rgb('#4a3758'), blanc: rgb('#ffffff'), rosePale: rgb('#ffe4ea'), trait: rgb('#f1e2dc'), texte: rgb('#2e2333'),
  vert: rgb('#2e8f6a'), vertPale: rgb('#dff5ec'), gris: rgb('#8f7c84'), grisPale: rgb('#f6efec'),
};
const LARGEURS = [470, 110, 470];

// Mise en forme de l'onglet, posée une seule fois à sa création.
function styleOnglet(sheetId) {
  return [
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1, hideGridlines: true } },
      fields: 'gridProperties(frozenRowCount,hideGridlines)' } },
    ...LARGEURS.map((px, i) => ({ updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } })),
    { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 34 }, fields: 'pixelSize' } },
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 3 },
      cell: { userEnteredFormat: { backgroundColor: C.prune, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
        textFormat: { foregroundColor: C.blanc, bold: true, fontSize: 10 } } },
      fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)' } },
  ];
}

// Mise en forme d'un nouveau bloc (titre, résumé, fichiers, ligne vide) inséré en haut.
function styleBloc(sheetId, nFichiers) {
  const zone = (r0, r1, c0 = 0, c1 = 3) => ({ sheetId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });
  const cellule = (range, format) => ({ repeatCell: { range, cell: { userEnteredFormat: format },
    fields: `userEnteredFormat(${Object.keys(format).join(',')})` } });
  const hauteur = (r0, r1, px) => ({ updateDimensionProperties: {
    range: { sheetId, dimension: 'ROWS', startIndex: r0, endIndex: r1 }, properties: { pixelSize: px }, fields: 'pixelSize' } });
  const fin = 3 + nFichiers;
  return [
    // Les lignes insérées reprendraient le style du bloc précédent : on repart d'un style neutre.
    cellule(zone(1, fin + 1), { backgroundColor: C.blanc, textFormat: { bold: false, fontSize: 10, foregroundColor: C.texte },
      verticalAlignment: 'MIDDLE', horizontalAlignment: 'LEFT', wrapStrategy: 'CLIP', borders: {} }),
    { mergeCells: { range: zone(1, 2), mergeType: 'MERGE_ALL' } },
    hauteur(1, 2, 38),
    cellule(zone(1, 2), { backgroundColor: C.rosePale, textFormat: { bold: true, fontSize: 12, foregroundColor: C.prune } }),
    hauteur(2, 3, 30),
    { mergeCells: { range: zone(2, 3), mergeType: 'MERGE_ALL' } },
    cellule(zone(2, 3), { backgroundColor: C.vertPale, horizontalAlignment: 'CENTER', textFormat: { bold: true, foregroundColor: C.vert } }),
    ...(nFichiers ? [
      hauteur(3, fin, 24),
      cellule(zone(3, fin), { borders: { bottom: { style: 'SOLID', color: C.trait } } }),
      cellule(zone(3, fin, 1, 2), { horizontalAlignment: 'RIGHT', numberFormat: { type: 'NUMBER', pattern: '#,##0.0' } }),
      cellule(zone(3, fin, 2, 3), { textFormat: { foregroundColor: C.gris, fontSize: 10 } }),
    ] : []),
    hauteur(fin, fin + 1, 18),
  ];
}

// Chaque diagnostic est ajouté en haut de l'onglet : un titre, le total, puis seulement les doublons.
async function exporter(sheets, id, s, r) {
  const t = await sheets.titres(id);
  if (!t.onglets.includes(ONGLET)) {
    await sheets.creerOnglet(id, ONGLET);
    await sheets.ecrire(id, ONGLET, 'A1', [['Chemin sur le SSD', 'Taille (Mo)', 'Chemin sur le NAS (ou le dossier de référence)']], 'RAW');
    await sheets.miseEnForme(id, styleOnglet((await sheets.titres(id)).ids[ONGLET]));
  }
  const sheetId = (await sheets.titres(id)).ids[ONGLET];
  const v = (n) => String(n).replace('.', ',');
  const lignes = r.doublons.map((f) => [f.chemin, mo(f.taille), f.ou.slice(0, 3).join('  ·  ') + (f.ou.length > 3 ? `  ·  +${f.ou.length - 3}` : '')]);
  const fichiers = lignes.slice(0, MAX_LIGNES);
  if (lignes.length > MAX_LIGNES) fichiers.push([`… et ${lignes.length - MAX_LIGNES} autres doublons (liste coupée)`, '', '']);
  if (!lignes.length) fichiers.push(['Aucun doublon', '', '']);
  const bloc = [
    [`Diagnostic du ${date(Date.now())}   ·   ${s.source}  ↔  ${s.nas}`, '', ''],
    [`${s.doublons} doublons · ${v(s.doublonsGo)} Go`, '', ''],
    ...fichiers,
    ['', '', ''],
  ];

  await sheets.miseEnForme(id, [
    { insertDimension: { range: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 1 + bloc.length }, inheritFromBefore: false } },
    ...styleBloc(sheetId, fichiers.length),
  ]);
  // RAW : un nom de fichier qui commence par = reste du texte, il ne devient jamais une formule.
  await sheets.ecrire(id, ONGLET, 'A2', bloc, 'RAW');
  return sheetId;
}

module.exports = { estReseau, lister, comparer, resume, exporter, Annule, ONGLET };
