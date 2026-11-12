// Garde-fous avant d'écrire dans le Google Sheets.
const { normalize } = String.prototype;

// Une cellule qui commence par = + - @ devient une formule dans Sheets (injection de formule) :
// l'apostrophe la force en texte.
const proteger = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

const sansAccent = (s) => normalize.call(String(s), 'NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

// Colonnes remplies avec les mesures du disque, reconnues par leur titre. Pas d'IA ici : la valeur écrite
// est exactement la mesure, et un nom de dossier ne peut rien faire d'autre que s'afficher dans Projets.
const ATTENDU = [
  [/CAPACIT/, (d) => d.total_to],
  [/UTILIS/, (d) => d.utilise_to],
  [/RESTANT/, (d) => d.restant_to],
  [/^%$|POURCENT/, (d) => d.pourcent],
  [/PROJET/, (d) => d.dossiers.join('\n')],
];

// Seule la première colonne de chaque sorte est remplie (les statistiques globales à droite ne bougent pas).
function majDirecte(entetes, d) {
  const maj = {};
  const faites = new Set();
  for (const entete of entetes) {
    const i = ATTENDU.findIndex(([motif]) => motif.test(sansAccent(entete ?? '').trim()));
    if (i < 0 || faites.has(i)) continue;
    faites.add(i);
    maj[String(entete)] = ATTENDU[i][1](d);
  }
  return maj;
}

module.exports = { proteger, majDirecte };
