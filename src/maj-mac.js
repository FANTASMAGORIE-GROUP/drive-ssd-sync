// Mise à jour sur Mac sans signature Apple (Squirrel refuse une app non signée) :
// 1. l'app télécharge elle-même le .dmg (un fichier écrit par l'app n'a pas la marque « venu d'internet »,
//    donc pas d'avertissement « développeur non identifié » ensuite) et vérifie son empreinte sha512 ;
// 2. au clic sur « Redémarrer », elle monte le .dmg en silence, copie la nouvelle app à côté de l'actuelle
//    (dossier caché), puis un petit script attend que l'app soit fermée, échange les deux et relance.
//    Si l'échange rate, l'ancienne app est remise en place.
// Aucune dépendance à Electron : ce module est testé tel quel sur un vrai Mac (test/maj-mac.js).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const DEPOT = 'FANTASMAGORIE-GROUP/drive-ssd-sync';
const DMG = 'SSD-Drive-Sync-Mac.dmg';

const lancer = (cmd, args) => new Promise((ok, ko) => {
  execFile(cmd, args, { timeout: 180000 }, (e, sortie, err) => (e ? ko(new Error(`${cmd} : ${(err || e.message).trim()}`)) : ok(sortie)));
});

// Dernière version publiée qui a bien son .dmg, avec l'empreinte du .dmg lue dans latest-mac.yml.
async function derniereVersion() {
  const r = await fetch(`https://api.github.com/repos/${DEPOT}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) return null;
  const sortie = await r.json();
  const version = String(sortie.tag_name || '').replace(/^v/, '');
  const assets = sortie.assets || [];
  const dmg = assets.find((a) => a.name === DMG && a.state === 'uploaded');
  const yml = assets.find((a) => a.name === 'latest-mac.yml' && a.state === 'uploaded');
  if (!version || !dmg) return null;
  let sha512 = null;
  if (yml) {
    const texte = await (await fetch(yml.browser_download_url)).text();
    // Bloc « - url: SSD-Drive-Sync-Mac.dmg » puis sa ligne « sha512: … »
    const bloc = texte.split(/\n\s*- url: /).find((b) => b.trim().startsWith(DMG));
    sha512 = bloc && (bloc.match(/sha512:\s*(\S+)/) || [])[1];
  }
  return { version, url: dmg.browser_download_url, taille: dmg.size, sha512 };
}

async function telecharger(info, dossier) {
  await fs.promises.mkdir(dossier, { recursive: true });
  const fichier = path.join(dossier, `SSD-Drive-Sync-${info.version}.dmg`);
  if (await bonFichier(fichier, info)) return fichier; // déjà téléchargé
  const r = await fetch(info.url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`téléchargement refusé (${r.status})`);
  const partiel = `${fichier}.part`;
  await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(partiel));
  if (!(await bonFichier(partiel, info))) {
    await fs.promises.rm(partiel, { force: true });
    throw new Error('le fichier téléchargé est incomplet ou abîmé');
  }
  await fs.promises.rename(partiel, fichier);
  return fichier;
}

async function bonFichier(fichier, info) {
  try {
    if ((await fs.promises.stat(fichier)).size !== info.taille) return false;
    if (!info.sha512) return true;
    const h = crypto.createHash('sha512');
    await pipeline(fs.createReadStream(fichier), h);
    return h.digest('base64') === info.sha512;
  } catch { return false; }
}

// /Applications/SSD Drive Sync.app/Contents/MacOS/SSD Drive Sync → /Applications/SSD Drive Sync.app
function bundleActuel(execPath) {
  const i = execPath.indexOf('.app/');
  return i < 0 ? null : execPath.slice(0, i + 4);
}

// Cas où l'app ne peut pas se remplacer elle-même : on retombe alors sur le lien du .dmg.
function raisonImpossible(cible) {
  if (!cible) return "l'app n'est pas lancée depuis un dossier .app";
  if (cible.includes('/AppTranslocation/')) return "l'app a été ouverte sans être glissée dans Applications";
  if (cible.startsWith('/Volumes/')) return "l'app est lancée depuis le .dmg ou un disque externe";
  try { fs.accessSync(path.dirname(cible), fs.constants.W_OK); } catch { return `pas le droit de modifier ${path.dirname(cible)}`; }
  return null;
}

const versionDe = async (app) => (await lancer('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', path.join(app, 'Contents', 'Info.plist')])).trim();
const cachee = (cible, suffixe) => path.join(path.dirname(cible), `.${path.basename(cible, '.app')}-${suffixe}.app`);

// Copie la nouvelle app du .dmg à côté de l'actuelle (dossier caché) et vérifie sa version.
async function preparer(dmg, cible, version) {
  const montage = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ssd-maj-'));
  const nouveau = cachee(cible, 'maj');
  try {
    await lancer('hdiutil', ['attach', dmg, '-nobrowse', '-noautoopen', '-readonly', '-mountpoint', montage]);
    const nom = (await fs.promises.readdir(montage)).find((n) => n.endsWith('.app'));
    if (!nom) throw new Error("pas d'app dans le .dmg");
    await fs.promises.rm(nouveau, { recursive: true, force: true });
    await lancer('ditto', [path.join(montage, nom), nouveau]);
  } finally {
    await lancer('hdiutil', ['detach', montage, '-force']).catch(() => {});
    await fs.promises.rm(montage, { recursive: true, force: true }).catch(() => {});
  }
  await lancer('xattr', ['-dr', 'com.apple.quarantine', nouveau]).catch(() => {});
  const lue = await versionDe(nouveau);
  if (version && lue !== version) {
    await fs.promises.rm(nouveau, { recursive: true, force: true });
    throw new Error(`le .dmg contient la version ${lue} au lieu de ${version}`);
  }
  return nouveau;
}

// Le script attend la fin de l'app (pid), échange les deux apps, remet l'ancienne si besoin, puis relance.
// Les chemins lui sont passés en arguments : rien n'est interprété par le shell.
const SCRIPT = `#!/bin/sh
CIBLE="$1"; NOUVEAU="$2"; PID="$3"; ANCIEN="$4"; JOURNAL="$5"
note() { [ -n "$JOURNAL" ] && echo "$(date '+%H:%M:%S') $*" >> "$JOURNAL"; }
i=0
while kill -0 "$PID" 2>/dev/null && [ $i -lt 600 ]; do sleep 0.2; i=$((i+1)); done
note "app fermée (attente $i)"
rm -rf "$ANCIEN"
if mv "$CIBLE" "$ANCIEN"; then
  if mv "$NOUVEAU" "$CIBLE"; then
    rm -rf "$ANCIEN"; note "remplacée"
  else
    mv "$ANCIEN" "$CIBLE"; note "échec : ancienne app remise"
  fi
else
  note "échec : impossible de déplacer l'app actuelle"
fi
open "$CIBLE" && note "relancée"
`;

function lancerRemplacement(cible, nouveau, pid, journal = '') {
  const script = path.join(os.tmpdir(), `ssd-maj-${Date.now()}.sh`);
  fs.writeFileSync(script, SCRIPT, { mode: 0o700 });
  spawn('/bin/sh', [script, cible, nouveau, String(pid), cachee(cible, 'ancien'), journal], { detached: true, stdio: 'ignore' }).unref();
}

module.exports = { derniereVersion, telecharger, bundleActuel, raisonImpossible, preparer, lancerRemplacement, versionDe, DMG, DEPOT };
