const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('app', {
  etatInitial: () => ipcRenderer.invoke('etat-initial'),
  connecter: () => ipcRenderer.invoke('connecter'),
  choisirFichier: (lien) => ipcRenderer.invoke('choisir-fichier', lien),
  nom: (nom) => ipcRenderer.invoke('nom', nom),
  cleOpenai: (cle) => ipcRenderer.invoke('cle-openai', cle),
  numero: (n) => ipcRenderer.invoke('numero', n),
  rescanner: () => ipcRenderer.invoke('rescanner'),
  ouvrirFichier: () => ipcRenderer.invoke('ouvrir-fichier'),
  changerFichier: () => ipcRenderer.invoke('changer-fichier'),
  surEtat: (fn) => ipcRenderer.on('etat', (_e, data) => fn(data)),
});
