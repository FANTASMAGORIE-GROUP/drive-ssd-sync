// Détection des SSD branchés (Windows et Mac) et lecture de leurs infos.
const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

const WINDOWS = process.platform === 'win32';
// Dossiers système à ne pas lister (en minuscules) ; les dossiers cachés commencent par « . ».
const IGNORES = new Set(['$recycle.bin', 'system volume information', 'recovery', 'found.000', '$extend', '$windows.~ws']);

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 50 * 1024 * 1024, timeout: 30000 }, (err, stdout) => resolve(err ? '' : stdout));
  });
}

// Mode test (npm run test:faux) : de faux SSD que l'app « branche » quand on lui demande un disque,
// avec le délai d'un vrai branchement (montage par le système + lecture du numéro de série).
const FAUX = process.argv.includes('--faux-ssd');
// Noms des faux SSD : avec un n° libre, sans n°, avec un n° sûrement déjà pris, avec un n° glissé dans le nom.
const NOMS_FAUX = ['', 'SSD 12', 'Samsung T7', 'SSD 1', 'DISQUE40'];
const fauxDisque = (n, total, utilise, dossiers) => ({
  volume: `FAUX-SSD-${n}`,
  nom: NOMS_FAUX[n],
  serial: `TEST-FAUX-SSD-000${n}`,
  modele: `Samsung T7 Shield ${total}To (faux n°${n})`,
  total_to: total,
  utilise_to: utilise,
  restant_to: +(total - utilise).toFixed(2),
  pourcent: +((utilise / total) * 100).toFixed(1),
  dossiers,
});
const FAUX_DISQUES = [
  fauxDisque(1, 2, 1.42, ['Clip Lumière', 'Pub Maison Verte', 'Rushs Mariage Léa', 'Studio photos 2026']),
  fauxDisque(2, 2, 1.91, ['CreativGen', 'Webedia', 'Site web CG']),
  fauxDisque(3, 1, 0.37, ['PB Noël Backstage', 'Petite Romance rushs']),
  fauxDisque(4, 4, 2.6, ['Archives 2024', 'Archives 2025', 'Vertbaudet lutin', 'Share fresh']),
];
let fauxBranche = null;

// Faux fichiers des faux SSD, avec des doublons dans un même disque et entre les disques 1 et 4.
function fichiersFaux(volume) {
  const n = FAUX_DISQUES.findIndex((d) => d.volume === volume);
  if (n < 0) return [];
  const liste = [];
  FAUX_DISQUES[n].dossiers.forEach((dossier, i) => {
    for (let k = 1; k <= 3; k++) {
      liste.push([`${dossier}/RUSH/A0${n}${i}_C00${k}.MP4`, (n + i + k) * 1e9 + n * 7]);
      liste.push([`${dossier}/PHOTOS/IMG_${n}${i}${k}.CR3`, 3e7 + n * 1000 + i * 10 + k]);
    }
    liste.push([`${dossier}/SON/mix ${dossier}.wav`, 2e8 + i]);
    liste.push([`${dossier}/MONTAGE/${dossier}.prproj`, 5e6 + i]);
    liste.push([`${dossier}/MONTAGE/Backup/${dossier}.prproj`, 5e6 + i]);
  });
  if (n === 0) liste.push(['Clip Lumière/EXPORT/Clip Lumière final.mov', 4.2e9]);
  if (n === 3) liste.push(['Archives 2025/Clip Lumière/Clip Lumière final.mov', 4.2e9], ['Archives 2025/Clip Lumière/A000_C001.MP4', 1e9]);
  return liste;
}

function brancherFaux(serialsPris, serialVoulu) {
  const d = FAUX_DISQUES.find((f) => f.serial === serialVoulu) || FAUX_DISQUES.find((f) => !serialsPris.includes(f.serial));
  if (!d) return;
  fauxBranche = null;
  setTimeout(() => { fauxBranche = d; }, 3000 + Math.random() * 3000);
}

