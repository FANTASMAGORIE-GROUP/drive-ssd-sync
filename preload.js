const { contextBridge, ipcRenderer } = require('electron');

const appeler = (canal) => (...args) => ipcRenderer.invoke(canal, ...args);
const ecouter = (canal) => (fn) => ipcRenderer.on(canal, (_e, data) => fn(data));

contextBridge.exposeInMainWorld('app', {
  etatInitial: appeler('etat-initial'),
  connecter: appeler('connecter'),
  choisirFichier: appeler('choisir-fichier'),
  nom: appeler('nom'),
  cleOpenai: appeler('cle-openai'),
  disques: appeler('disques'),
  attendre: appeler('attendre'),
  liberer: appeler('liberer'),
  verifier: appeler('verifier'),
  synchroniser: appeler('synchroniser'),
  ajouter: appeler('ajouter'),
  renumeroter: appeler('renumeroter'),
  ouvrirFichier: appeler('ouvrir-fichier'),
  changerFichier: appeler('changer-fichier'),
  surSsd: ecouter('ssd'),
  surLecture: ecouter('ssd-lecture'),
  surRetrait: ecouter('ssd-retire'),
  surErreur: ecouter('erreur'),
});
