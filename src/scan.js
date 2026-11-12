// Lecture de tous les dossiers et fichiers d'un SSD (lecture seule : readdir et stat, rien d'autre).
const fs = require('fs');
const path = require('path');
const disk = require('./disk');

const IGNORES = new Set(['$recycle.bin', 'system volume information', 'recovery', 'found.000', '$extend', '$windows.~ws']);

const TYPES = {
  vidéos: /\.(mp4|mov|mxf|avi|mkv|m4v|mts|m2ts|r3d|braw|crm|insv|insp|lrv|360|webm)$/i,
  photos: /\.(jpe?g|png|heic|heif|cr2|cr3|arw|nef|dng|raf|orf|rw2|tiff?|psd|gif|webp)$/i,
  sons: /\.(wav|mp3|aac|m4a|aiff?|flac|ogg)$/i,
  projets: /\.(prproj|drp|aep|fcpxml|veg|psb|ai|indd)$/i,
};
const typeDe = (nom) => Object.keys(TYPES).find((t) => TYPES[t].test(nom)) || 'autres';

// Renvoie { fichiers: [[chemin relatif, taille en octets]], arbre } ; arbre résume les dossiers pour l'IA.
async function scanner(volume, surProgres = () => {}) {
  const fichiers = disk.FAUX ? disk.fichiersFaux(volume) : await parcourir(volume, surProgres);
  // Débranché pendant la lecture : la liste serait incomplète, on ne s'en sert pas.
  if (!disk.FAUX && !fs.existsSync(volume)) throw new Error('Le SSD a été débranché pendant la lecture des fichiers');
  return { fichiers, arbre: resumer(fichiers) };
}

async function parcourir(racine, surProgres) {
  const fichiers = [];
  const pile = [''];
  let dernier = 0;
  while (pile.length) {
    const rel = pile.pop();
    let entrees;
    try { entrees = await fs.promises.readdir(path.join(racine, rel), { withFileTypes: true }); } catch { continue; }
    const aStat = [];
    for (const e of entrees) {
      if (e.name.startsWith('.') || (!rel && IGNORES.has(e.name.toLowerCase()))) continue;
      const chemin = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) pile.push(chemin);
      else if (e.isFile()) aStat.push(chemin);
      // Les raccourcis (liens symboliques) ne sont pas suivis.
    }
    for (let i = 0; i < aStat.length; i += 64) {
      const lot = aStat.slice(i, i + 64);
      const tailles = await Promise.all(lot.map((c) => fs.promises.stat(path.join(racine, c)).then((s) => s.size, () => null)));
      // Chemins en écriture NFC : un même fichier lu sur Mac et sur Windows doit avoir le même nom pour les doublons.
      lot.forEach((c, j) => { if (tailles[j] !== null) fichiers.push([c.normalize('NFC'), tailles[j]]); });
    }
    if (fichiers.length - dernier >= 500) { dernier = fichiers.length; surProgres(fichiers.length); }
  }
  return fichiers;
}

// Pour chaque dossier de premier niveau : ses sous-dossiers (2 niveaux), le nombre de fichiers par type et la taille.
function resumer(fichiers) {
  const dossiers = {};
  const racine = { fichiers: 0 };
  for (const [chemin, taille] of fichiers) {
    const parts = chemin.split('/');
    if (parts.length === 1) { racine.fichiers += 1; continue; }
    const d = dossiers[parts[0]] ||= { sous: {}, types: {}, go: 0 };
    d.types[typeDe(chemin)] = (d.types[typeDe(chemin)] || 0) + 1;
    d.go += taille / 1e9;
    if (parts.length > 2) {
      const s = d.sous[parts[1]] ||= new Set();
      if (parts.length > 3) s.add(parts[2]);
    }
  }
  return Object.entries(dossiers)
    .sort(([a], [b]) => a.localeCompare(b, 'fr'))
    .slice(0, 60)
    .map(([nom, d]) => ({
      dossier: nom,
      taille_go: +d.go.toFixed(1),
      fichiers: d.types,
      sous_dossiers: Object.entries(d.sous).slice(0, 40).map(([s, petits]) => (petits.size ? { [s]: [...petits].slice(0, 15) } : s)),
    }))
    .concat(racine.fichiers ? [{ dossier: '(racine du disque)', fichiers: { tous: racine.fichiers } }] : []);
}

module.exports = { scanner, resumer };
