// Garde-fous avant d'écrire dans le Google Sheets.
const { normalize } = String.prototype;

// Une cellule qui commence par = + - @ devient une formule dans Sheets (injection de formule) :
// l'apostrophe la force en texte.
const proteger = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

const sansAccent = (s) => normalize.call(String(s), 'NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

// L'IA choisit seulement les colonnes : chaque valeur doit être exactement une mesure du disque,
// et aller dans une colonne qui correspond. Tout le reste est rejeté (protège contre un nom de
// dossier qui essaierait de donner des ordres à l'IA).
const ATTENDU = [
  [/CAPACIT/, (d) => d.total_to],
  [/UTILIS/, (d) => d.utilise_to],
  [/RESTANT/, (d) => d.restant_to],
  [/^%$|POURCENT/, (d) => d.pourcent],
  [/PROJET/, (d) => d.dossiers.join('\n')],
];

function validerMaj(maj, d) {
  const propre = {};
  for (const [entete, valeur] of Object.entries(maj || {})) {
    const regle = ATTENDU.find(([motif]) => motif.test(sansAccent(entete).trim()));
    if (!regle) continue;
    const attendu = regle[1](d);
    const recu = Array.isArray(valeur) ? valeur.join('\n') : valeur;
    if (typeof attendu === 'number') {
      if (Number(String(recu).replace(',', '.')) === attendu) propre[entete] = attendu;
    } else if (String(recu).split(/\n|, /).map((x) => x.trim()).join('\n') === attendu) {
      propre[entete] = attendu;
    }
  }
  return propre;
}

module.exports = { proteger, validerMaj };
