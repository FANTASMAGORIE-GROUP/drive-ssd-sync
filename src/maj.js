// Mises à jour automatiques, lues sur GitHub Releases.
// Windows : la nouvelle version se télécharge en arrière-plan ; un clic sur « Redémarrer » l'installe.
// Mac : l'app n'est pas signée par Apple, macOS l'empêche de se remplacer seule ;
//       on signale la nouvelle version et le bouton ouvre le téléchargement du .dmg.
const { app, shell } = require('electron');

const DEPOT = 'FANTASMAGORIE-GROUP/drive-ssd-sync';
const DMG = `https://github.com/${DEPOT}/releases/latest/download/SSD-Drive-Sync-Mac.dmg`;
const SIX_HEURES = 6 * 3600 * 1000;

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

async function verifierMac() {
  const r = await fetch(`https://api.github.com/repos/${DEPOT}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) return;
  const version = String((await r.json()).tag_name || '').replace(/^v/, '');
  if (version && plusRecente(version, app.getVersion())) signaler({ version, prete: false });
}

function demarrer(envoyer) {
  prevenir = envoyer;
  if (!app.isPackaged) return; // pas pendant le développement
  let verifier;
  if (process.platform === 'darwin') {
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
  if (process.platform === 'darwin') return shell.openExternal(DMG);
  if (derniere && derniere.prete) require('electron-updater').autoUpdater.quitAndInstall(true, true);
}

module.exports = { demarrer, installer, etat: () => derniere, plusRecente };
