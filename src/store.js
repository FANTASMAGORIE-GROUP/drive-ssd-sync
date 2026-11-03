// Réglages locaux (lien du fichier, prénom, jeton Google chiffré par le système).
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const fichier = () => path.join(app.getPath('userData'), 'reglages.bin');

function lireTout() {
  try {
    const brut = fs.readFileSync(fichier());
    return JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(brut) : brut.toString());
  } catch { return {}; }
}

function ecrireTout(data) {
  const texte = JSON.stringify(data);
  fs.writeFileSync(fichier(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(texte) : texte);
}

module.exports = {
  get: (cle) => lireTout()[cle],
  set: (cle, valeur) => { const d = lireTout(); d[cle] = valeur; ecrireTout(d); },
  supprimer: (cle) => { const d = lireTout(); delete d[cle]; ecrireTout(d); },
};
