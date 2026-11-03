// Détection des SSD branchés (Windows et Mac) et lecture de leurs infos.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const WINDOWS = process.platform === 'win32';
const IGNORES = new Set(['$RECYCLE.BIN', 'System Volume Information', 'Recovery', 'found.000']);

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 50 * 1024 * 1024, timeout: 30000 }, (err, stdout) => resolve(err ? '' : stdout));
  });
}

function volumesMontes() {
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
    '[pscustomobject]@{s=$d.SerialNumber;u=$d.UniqueId;m=$d.FriendlyName;sys=($d.IsBoot -or $d.IsSystem)} | ConvertTo-Json';
  const out = await run('powershell', ['-NoProfile', '-Command', ps]);
  if (!out.trim()) return null;
  const d = JSON.parse(out);
  if (d.sys) return null;
  return { serial: (d.s || '').trim() || d.u, modele: d.m };
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
  const brut = await run('/bin/sh', ['-c', `diskutil info -plist "${volume.replace(/"/g, '')}" | plutil -convert json -o - -`]);
  if (!brut) return null;
  const info = JSON.parse(brut);
  if (info.Internal) return null;
  let serial = null;
  for (const type of ['SPUSBDataType', 'SPThunderboltDataType', 'SPNVMeDataType']) {
    const sortie = await run('system_profiler', [type, '-json']);
    if (sortie) serial = chercherSerial(JSON.parse(sortie), info.ParentWholeDisk);
    if (serial) break;
  }
  return { serial: serial || info.VolumeUUID, modele: info.MediaName || '' };
}

async function lireDisque(volume) {
  const ident = WINDOWS ? await identiteWindows(volume) : await identiteMac(volume);
  if (!ident || !ident.serial) return null;
  const s = await fs.promises.statfs(volume);
  const total = s.blocks * s.bsize;
  const libre = s.bavail * s.bsize;
  const to = 1e12;
  const dossiers = fs.readdirSync(volume, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !/^[.$]/.test(e.name) && !IGNORES.has(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'fr'));
  return {
    volume,
    serial: ident.serial,
    modele: ident.modele,
    total_to: +(total / to).toFixed(2),
    utilise_to: +((total - libre) / to).toFixed(2),
    restant_to: +(libre / to).toFixed(2),
    pourcent: +(((total - libre) / total) * 100).toFixed(1),
    dossiers,
  };
}

module.exports = { volumesMontes, lireDisque };
