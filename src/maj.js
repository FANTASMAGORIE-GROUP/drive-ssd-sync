// Mises à jour automatiques, lues sur GitHub Releases.
// Windows : la nouvelle version se télécharge en arrière-plan ; un clic sur « Redémarrer » l'installe.
// Mac : l'app n'est pas signée par Apple, Squirrel refuse de la remplacer. Elle télécharge donc elle-même
//       le .dmg en arrière-plan puis, au clic sur « Redémarrer », se remplace (src/maj-mac.js).
//       Si c'est impossible (app hors Applications, pas les droits…), le bouton ouvre le lien du .dmg.
const path = require('path');
const fs = require('fs');
const { app, shell } = require('electron');
const mac = require('./maj-mac');

const DEPOT = 'FANTASMAGORIE-GROUP/drive-ssd-sync';
const DMG = `https://github.com/${DEPOT}/releases/latest/download/SSD-Drive-Sync-Mac.dmg`;
const SIX_HEURES = 6 * 3600 * 1000;
const dossierMac = () => path.join(app.getPath('userData'), 'mise-a-jour');

let prevenir = () => {};
let derniere = null; // { version, prete } : prete = déjà téléchargée, il suffit de redémarrer

// '1.10.0' est plus récente que '1.9.3'
function plusRecente(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

function signaler(info) { derniere = info; prevenir(info); }

const UNE_HEURE = 3600 * 1000;
let verifier = null;     // lance une vérification (défini par demarrer, seulement dans l'app installée)
let essai = 0;           // nombre d'échecs d'affilée
let derniereVerif = 0;   // heure de la dernière vérification lancée

// derniereVersion() ne renvoie une version que si son .dmg est bien envoyé sur GitHub.
let enCours = false;
async function verifierMac() {
  if (enCours || (derniere && derniere.prete)) return;
  const info = await mac.derniereVersion();
  if (!info || !plusRecente(info.version, app.getVersion())) return;
  enCours = true;
  try {
    const fichier = await mac.telecharger(info, dossierMac());
    signaler({ version: info.version, prete: true, fichier });
  } catch {
    signaler({ version: info.version, prete: false }); // repli : le bouton ouvrira le lien du .dmg
  } finally { enCours = false; }
}

// Mac : remplace l'app puis la ferme ; le script relance la nouvelle. Sinon, ouvre le lien du .dmg.
async function installerMac() {
  // Téléchargement en arrière-plan raté : bouton « MAJ », on ouvre simplement le lien du .dmg.
  if (!derniere || !derniere.prete) { await shell.openExternal(DMG); return null; }
  try {
    const cible = mac.bundleActuel(process.execPath);
    const raison = mac.raisonImpossible(cible);
    if (raison) throw new Error(raison);
    const nouveau = await mac.preparer(derniere.fichier, cible, derniere.version);
    mac.lancerRemplacement(cible, nouveau, process.pid);
    setTimeout(() => app.quit(), 300);
    return null;
  } catch (e) {
    await shell.openExternal(DMG);
    return { erreur: `Mise à jour automatique impossible (${e.message}) : le .dmg se télécharge, glisse l'app dans Applications.` };
  }
}

function demarrer(envoyer) {
  prevenir = envoyer;
  if (!app.isPackaged) return; // pas pendant le développement
  // Au démarrage de l'ordinateur, l'app se lance souvent avant que le réseau soit prêt : un échec est
  // retenté au bout de 2, 10 puis 30 minutes au lieu d'attendre la vérification suivante, 6 h plus tard.
  const RELANCES = [2, 10, 30].map((min) => min * 60 * 1000);
  const echec = () => { if (essai < RELANCES.length) setTimeout(verifier, RELANCES[essai++]); };
  if (process.platform === 'darwin') {
    // Les .dmg des versions déjà installées ne servent plus.
    fs.rmSync(dossierMac(), { recursive: true, force: true });
    verifier = () => verifierMac().then(() => { essai = 0; }, echec);
  } else {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.on('update-downloaded', (i) => { essai = 0; signaler({ version: i.version, prete: true }); });
    autoUpdater.on('error', echec); // pas de réseau, GitHub indisponible, téléchargement coupé…
    verifier = () => autoUpdater.checkForUpdates().catch(() => {}); // l'échec passe par l'événement « error »
  }
  const lancer = verifier;
  verifier = () => { derniereVerif = Date.now(); return lancer(); };
  verifier();
  setInterval(() => { essai = 0; verifier(); }, SIX_HEURES);
}

// Revérifie maintenant si la dernière vérification a échoué ou date de plus d'une heure (fenêtre rouverte).
function reverifier() {
  if (!verifier || (derniere && derniere.prete)) return;
  if (essai > 0 || Date.now() - derniereVerif > UNE_HEURE) { essai = 0; verifier(); }
}

function installer() {
  if (process.platform === 'darwin') return installerMac();
  if (derniere && derniere.prete) require('electron-updater').autoUpdater.quitAndInstall(true, true);
}

module.exports = { demarrer, reverifier, installer, etat: () => derniere, plusRecente };
