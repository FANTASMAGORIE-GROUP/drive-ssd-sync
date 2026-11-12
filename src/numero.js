// Trouve le n° du disque dans le nom du SSD (« SSD 12 », « Disque n°7 », « SSD12 », « #3 »…).
// Ignore la capacité (« 2To », « 4 TB »), les modèles (« T7 », « A7SIII ») et les années (« 2025 »).
const PREFIXES = new Set(['', 'ssd', 'disque', 'disk', 'dd', 'hdd', 'hd', 'n', 'no', 'nr', 'num', 'numero', 'numéro']);

function numeroDansNom(nom) {
  if (!nom) return null;
  const propre = String(nom).replace(/\d+(?:[.,]\d+)?\s*(?:to|tb|go|gb|mo|mb|t|g)(?![\p{L}\d])/giu, ' ');
  for (const [, prefixe, chiffres] of propre.matchAll(/([\p{L}°#]*)(\d+)(?![\p{L}\d])/gu)) {
    if (chiffres.length > 3) continue;
    if (!PREFIXES.has(prefixe.replace(/[°#]/g, '').toLowerCase())) continue;
    const n = parseInt(chiffres, 10);
    if (n > 0) return String(n);
  }
  return null;
}

module.exports = { numeroDansNom };
