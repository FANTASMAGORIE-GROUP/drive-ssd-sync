// Test de la mise à jour Mac, sur un vrai Mac (lancé par GitHub Actions : .github/workflows/test-maj-mac.yml).
// 1. Installe une ancienne version publiée dans /Applications et la lance.
// 2. Fait exactement ce que fait l'app : télécharge la dernière version, vérifie l'empreinte, prépare,
//    lance le script de remplacement puis ferme l'ancienne app.
// 3. Vérifie : nouvelle version en place, plus de dossiers cachés, pas de marque « venu d'internet »,
//    app relancée. Puis vérifie qu'un remplacement raté remet l'ancienne app.
// Usage (Mac) : node test/maj-mac.js v1.1.3
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const mac = require('../src/maj-mac');

const ANCIENNE = process.argv[2] || 'v1.1.3';
const CIBLE = '/Applications/SSD Drive Sync.app';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-maj-'));
const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));
const resultats = [];
const verifier = (ok, texte) => { resultats.push(`${ok ? '✅' : '❌'} ${texte}`); console.log(resultats.at(-1)); };
const quarantaine = (p) => { try { execFileSync('xattr', ['-p', 'com.apple.quarantine', p], { stdio: 'pipe' }); return true; } catch { return false; } };
const pidApp = () => {
  try { return Number(execFileSync('pgrep', ['-f', `${CIBLE}/Contents/MacOS/`]).toString().trim().split('\n')[0]) || null; } catch { return null; }
};
async function jusqua(fn, ms) {
  for (const fin = Date.now() + ms; Date.now() < fin; await attendre(500)) if (await fn()) return true;
  return false;
}

async function installerAncienne() {
  const dmg = path.join(tmp, 'ancienne.dmg');
  const r = await fetch(`https://github.com/${mac.DEPOT}/releases/download/${ANCIENNE}/${mac.DMG}`);
  await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(dmg));
  const montage = path.join(tmp, 'montage');
  fs.mkdirSync(montage);
  execFileSync('hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-mountpoint', montage]);
  fs.rmSync(CIBLE, { recursive: true, force: true });
  execFileSync('ditto', [path.join(montage, 'SSD Drive Sync.app'), CIBLE]);
  execFileSync('hdiutil', ['detach', montage, '-force']);
}

(async () => {
  console.log(`macOS ${execFileSync('sw_vers', ['-productVersion']).toString().trim()} · ${os.arch()}`);

  // 1. Ancienne version installée et lancée
  await installerAncienne();
  const avant = await mac.versionDe(CIBLE);
  verifier(avant === ANCIENNE.replace(/^v/, ''), `ancienne version installée : ${avant}`);
  spawn('open', [CIBLE], { stdio: 'ignore' });
  let pid = (await jusqua(() => pidApp(), 30000)) && pidApp();
  const appLancee = !!pid;
  verifier(true, appLancee ? `ancienne app lancée (pid ${pid})` : "l'app ne se lance pas sur cette machine : un faux processus la remplace");
  if (!pid) { const faux = spawn('sleep', ['600'], { detached: true }); pid = faux.pid; }

  // 2. Ce que fait l'app
  const info = await mac.derniereVersion();
  verifier(info && info.sha512, `dernière version publiée : ${info && info.version}, empreinte sha512 lue`);
  const debut = Date.now();
  const fichier = await mac.telecharger(info, path.join(tmp, 'maj'));
  verifier(true, `.dmg téléchargé et vérifié (${Math.round(info.taille / 1e6)} Mo en ${Math.round((Date.now() - debut) / 1000)} s)`);
  verifier(!quarantaine(fichier), '.dmg téléchargé par l\'app sans marque « venu d\'internet »');
  verifier(mac.raisonImpossible(CIBLE) === null, `remplacement possible dans ${path.dirname(CIBLE)}`);
  const nouveau = await mac.preparer(fichier, CIBLE, info.version);
  verifier(fs.existsSync(nouveau) && path.basename(nouveau).startsWith('.'), `nouvelle app préparée en caché : ${path.basename(nouveau)}`);
  const journal = path.join(tmp, 'journal.txt');
  mac.lancerRemplacement(CIBLE, nouveau, pid, journal);
  process.kill(pid, 'SIGTERM'); // = l'app se ferme (app.quit)

  // 3. Résultat
  const remplacee = await jusqua(async () => !fs.existsSync(nouveau) && (await mac.versionDe(CIBLE).catch(() => '')) === info.version, 60000);
  verifier(remplacee, `app remplacée : ${await mac.versionDe(CIBLE).catch(() => '?')} (attendu ${info.version})`);
  const restes = fs.readdirSync('/Applications').filter((n) => n.startsWith('.SSD Drive Sync'));
  verifier(!restes.length, `aucun dossier caché oublié dans Applications${restes.length ? ` : ${restes}` : ''}`);
  verifier(!quarantaine(CIBLE), 'nouvelle app sans marque « venu d\'internet » (pas d\'avertissement Gatekeeper)');
  const relancee = await jusqua(() => pidApp() && pidApp() !== pid, 30000);
  verifier(relancee || !appLancee, relancee ? `nouvelle app relancée (pid ${pidApp()})` : 'relance non vérifiable (l\'app ne se lance pas ici)');
  console.log(`Journal du script :\n${fs.existsSync(journal) ? fs.readFileSync(journal, 'utf8') : '(vide)'}`);

  // 4. Remplacement raté : l'ancienne app doit être remise en place
  const installee = await mac.versionDe(CIBLE);
  const pidRelance = pidApp();
  if (pidRelance) process.kill(pidRelance, 'SIGTERM');
  const journal2 = path.join(tmp, 'journal2.txt');
  mac.lancerRemplacement(CIBLE, path.join(tmp, 'inexistante.app'), 999999, journal2);
  await jusqua(() => fs.existsSync(journal2) && fs.readFileSync(journal2, 'utf8').includes('échec'), 20000);
  await attendre(2000);
  verifier(fs.existsSync(CIBLE) && (await mac.versionDe(CIBLE)) === installee, `échec simulé : l'app ${installee} est toujours là`);
  const p = pidApp(); if (p) process.kill(p, 'SIGTERM');

  const echecs = resultats.filter((r) => r.startsWith('❌')).length;
  console.log(`\n${resultats.length - echecs}/${resultats.length} vérifications réussies`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('Erreur du test :', e); process.exit(1); });
