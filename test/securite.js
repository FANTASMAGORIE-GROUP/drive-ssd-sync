// Test de sécurité : l'app ne doit RIEN modifier sur un SSD (fichiers vidéo, projets de montage…).
// Crée un faux disque (un dossier temporaire), y met des fichiers, fait lire le disque à l'app 20 fois,
// bloque et note toute tentative d'écriture, puis vérifie que chaque fichier est identique octet par octet.
// Usage (Windows) : npm run test:securite
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'faux-ssd-'));

// 1. Contenu typique d'un SSD de montage
const fichiers = {
  'Clip Lumière/RUSHS/A001_C003.mp4': 8,
  'Clip Lumière/RUSHS/A001_C004.MOV': 6,
  'Clip Lumière/Montage Lumière.prproj': 1,
  'Pub Maison Verte/Son/mix final.wav': 4,
  'Pub Maison Verte/Export/PUB_V3.mp4': 5,
  'Studio photos 2026/IMG_0001.CR3': 2,
  '.cache caché/proxy.tmp': 1,
  'fichier à la racine.mp4': 3,
};
for (const [chemin, mo] of Object.entries(fichiers)) {
  const complet = path.join(dossier, chemin);
  fs.mkdirSync(path.dirname(complet), { recursive: true });
  fs.writeFileSync(complet, crypto.randomBytes(mo * 1024 * 1024));
}

function empreintes() {
  const resultat = {};
  const parcourir = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { resultat[p] = 'dossier'; parcourir(p); continue; }
      const st = fs.statSync(p);
      resultat[p] = `${crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')} ${st.size} ${st.mtimeMs}`;
    }
  };
  parcourir(dossier);
  return resultat;
}
const avant = empreintes();

// 2. Toute écriture pendant la lecture par l'app est bloquée et notée
const tentatives = [];
const ECRITURES = ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'unlink', 'unlinkSync', 'rename',
  'renameSync', 'mkdir', 'mkdirSync', 'rm', 'rmSync', 'rmdir', 'rmdirSync', 'copyFile', 'copyFileSync', 'truncate',
  'truncateSync', 'utimes', 'utimesSync', 'chmod', 'chmodSync', 'createWriteStream', 'symlink', 'symlinkSync'];
const originaux = {};
for (const nom of ECRITURES) {
  originaux[nom] = fs[nom];
  fs[nom] = (...args) => { tentatives.push(`fs.${nom}(${String(args[0])})`); throw new Error('écriture interdite'); };
}
for (const nom of ['open', 'openSync']) {
  const orig = fs[nom];
  originaux[nom] = orig;
  fs[nom] = (p, flags, ...r) => {
    if (flags && !/^r$|^rs?$/.test(String(flags))) { tentatives.push(`fs.${nom}(${p}, ${flags})`); throw new Error('écriture interdite'); }
    return orig(p, flags, ...r);
  };
}
// Même chose pour les fonctions fs.promises (utilisées par la lecture de tous les fichiers).
const promesses = {};
for (const nom of ['writeFile', 'appendFile', 'unlink', 'rename', 'mkdir', 'rm', 'rmdir', 'copyFile', 'truncate', 'utimes', 'chmod', 'symlink']) {
  promesses[nom] = fs.promises[nom];
  fs.promises[nom] = async (...args) => { tentatives.push(`fs.promises.${nom}(${String(args[0])})`); throw new Error('écriture interdite'); };
}
const remettre = () => {
  for (const [nom, f] of Object.entries(originaux)) fs[nom] = f;
  for (const [nom, f] of Object.entries(promesses)) fs.promises[nom] = f;
};
// Les commandes lancées par l'app sont notées ; l'identité du disque est simulée (un dossier n'est pas un vrai disque).
const commandes = [];
const execFileOrig = cp.execFile;
cp.execFile = (cmd, args, opts, cb) => {
  commandes.push(`${cmd} ${args.join(' ')}`);
  cb(null, JSON.stringify({ s: 'TEST-SECURITE-001', u: '', m: 'Faux SSD de sécurité', sys: false }));
};

async function main() {
  try {
    const disk = require('../src/disk');
    let lu;
    for (let i = 0; i < 20; i++) lu = await disk.lireDisque(dossier);
    // Lecture de tous les dossiers et fichiers (Contenu et doublons), 5 fois.
    const scan = require('../src/scan');
    let tout;
    for (let i = 0; i < 5; i++) tout = await scan.scanner(dossier);
    remettre();
    cp.execFile = execFileOrig;

    const apres = empreintes();
    const modifies = Object.keys({ ...avant, ...apres }).filter((p) => avant[p] !== apres[p]);
    const interdites = commandes.filter((c) => !/^powershell -NoProfile -Command \$d = Get-Partition -DriveLetter [A-Z] \| Get-Disk;/.test(c));

    console.log(`\nFaux SSD : ${Object.keys(fichiers).length} fichiers (${Object.values(fichiers).reduce((a, b) => a + b)} Mo), lu 20 fois`);
    console.log(`Dossiers vus par l'app : ${lu ? lu.dossiers.join(', ') : 'aucun'}`);
    console.log(`Fichiers lus (5 fois)  : ${tout.fichiers.map(([c]) => c).join(', ')}`);
    console.log(`Tentatives d'écriture  : ${tentatives.length ? tentatives.join(' ; ') : 'aucune ✓'}`);
    console.log(`Commandes système      : ${commandes.length} lecture(s) seule(s) (Get-Partition / Get-Disk)${interdites.length ? ' — AUTRES : ' + interdites.join(' ; ') : ' ✓'}`);
    console.log(`Fichiers modifiés      : ${modifies.length ? modifies.join(' ; ') : 'aucun, tous identiques octet par octet ✓'}`);
    const ok = !tentatives.length && !interdites.length && !modifies.length;
    console.log(ok ? '\nRÉSULTAT : RÉUSSI — le SSD n\'a pas été touché.' : '\nRÉSULTAT : ÉCHEC');
    process.exitCode = ok ? 0 : 1;
  } finally {
    remettre();
    cp.execFile = execFileOrig;
    fs.rmSync(dossier, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error('Erreur du test :', e.message); process.exitCode = 1; });
