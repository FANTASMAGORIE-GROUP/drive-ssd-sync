const path = require('path');
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const disk = require('./src/disk');
const google = require('./src/google');
const ai = require('./src/ai');
const store = require('./src/store');
const scan = require('./src/scan');
const doublons = require('./src/doublons');
const comparaison = require('./src/comparaison');
const { numeroDansNom } = require('./src/numero');
const { styleGeneral } = require('./src/style');
const { proteger, majDirecte } = require('./src/garde');
const maj = require('./src/maj');

const { sheets } = google;
const INTOUCHABLES = /localis|contenu|[ée]tat|sauvegarde|nas/i;

let fenetre;
let quitter = false;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => afficher());

function afficher() {
  if (!fenetre) return;
  fenetre.show();
  fenetre.focus();
}

function creerFenetre() {
  fenetre = new BrowserWindow({
    width: 420, height: 640, resizable: false, autoHideMenuBar: true, title: 'SSD Drive Sync',
    backgroundColor: '#fff7f2',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  fenetre.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Fermer la fenêtre la cache : l'app continue de surveiller les SSD.
  fenetre.on('close', (e) => { if (!quitter) { e.preventDefault(); fenetre.hide(); } });
}

const envoyer = (canal, data) => fenetre && fenetre.webContents.send(canal, data);
google.quandDeconnecte(() => { afficher(); envoyer('google-deconnecte'); });

// ---------- Google Sheets ----------

const lettre = (i) => (i >= 26 ? lettre(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));
const normaliser = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
// L'apostrophe garde la date telle quelle (jj/mm/aaaa), sinon Sheets peut l'afficher comme un nombre.
const aujourdhui = () => `'${new Date().toLocaleDateString('fr-FR')}`;

async function onglets(id) {
  const { onglets: liste, ids } = await sheets.titres(id);
  const general = liste.find((o) => normaliser(o).includes('GENERAL')) || liste[0];
  return { general, generalId: ids[general], emprunt: liste.find((o) => normaliser(o).includes('EMPRUNT')) };
}

// Fichier vide ou incomplet : on recrée les onglets avec les mêmes colonnes que le fichier d'Anne.
const MODELE = {
  'GÉNÉRAL': ['N°', 'Capacité (En To)', 'Utilisé', 'Restant', '%', 'Localisation', 'Projets', 'Contenu',
    'Dernière sauvegarde dans le NAS', 'État'],
  'Emprunt Disque': ['DATE', 'NOM', 'DISQUE', 'STATUT'],
};

async function preparerFichier(id) {
  const { onglets: liste, ids } = await sheets.titres(id);
  // Onglets vides par défaut d'un nouveau fichier (« Feuille 1 », « Sheet1 »…) : remplacés par GÉNÉRAL.
  const vides = [];
  for (const o of liste.filter((t) => /^(feuille|sheet|hoja|blatt|foglio)\s*\d+$/i.test(t))) {
    if (!(await sheets.lire(id, o, 'A1:Z50')).some((l) => l.some((c) => String(c ?? '').trim()))) vides.push(ids[o]);
  }
  let cree = false;
  try {
    await creerOnglets(id, liste, () => { cree = true; });
  } finally {
    if (cree && vides.length) {
      const general = (await sheets.titres(id)).ids['GÉNÉRAL'];
      await sheets.miseEnForme(id, [
        ...(general !== undefined ? [{ updateSheetProperties: { properties: { sheetId: general, index: 0 }, fields: 'index' } }] : []),
        ...vides.map((sheetId) => ({ deleteSheet: { sheetId } })),
      ]);
    }
  }
}

async function creerOnglets(id, liste, surCreation) {
  for (const [titre, entetes] of Object.entries(MODELE)) {
    const mot = normaliser(titre).split(' ')[0];
    if (liste.some((o) => normaliser(o).includes(mot))) continue;
    surCreation();
    if (titre === 'GÉNÉRAL') {
      try { await sheets.copierModele(id, titre); continue; } catch { /* modèle inaccessible : style de secours */ }
    }
    await sheets.creerOnglet(id, titre);
    await sheets.ecrire(id, titre, 'A1', [entetes]);
    if (titre === 'GÉNÉRAL') await sheets.miseEnForme(id, styleGeneral((await sheets.titres(id)).ids[titre]));
  }
}

// La ligne des titres n'est pas forcément la première : on prend la première qui contient « Capacité ».
const ligneTitres = (lignes) => Math.max(0, lignes.findIndex((l) => l.some((c) => normaliser(String(c ?? '')).includes('CAPACIT'))));

// Le SSD est rattaché à sa ligne par une note sur la case du n° : la note suit la ligne si on la déplace
// ou si on trie, et reste en place si on change le numéro.
const NOTE = 'SSD relié : ';

async function liens(id) {
  const { general } = await onglets(id);
  return (await sheets.notes(id, general, 'A1:A300')).map((c, ligne) => ({
    ligne,
    numero: String(c.valeur ?? '').trim(),
    serial: (c.note || '').startsWith(NOTE) ? c.note.slice(NOTE.length).split('\n')[0].trim() : null,
    // 2e et 3e lignes de la note : modèle et date de liaison, affichés en cas de conflit.
    modele: (c.note || '').startsWith(NOTE) ? (c.note.split('\n')[1] || '').trim() : '',
    date: (c.note || '').startsWith(NOTE) ? (c.note.split('\n')[2] || '').replace('Relié le ', '').trim() : '',
  }));
}

async function numeroDuSsd(id, serial) {
  const l = (await liens(id)).find((x) => x.serial === serial && x.numero);
  return l ? l.numero : null;
}

// Liste des disques de l'onglet GÉNÉRAL, avec ceux dont on connaît déjà le SSD.
async function disquesDuFichier(id) {
  const { general } = await onglets(id);
  const lignes = await sheets.lire(id, general, 'A1:J300', 'FORMATTED_VALUE');
  const t = ligneTitres(lignes);
  const entetes = (lignes[t] || []).map((e) => normaliser(String(e)));
  const col = (mot) => entetes.findIndex((e) => e.includes(mot));
  const [cLoc, cProj, cCap, cPct] = [col('LOCALIS'), col('PROJET'), col('CAPACIT'), entetes.indexOf('%')];
  const relies = new Set((await liens(id)).filter((l) => l.serial).map((l) => l.ligne));
  const disques = lignes
    .map((l, ligne) => ({ l, ligne }))
    .filter(({ l, ligne }) => ligne > t && String(l[0] ?? '').trim())
    .map(({ l, ligne }) => ({
      ligne,
      numero: String(l[0]).trim(),
      capacite: cCap >= 0 ? l[cCap] || '' : '',
      pourcent: cPct >= 0 ? l[cPct] || '' : '',
      localisation: cLoc >= 0 ? (l[cLoc] || '').trim() : '',
      projets: cProj >= 0 ? String(l[cProj] || '').split(/[\n,]/)[0].trim() : '',
      relie: relies.has(ligne),
    }));
  // Deux lignes avec le même n° : l'app ne saurait pas laquelle remplir, on les signale.
  const compte = {};
  for (const d of disques) compte[d.numero] = (compte[d.numero] || 0) + 1;
  for (const d of disques) d.doublon = compte[d.numero] > 1;
  return disques;
}

// Donne au disque de cette ligne le premier n° libre (seule la case du n° change ; la note du SSD reste).
async function renumeroter(id, ligne) {
  const { general } = await onglets(id);
  const disques = await disquesDuFichier(id);
  const numero = String(Math.max(0, ...disques.map((d) => parseInt(d.numero, 10) || 0)) + 1);
  await sheets.ecrire(id, general, `A${ligne + 1}`, [[Number(numero)]]);
  return numero;
}

async function lier(id, d, numero) {
  const { generalId } = await onglets(id);
  const tous = await liens(id);
  const cible = tous.find((l) => l.numero === numero);
  if (tous.filter((l) => l.numero === numero).length > 1) {
    throw new Error(`Plusieurs disques portent le n°${numero} : corrige les numéros avant de synchroniser`);
  }
  if (!cible) throw new Error(`Le disque n°${numero} n'existe pas dans l'onglet GÉNÉRAL`);
  const note = (ligne, texte) => ({
    updateCells: {
      range: { sheetId: generalId, startRowIndex: ligne, endRowIndex: ligne + 1, startColumnIndex: 0, endColumnIndex: 1 },
      rows: [{ values: [{ note: texte }] }], fields: 'note',
    },
  });
  const anciennes = tous.filter((l) => l.serial === d.serial && l.ligne !== cible.ligne).map((l) => note(l.ligne, ''));
  await sheets.miseEnForme(id, [...anciennes, note(cible.ligne, `${NOTE}${d.serial}\n${d.modele}\nRelié le ${aujourdhui().slice(1)}`)]);
}

// Nouveau disque : première ligne vide sous les titres (colonnes A à J, sans compter le bloc de statistiques).
// numero absent : à la suite des autres (le plus grand n° + 1).
async function nouvelleLigne(id, voulu = null) {
  const { general } = await onglets(id);
  const lignes = await sheets.lire(id, general, 'A1:J300', 'FORMATTED_VALUE');
  const t = ligneTitres(lignes);
  const numero = voulu || String(Math.max(0, ...lignes.slice(t + 1).map((l) => parseInt(l[0], 10) || 0)) + 1);
  let i = lignes.findIndex((l, n) => n > t && !l.some((c) => String(c ?? '').trim()));
  if (i < 0) i = lignes.length;
  await sheets.ecrire(id, general, `A${i + 1}`, [[Number(numero)]]);
  return numero;
}

async function remplir(id, d, numero) {
  const { general, emprunt } = await onglets(id);
  const lignes = await sheets.lire(id, general, 'A1:Z300');
  const t = ligneTitres(lignes);
  const entetes = lignes[t] || [];
  const index = lignes.findIndex((l, i) => i > t && String(l[0] ?? '').trim() === numero);
  if (index < 0) throw new Error(`Le disque n°${numero} n'existe pas dans l'onglet ${general}`);
  const ligne = lignes[index];

  // Les mesures sont écrites telles quelles, sans passer par l'IA : une IA qui « nettoie » un nom de dossier
  // (espace en trop, accents à la Mac) faisait refuser toute la colonne Projets.
  const maj = majDirecte(entetes, d);
  const ecrits = [];
  for (const [entete, valeur] of Object.entries(maj)) {
    const col = entetes.findIndex((e) => String(e).trim() === entete.trim());
    if (col < 0 || INTOUCHABLES.test(entete)) continue;
    if (String(ligne[col] ?? '').startsWith('=')) continue; // ne jamais écraser une formule
    if (String(ligne[col] ?? '') === String(valeur)) continue; // rien n'a changé
    await sheets.ecrire(id, general, `${lettre(col)}${index + 1}`, [[proteger(valeur)]]);
    ecrits.push(entete.trim());
  }

  if (emprunt) {
    await sheets.ajouterLigne(id, emprunt, [aujourdhui(), proteger(store.get('nom') || ''),Number(numero) || numero, 'Emprunté']);
  }
  return ecrits;
}

// Le n° est choisi dans l'app : seule la case du n° change, la note qui relie le SSD reste sur la ligne.
async function changerNumero(id, ligne, ancien, numero) {
  numero = String(numero ?? '').trim();
  if (!numero || numero.length > 20) throw new Error('Écris un numéro (20 caractères au plus)');
  const disques = await disquesDuFichier(id);
  const d = disques.find((x) => x.ligne === ligne && x.numero === ancien);
  if (!d) throw new Error("Ce disque a bougé dans le fichier : recharge la liste et recommence");
  if (numero === ancien) return numero;
  if (disques.some((x) => x.ligne !== ligne && x.numero === numero)) throw new Error(`Le n°${numero} est déjà pris par un autre disque`);
  const { general } = await onglets(id);
  await sheets.ecrire(id, general, `A${ligne + 1}`, [[/^\d+$/.test(numero) ? Number(numero) : proteger(numero)]]);
  if (branche) branche.numero = await numeroDuSsd(id, branche.disque.serial);
  return numero;
}

// Case « Contenu » du disque : Anne y écrit parfois à la main, donc on ne la remplit seule que si elle est vide.
async function caseContenu(id, numero) {
  const { general } = await onglets(id);
  const lignes = await sheets.lire(id, general, 'A1:Z300', 'FORMATTED_VALUE');
  const t = ligneTitres(lignes);
  const col = (lignes[t] || []).findIndex((e) => normaliser(String(e ?? '')).includes('CONTENU'));
  const index = lignes.findIndex((l, i) => i > t && String(l[0] ?? '').trim() === numero);
  if (col < 0) throw new Error("Pas de colonne « Contenu » dans l'onglet GÉNÉRAL");
  if (index < 0) throw new Error(`Le disque n°${numero} n'existe pas dans l'onglet ${general}`);
  return { general, cellule: `${lettre(col)}${index + 1}`, actuel: String(lignes[index][col] ?? '').trim() };
}

async function ecrireContenu(id, numero, texte) {
  const c = await caseContenu(id, numero);
  await sheets.ecrire(id, c.general, c.cellule, [[proteger(String(texte).slice(0, 1200))]]);
}

// Lit tous les fichiers du SSD, décrit son contenu et met à jour l'onglet des doublons.
async function analyser(id, d, numero) {
  envoyer('progres', 'Je lis tous les dossiers du SSD…');
  const { fichiers, arbre } = await scan.scanner(d.volume, (n) => envoyer('progres', `${n.toLocaleString('fr-FR')} fichiers lus…`));
  const res = { fichiers: fichiers.length };
  try {
    envoyer('progres', 'Je résume le contenu…');
    const texte = await ai.decrireContenu(arbre);
    const { actuel } = await caseContenu(id, numero);
    const vide = !actuel || actuel === '/';
    if (vide) await ecrireContenu(id, numero, texte);
    res.contenu = { texte, ecrit: vide, actuel };
  } catch (e) { res.contenuErreur = e.message; }
  try {
    envoyer('progres', 'Je cherche les doublons…');
    await doublons.enregistrer(sheets, id, d.serial, numero, fichiers);
    const numeros = Object.fromEntries((await liens(id)).filter((l) => l.serial).map((l) => [l.serial, l.numero]));
    const entrees = (await doublons.toutLire(sheets, id)).map((e) => ({ ...e, numero: numeros[e.serial] || e.numero }));
    const groupes = doublons.calculer(entrees);
    await doublons.ecrireOnglet(sheets, id, groupes);
    res.doublons = doublons.resume(groupes, d.serial);
  } catch (e) { res.doublonsErreur = e.message; }
  return res;
}

const analyserSansBloquer = (id, d, numero) => analyser(id, d, numero).catch((e) => ({ erreur: e.message }));

// ---------- Surveillance des SSD ----------

let branche = null; // { disque, numero } du SSD actuellement branché

async function detecter(volume) {
  const id = store.get('sheetId');
  if (!id || !google.estConnecte()) return;
  envoyer('ssd-lecture');
  try {
    const d = await disk.lireDisque(volume);
    if (!d) return;
    branche = { disque: d, numero: await numeroDuSsd(id, d.serial) };
    afficher();
    envoyer('ssd', branche);
  } catch (e) {
    envoyer('erreur', e.message);
  }
}

let vus = new Set();
function surveiller() {
  const actuels = new Set(disk.volumesMontes());
  for (const v of actuels) if (!vus.has(v)) detecter(v);
  if (branche && !actuels.has(branche.disque.volume)) { branche = null; envoyer('ssd-retire'); }
  vus = actuels;
}

// ---------- Échanges avec l'interface ----------

const sheetId = () => store.get('sheetId');

ipcMain.handle('etat-initial', async () => ({
  connecte: google.estConnecte(),
  sheetId: sheetId(),
  titre: store.get('sheetTitre'),
  nom: store.get('nom') || '',
  cleOpenai: ai.aUneCle(),
}));

// La clé n'est enregistrée que si OpenAI l'accepte ; l'ancienne n'est jamais renvoyée à l'interface.
ipcMain.handle('cle-openai', async (_e, cle) => {
  cle = String(cle ?? '').trim();
  if (!/^sk-\S{10,}$/.test(cle)) throw new Error('Une clé OpenAI commence par « sk- » (colle-la en entier)');
  await ai.testerCle(cle);
  store.set('openaiKey', cle);
});

ipcMain.handle('connecter', async () => { await google.connecter(); afficher(); });

ipcMain.handle('choisir-fichier', async (_e, lien) => {
  const id = sheets.idDepuisLien(lien);
  if (!id) throw new Error('Ce lien ne ressemble pas à un fichier Google Sheets');
  const { titre } = await sheets.titres(id);
  store.set('sheetId', id);
  store.set('sheetTitre', titre);
  return titre;
});

ipcMain.handle('nom', (_e, nom) => store.set('nom', nom));

ipcMain.handle('disques', async () => {
  await preparerFichier(sheetId());
  return disquesDuFichier(sheetId());
});

// L'interface attend un disque : on renvoie celui déjà branché, et en mode test on en « branche » un.
ipcMain.handle('attendre', async (_e, numero) => {
  if (disk.FAUX && !branche) {
    const l = await liens(sheetId());
    disk.brancherFaux(l.map((x) => x.serial).filter(Boolean), (l.find((x) => x.serial && x.numero === numero) || {}).serial);
  }
  return branche;
});

ipcMain.handle('liberer', () => {
  if (disk.FAUX) disk.debrancherFaux();
});

// Avant de synchroniser : ce disque est-il déjà relié à un autre SSD ? La capacité correspond-elle ?
async function verifier(id, d, numero) {
  const lien = (await liens(id)).find((l) => l.numero === numero);
  const autre = lien && lien.serial && lien.serial !== d.serial ? { modele: lien.modele, date: lien.date } : null;
  const ligne = (await disquesDuFichier(id)).find((x) => x.numero === numero);
  const fichier = ligne ? parseFloat(String(ligne.capacite).replace(',', '.')) : NaN;
  // Tolérance de 15 % : un SSD de « 2 To » affiche souvent 1,8 à 2 To une fois formaté.
  const ecart = fichier > 0 && Math.abs(d.total_to - fichier) / fichier > 0.15 ? { fichier, mesure: d.total_to } : null;
  return { autre, ecart };
}

ipcMain.handle('verifier', async (_e, numero) => {
  if (!branche) throw new Error('Le SSD a été débranché');
  return verifier(sheetId(), branche.disque, numero);
});

ipcMain.handle('synchroniser', async (_e, numero, forcer = false) => {
  if (!branche) throw new Error('Le SSD a été débranché');
  if (!forcer && (await verifier(sheetId(), branche.disque, numero)).autre) {
    throw new Error(`Le disque n°${numero} est déjà relié à un autre SSD`);
  }
  await lier(sheetId(), branche.disque, numero);
  branche.numero = numero;
  const { disque } = branche;
  const ecrits = await remplir(sheetId(), disque, numero);
  return { numero, ecrits, analyse: await analyserSansBloquer(sheetId(), disque, numero) };
});

// Nouveau SSD : quel n° proposer ? Celui écrit dans son nom (« SSD 12 ») s'il y en a un, sinon la suite des autres.
// occupant : ce qu'il y a déjà dans le fichier à ce n° (rien, une ligne sans SSD relié, un autre SSD, plusieurs lignes).
async function proposition(id, d) {
  const disques = await disquesDuFichier(id);
  const suite = String(Math.max(0, ...disques.map((x) => parseInt(x.numero, 10) || 0)) + 1);
  const numeroNom = numeroDansNom(d.nom);
  const base = { nom: d.nom || '', suite, numeroNom };
  if (!numeroNom) return base;
  const occ = disques.filter((x) => x.numero === numeroNom);
  if (!occ.length) return { ...base, occupant: null };
  if (occ.length > 1) return { ...base, occupant: { etat: 'doublon' } };
  const lien = (await liens(id)).find((l) => l.ligne === occ[0].ligne);
  const etat = !lien || !lien.serial ? 'non-relie' : lien.serial === d.serial ? 'meme' : 'autre-ssd';
  const { ligne, capacite, localisation, projets } = occ[0];
  return { ...base, occupant: { etat, ligne, capacite, localisation, projets, modele: lien?.modele || '', date: lien?.date || '' } };
}

ipcMain.handle('proposition', () => {
  if (!branche) throw new Error('Le SSD a été débranché');
  return proposition(sheetId(), branche.disque);
});

// choix.numero : le n° lu dans le nom ; choix.prendre : il est pris par un autre SSD, qui passe à la suite.
ipcMain.handle('ajouter', async (_e, choix = {}) => {
  if (!branche) throw new Error('Le SSD a été débranché');
  const id = sheetId();
  const { disque } = branche;
  let numero;
  let deplace = null;
  if (choix.numero) {
    // On revérifie : le fichier a pu changer depuis l'affichage des boutons.
    const p = await proposition(id, disque);
    if (p.numeroNom !== choix.numero) throw new Error('Le nom du SSD a changé : débranche-le et rebranche-le');
    const etat = p.occupant?.etat;
    if (etat === 'doublon') throw new Error(`Plusieurs disques portent déjà le n°${choix.numero} : corrige-les d'abord`);
    if (etat === 'non-relie' || etat === 'meme') throw new Error(`Le disque n°${choix.numero} existe déjà dans le fichier : relie-le plutôt`);
    if (etat === 'autre-ssd') {
      if (!choix.prendre) throw new Error(`Le n°${choix.numero} est déjà pris par un autre SSD`);
      // Seule la case du n° de l'autre disque change ; sa ligne et son SSD restent ensemble.
      const { general } = await onglets(id);
      await sheets.ecrire(id, general, `A${p.occupant.ligne + 1}`, [[Number(p.suite)]]);
      deplace = { de: choix.numero, vers: p.suite };
    }
    numero = await nouvelleLigne(id, choix.numero);
  } else {
    numero = await nouvelleLigne(id);
  }
  await lier(id, disque, numero);
  branche.numero = numero;
  const ecrits = await remplir(id, disque, numero);
  return { numero, ecrits, deplace, analyse: await analyserSansBloquer(id, disque, numero) };
});

ipcMain.handle('renumeroter', (_e, ligne) => renumeroter(sheetId(), ligne));
ipcMain.handle('changer-numero', (_e, ligne, ancien, numero) => changerNumero(sheetId(), ligne, ancien, numero));
ipcMain.handle('ecrire-contenu', (_e, numero, texte) => ecrireContenu(sheetId(), numero, texte));
ipcMain.handle('ouvrir-fichier', () => shell.openExternal(`https://docs.google.com/spreadsheets/d/${sheetId()}`));
ipcMain.handle('ouvrir-doublons', async () => {
  const gid = (await sheets.titres(sheetId())).ids.Doublons;
  shell.openExternal(`https://docs.google.com/spreadsheets/d/${sheetId()}/edit${gid !== undefined ? `#gid=${gid}` : ''}`);
});

// ---------- Diagnostic SSD ↔ NAS ----------

let comparaisonAnnulee = false;

ipcMain.handle('choisir-dossier', async (_e, titre) => {
  const r = await dialog.showOpenDialog(fenetre, { title: titre, properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('comparer', async (_e, source, nas) => {
  comparaisonAnnulee = false;
  const estAnnule = () => comparaisonAnnulee;
  try {
    const a = await comparaison.lister(source, (n) => envoyer('comparaison-progres', { cote: 'source', n }), estAnnule);
    const b = await comparaison.lister(nas, (n) => envoyer('comparaison-progres', { cote: 'nas', n }), estAnnule);
    const r = comparaison.comparer(a, b);
    const s = comparaison.resume(r, path.basename(source) || source, path.basename(nas) || nas, await comparaison.estReseau(nas));
    // Le résumé s'affiche même si l'écriture dans le fichier échoue (hors ligne, fichier non relié…).
    if (sheetId() && google.estConnecte()) {
      try { await comparaison.exporter(sheets, sheetId(), s, r); s.exporte = true; } catch (e) { s.erreurExport = e.message; }
    }
    return s;
  } catch (e) {
    if (e instanceof comparaison.Annule) return { annule: true };
    throw e;
  }
});

ipcMain.handle('annuler-comparaison', () => { comparaisonAnnulee = true; });

ipcMain.handle('ouvrir-diagnostics', async () => {
  const gid = (await sheets.titres(sheetId())).ids[comparaison.ONGLET];
  shell.openExternal(`https://docs.google.com/spreadsheets/d/${sheetId()}/edit${gid !== undefined ? `#gid=${gid}` : ''}`);
});

ipcMain.handle('maj-etat', () => maj.etat());
ipcMain.handle('maj-installer', () => maj.installer());

app.whenReady().then(() => {
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true });
  creerFenetre();
  setInterval(surveiller, 1500);
  maj.demarrer((info) => envoyer('maj', info));
});

app.on('before-quit', () => { quitter = true; });
app.on('activate', afficher);
