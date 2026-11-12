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
  let verifier;
  if (process.platform === 'darwin') {
    // Les .dmg des versions déjà installées ne servent plus.
    fs.rmSync(dossierMac(), { recursive: true, force: true });
    verifier = () => verifierMac().catch(() => {});
  } else {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.on('update-downloaded', (i) => signaler({ version: i.version, prete: true }));
    autoUpdater.on('error', () => {}); // pas de réseau, GitHub indisponible… on réessaiera plus tard
    verifier = () => autoUpdater.checkForUpdates().catch(() => {});
  }
  verifier();
  setInterval(verifier, SIX_HEURES);
}

function installer() {
  if (process.platform === 'darwin') return installerMac();
  if (derniere && derniere.prete) require('electron-updater').autoUpdater.quitAndInstall(true, true);
}

module.exports = { demarrer, installer, etat: () => derniere, plusRecente };
