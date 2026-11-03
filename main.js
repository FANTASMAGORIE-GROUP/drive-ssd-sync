const path = require('path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const disk = require('./src/disk');
const google = require('./src/google');
const ai = require('./src/ai');
const store = require('./src/store');

const { sheets } = google;
const REGISTRE = 'Registre SSD';
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
    width: 420, height: 620, resizable: false, autoHideMenuBar: true, title: 'SSD Drive Sync',
    backgroundColor: '#fff7f2',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  fenetre.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Fermer la fenêtre la cache : l'app continue de surveiller les SSD.
  fenetre.on('close', (e) => { if (!quitter) { e.preventDefault(); fenetre.hide(); } });
}

const envoyer = (canal, data) => fenetre && fenetre.webContents.send(canal, data);

// ---------- Google Sheets ----------

const lettre = (i) => (i >= 26 ? lettre(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));
const normaliser = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

async function onglets(id) {
  const { onglets: liste } = await sheets.titres(id);
  return {
    general: liste.find((o) => normaliser(o).includes('GENERAL')) || liste[0],
    emprunt: liste.find((o) => normaliser(o).includes('EMPRUNT')),
    registre: liste.includes(REGISTRE),
  };
}

async function numeroConnu(id, serial) {
  const { registre } = await onglets(id);
  if (!registre) return null;
  const lignes = await sheets.lire(id, REGISTRE, 'A2:B1000');
  const trouve = lignes.find((l) => l[0] === serial);
  return trouve ? String(trouve[1]) : null;
}

async function enregistrerNumero(id, d, numero) {
  const { registre } = await onglets(id);
  if (!registre) {
    await sheets.creerOnglet(id, REGISTRE);
    await sheets.ajouterLigne(id, REGISTRE, ['Numéro de série', 'N° disque', 'Modèle', 'Enregistré le']);
  }
  await sheets.ajouterLigne(id, REGISTRE, [d.serial, numero, d.modele, new Date().toLocaleDateString('fr-FR')]);
}

async function remplir(id, d, numero) {
  const { general, emprunt } = await onglets(id);
  const lignes = await sheets.lire(id, general, 'A1:Z300');
  const entetes = lignes[0] || [];
  const index = lignes.findIndex((l, i) => i > 0 && String(l[0] ?? '').trim() === numero);
  if (index < 0) throw new Error(`Le disque n°${numero} n'existe pas dans l'onglet ${general}`);
  const ligne = lignes[index];

  const { volume, serial, ...infos } = d;
  const maj = await ai.proposerMaj(entetes, ligne, infos);
  const ecrits = [];
  for (const [entete, valeur] of Object.entries(maj)) {
    const col = entetes.findIndex((e) => String(e).trim() === entete.trim());
    if (col < 0 || INTOUCHABLES.test(entete)) continue;
    if (String(ligne[col] ?? '').startsWith('=')) continue; // ne jamais écraser une formule
    const v = Array.isArray(valeur) ? valeur.join('\n') : valeur;
    await sheets.ecrire(id, general, `${lettre(col)}${index + 1}`, [[v]]);
    ecrits.push(entete.trim());
  }

  if (emprunt) {
    await sheets.ajouterLigne(id, emprunt, [
      new Date().toLocaleDateString('fr-FR'), store.get('nom') || '', Number(numero) || numero, 'Emprunté',
    ]);
  }
  return ecrits;
}

// ---------- Surveillance des SSD ----------

let enAttente = null; // disque inconnu en attente de son numéro

async function traiter(volume) {
  const id = store.get('sheetId');
  if (!id || !google.estConnecte()) return;
  envoyer('etat', { etape: 'lecture', volume });
  try {
    const d = await disk.lireDisque(volume);
    if (!d) { envoyer('etat', { etape: 'attente' }); return; }
    afficher();
    const numero = await numeroConnu(id, d.serial);
    if (!numero) {
      enAttente = d;
      envoyer('etat', { etape: 'inconnu', disque: d });
      return;
    }
    await finaliser(id, d, numero);
  } catch (e) {
    envoyer('etat', { etape: 'erreur', message: e.message });
  }
}

async function finaliser(id, d, numero) {
  envoyer('etat', { etape: 'ia', disque: d, numero });
  const ecrits = await remplir(id, d, numero);
  envoyer('etat', { etape: 'fini', disque: d, numero, ecrits });
}

let vus = new Set();
function surveiller() {
  const actuels = new Set(disk.volumesMontes());
  for (const v of actuels) if (!vus.has(v)) traiter(v);
  vus = actuels;
}

// ---------- Échanges avec l'interface ----------

ipcMain.handle('etat-initial', async () => ({
  connecte: google.estConnecte(),
  sheetId: store.get('sheetId'),
  titre: store.get('sheetTitre'),
  nom: store.get('nom') || '',
}));

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

ipcMain.handle('numero', async (_e, numero) => {
  const d = enAttente;
  enAttente = null;
  const id = store.get('sheetId');
  try {
    await enregistrerNumero(id, d, String(numero).trim());
    await finaliser(id, d, String(numero).trim());
  } catch (e) {
    envoyer('etat', { etape: 'erreur', message: e.message });
  }
});

ipcMain.handle('rescanner', () => { vus = new Set(); surveiller(); });
ipcMain.handle('ouvrir-fichier', () => shell.openExternal(`https://docs.google.com/spreadsheets/d/${store.get('sheetId')}`));
ipcMain.handle('changer-fichier', () => { store.supprimer('sheetId'); store.supprimer('sheetTitre'); });

app.whenReady().then(() => {
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true });
  creerFenetre();
  vus = new Set(disk.volumesMontes()); // les SSD déjà branchés au démarrage : bouton « Re-scanner »
  setInterval(surveiller, 3000);
});

app.on('before-quit', () => { quitter = true; });
app.on('activate', afficher);