function volumesMontes() {
  if (FAUX) return fauxBranche ? [fauxBranche.volume] : [];
  if (WINDOWS) {
    const systeme = (process.env.SystemDrive || 'C:').toUpperCase();
    return 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('')
      .map((l) => `${l}:\\`)
      .filter((v) => v.slice(0, 2) !== systeme && fs.existsSync(v));
  }
  try {
    return fs.readdirSync('/Volumes')
      .map((v) => path.join('/Volumes', v))
      .filter((v) => !fs.lstatSync(v).isSymbolicLink());
  } catch { return []; }
}

async function identiteWindows(volume) {
  const ps = `$d = Get-Partition -DriveLetter ${volume[0]} | Get-Disk; ` +
    `$n = (Get-Volume -DriveLetter ${volume[0]}).FileSystemLabel; ` +
    '[pscustomobject]@{s=$d.SerialNumber;u=$d.UniqueId;m=$d.FriendlyName;n=$n;sys=($d.IsBoot -or $d.IsSystem)} | ConvertTo-Json';
  const out = await run('powershell', ['-NoProfile', '-Command', ps]);
  if (!out.trim()) return null;
  const d = JSON.parse(out);
  if (d.sys) return null;
  return { serial: (d.s || '').trim() || d.u, modele: d.m, nom: (d.n || '').trim() };
}

function chercherSerial(noeud, bsd) {
  if (Array.isArray(noeud)) {
    for (const enfant of noeud) {
      const trouve = chercherSerial(enfant, bsd);
      if (trouve) return trouve;
    }
  } else if (noeud && typeof noeud === 'object') {
    if (noeud.bsd_name === bsd) return noeud.serial_num || noeud.device_serial;
    return chercherSerial(Object.values(noeud), bsd);
  }
  return null;
}

async function identiteMac(volume) {
  // Pas de shell : le nom du volume est passé tel quel, il ne peut pas être interprété comme une commande.
  const plist = await run('diskutil', ['info', '-plist', volume]);
  if (!plist) return null;
  let brut;
  try { brut = execFileSync('plutil', ['-convert', 'json', '-o', '-', '-'], { input: plist }).toString(); } catch { return null; }
  const info = JSON.parse(brut);
  if (info.Internal) return null;
  let serial = null;
  for (const type of ['SPUSBDataType', 'SPThunderboltDataType', 'SPNVMeDataType']) {
    const sortie = await run('system_profiler', [type, '-json']);
    if (sortie) serial = chercherSerial(JSON.parse(sortie), info.ParentWholeDisk);
    if (serial) break;
  }
  return { serial: serial || info.VolumeUUID, modele: info.MediaName || '', nom: info.VolumeName || path.basename(volume) };
}

async function lireDisque(volume) {
  if (FAUX) return fauxBranche && fauxBranche.volume === volume ? { ...fauxBranche } : null;
  const ident = WINDOWS ? await identiteWindows(volume) : await identiteMac(volume);
  if (!ident || !ident.serial) return null;
  const s = await fs.promises.statfs(volume);
  const total = s.blocks * s.bsize;
  const libre = s.bavail * s.bsize;
  const to = 1e12;
  const dossiers = fs.readdirSync(volume, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !IGNORES.has(e.name.toLowerCase()))
    // Même écriture partout : accents « à la Mac » recomposés, espaces en trop au début et à la fin enlevés.
    .map((e) => e.name.normalize('NFC').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'fr'));
  return {
    volume,
    serial: ident.serial,
    modele: ident.modele,
    nom: ident.nom || '',
    total_to: +(total / to).toFixed(2),
    utilise_to: +((total - libre) / to).toFixed(2),
    restant_to: +(libre / to).toFixed(2),
    pourcent: +(((total - libre) / total) * 100).toFixed(1),
    dossiers,
  };
}

module.exports = {
  volumesMontes, lireDisque, FAUX, brancherFaux, fichiersFaux, debrancherFaux: () => { fauxBranche = null; },
};
