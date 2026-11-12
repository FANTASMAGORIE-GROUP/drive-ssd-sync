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
  proposition: appeler('proposition'),
  renumeroter: appeler('renumeroter'),
  changerNumero: appeler('changer-numero'),
  ecrireContenu: appeler('ecrire-contenu'),
  ouvrirFichier: appeler('ouvrir-fichier'),
  ouvrirDoublons: appeler('ouvrir-doublons'),
  surProgres: ecouter('progres'),
  surDeconnexion: ecouter('google-deconnecte'),
  majEtat: appeler('maj-etat'),
  majInstaller: appeler('maj-installer'),
  surMaj: ecouter('maj'),
  surSsd: ecouter('ssd'),
  surLecture: ecouter('ssd-lecture'),
  surRetrait: ecouter('ssd-retire'),
  surErreur: ecouter('erreur'),
});
