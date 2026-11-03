// Mise en forme de l'onglet GÉNÉRAL, reprise du fichier d'Anne : en-tête gris, n° en vert, capacité en bleu,
// « Utilisé » en rouge, « Restant » en vert, Projets en vert, et le % coloré selon le remplissage.
const rgb = (r, g, b) => ({ red: r / 255, green: g / 255, blue: b / 255 });
const GRIS = rgb(204, 204, 204);
const VERT = rgb(182, 215, 168);
const BLEU = rgb(201, 218, 248);
const trait = { style: 'SOLID', width: 1 };
const bordures = { top: trait, bottom: trait, left: trait, right: trait };
const LARGEURS = [82, 119, 54, 58, 43, 109, 347, 373, 146, 160];
const FIN = 300;

function styleGeneral(sheetId) {
  const zone = (r0, r1, c0, c1) => ({ sheetId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });
  const cellule = (range, format) => ({
    repeatCell: { range, cell: { userEnteredFormat: format }, fields: `userEnteredFormat(${Object.keys(format).join(',')})` },
  });
  const base = { borders: bordures, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' };
  const pourcent = (condition, valeurs, couleur) => ({
    addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [zone(1, FIN, 4, 5)],
        booleanRule: { condition: { type: condition, values: valeurs.map((v) => ({ userEnteredValue: v })) }, format: { backgroundColor: couleur } },
      },
    },
  });
  return [
    { updateSheetProperties: { properties: { sheetId, gridProperties: { hideGridlines: true, frozenRowCount: 1 } }, fields: 'gridProperties(hideGridlines,frozenRowCount)' } },
    ...LARGEURS.map((px, i) => ({
      updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' },
    })),
    cellule(zone(0, 1, 0, 10), { ...base, backgroundColor: GRIS, textFormat: { bold: true } }),
    cellule(zone(1, FIN, 0, 10), base),
    cellule(zone(1, FIN, 0, 1), { backgroundColor: VERT, textFormat: { bold: true } }),
    cellule(zone(1, FIN, 1, 2), { backgroundColor: BLEU }),
    cellule(zone(1, FIN, 2, 3), { textFormat: { bold: true, foregroundColor: rgb(234, 67, 53) } }),
    cellule(zone(1, FIN, 3, 4), { textFormat: { bold: true, foregroundColor: rgb(106, 168, 79) } }),
    cellule(zone(1, FIN, 6, 7), { backgroundColor: VERT }),
    cellule(zone(1, FIN, 7, 8), { horizontalAlignment: 'LEFT' }),
    pourcent('NUMBER_LESS', ['70'], rgb(183, 225, 205)),
    pourcent('NUMBER_BETWEEN', ['70', '90'], rgb(252, 232, 178)),
    pourcent('NUMBER_GREATER', ['90'], rgb(244, 199, 195)),
  ];
}

module.exports = { styleGeneral };
