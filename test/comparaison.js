// Tests du diagnostic SSD ↔ NAS : bon classement des fichiers, cas tordus (accents Mac/NAS, majuscules,
// fichiers techniques du NAS), lecture seule vérifiée octet par octet, NAS déconnecté pendant la lecture.
// Usage : npm run test:comparaison
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const comparaison = require('../src/comparaison');

const resultats = [];
const verifier = async (nom, fn) => {
  try { resultats.push(['✅', nom, (await fn()) || '']); } catch (e) { resultats.push(['❌', nom, e.message]); }
};
const affirmer = (cond, message) => { if (!cond) throw new Error(message); };
const dossier = () => fs.mkdtempSync(path.join(os.tmpdir(), 'comparaison-'));
const ecrire = (racine, chemin, octets) => {
  fs.mkdirSync(path.dirname(path.join(racine, chemin)), { recursive: true });
  fs.writeFileSync(path.join(racine, chemin), crypto.randomBytes(octets));
};
function empreintes(racine) {
  const r = {};
  const parcourir = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) parcourir(p);
      else { const s = fs.statSync(p); r[p] = `${crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')} ${s.mtimeMs}`; }
    }
  };
  parcourir(racine);
  return r;
}

async function main() {
  const ssd = dossier();
  const nas = dossier();
  // Sauvegardés : même chemin et même taille, y compris avec accents écrits différemment (Mac = NFD) et majuscules.
  ecrire(ssd, 'Clip Lumière/RUSHS/A001.mov', 3000);
  ecrire(nas, 'Clip Lumière/RUSHS/A001.mov', 3000);
  ecrire(ssd, 'Pub/Export/PUB_V3.mp4', 2000);
  ecrire(nas, 'PUB/export/pub_v3.MP4', 2000);
  // Manquants sur le NAS.
  ecrire(ssd, 'Clip Lumière/RUSHS/A002.mov', 5000);
  ecrire(ssd, '=SOMME(1;2) piège.mp4', 100);
  // Différent : copie interrompue (taille plus petite sur le NAS).
  ecrire(ssd, 'Pub/Export/PUB_V4.mp4', 8000);
  ecrire(nas, 'Pub/Export/PUB_V4.mp4', 1200);
  // Seulement sur le NAS.
  ecrire(nas, 'Archives/2024/vieux.mov', 700);
  // Fichiers techniques : jamais comptés.
  ecrire(ssd, '.DS_Store', 10);
  ecrire(ssd, 'Clip Lumière/._A001.mov', 10);
  ecrire(nas, '@eaDir/Clip Lumière/A001.mov@SynoEAStream', 10);
  ecrire(nas, '#recycle/supprime.mov', 10);
  ecrire(nas, 'Thumbs.db', 10);

  let r;
  let s;

  // Doublon rangé ailleurs sur le NAS : même nom et même taille, autre dossier.
  ecrire(ssd, 'Studio/IMG_0001.CR3', 4000);
  fs.mkdirSync(path.join(nas, 'Photos rangées'), { recursive: true });
  fs.copyFileSync(path.join(ssd, 'Studio/IMG_0001.CR3'), path.join(nas, 'Photos rangées/img_0001.cr3'));

  await verifier('Doublons trouvés (même nom + même taille), le reste est « seulement sur le SSD »', async () => {
    r = comparaison.comparer(await comparaison.lister(ssd), await comparaison.lister(nas));
    s = comparaison.resume(r, 'SSD', 'NAS');
    affirmer(s.doublons === 3, `${s.doublons} doublons au lieu de 3 : ${r.doublons.map((f) => f.chemin).join(', ')}`);
    affirmer(s.uniques === 3, `${s.uniques} seulement sur le SSD au lieu de 3 : ${r.uniques.map((f) => f.chemin).join(', ')}`);
    return '3 doublons, 3 seulement sur le SSD';
  });

  await verifier('Doublon rangé dans un autre dossier du NAS reconnu', async () => {
    const f = r.doublons.find((x) => x.chemin === 'Studio/IMG_0001.CR3');
    affirmer(f && f.ou[0] === 'Photos rangées/img_0001.cr3', JSON.stringify(f));
    return `Studio/IMG_0001.CR3 trouvé dans « ${f.ou[0]} »`;
  });

  await verifier('Accents Mac/NAS et majuscules reconnus comme le même fichier', async () => {
    affirmer(r.doublons.some((f) => f.chemin.startsWith('Clip Lumière')), 'accent Mac non reconnu');
    affirmer(r.doublons.some((f) => f.chemin === 'Pub/Export/PUB_V3.mp4'), 'majuscules non reconnues');
    return 'Lumière (NFC) = Lumière (NFD), PUB_V3.mp4 = pub_v3.MP4';
  });

  await verifier('Même nom mais taille différente : pas un doublon', async () => {
    affirmer(r.uniques.some((f) => f.chemin === 'Pub/Export/PUB_V4.mp4'), 'PUB_V4 compté comme doublon');
    return 'PUB_V4.mp4 (copie coupée) reste « seulement sur le SSD »';
  });

  await verifier('Fichiers techniques ignorés (.DS_Store, ._, @eaDir, #recycle, Thumbs.db)', async () => {
    const tous = [...r.doublons, ...r.uniques].map((f) => f.chemin);
    affirmer(!tous.some((c) => /DS_Store|(^|\/)\._|@eaDir|#recycle|Thumbs/i.test(c)), `compté : ${tous.join(', ')}`);
    return 'aucun compté';
  });

  await verifier('Deux dossiers sans rapport : prévenu', async () => {
    const autre = dossier();
    ecrire(autre, 'base/ibdata1', 500);
    const x = comparaison.resume(comparaison.comparer(await comparaison.lister(ssd), await comparaison.lister(autre)), 'SSD', 'Autre');
    fs.rmSync(autre, { recursive: true, force: true });
    affirmer(x.rienEnCommun, "pas d'alerte");
    return 'alerte « aucun fichier en commun »';
  });

  const avant = { ...empreintes(ssd), ...empreintes(nas) };
  await comparaison.lister(ssd);
  await comparaison.lister(nas);
  await verifier('Lecture seule : aucun fichier modifié des deux côtés', async () => {
    const apres = { ...empreintes(ssd), ...empreintes(nas) };
    const modifies = Object.keys({ ...avant, ...apres }).filter((p) => avant[p] !== apres[p]);
    affirmer(!modifies.length, `modifiés : ${modifies.join(', ')}`);
    return `${Object.keys(avant).length} fichiers identiques octet par octet, mêmes dates`;
  });

  await verifier('Dossier introuvable (NAS non connecté) : message clair', async () => {
    try { await comparaison.lister(path.join(nas, 'nexiste-pas')); } catch (e) {
      affirmer(/NAS/.test(e.message), e.message);
      return e.message;
    }
    throw new Error('aucune erreur');
  });

  await verifier('NAS déconnecté pendant la lecture : pas de résultat faux', async () => {
    const gros = dossier();
    for (let i = 0; i < 400; i++) ecrire(gros, `Projet ${i}/rush.mov`, 10);
    const lecture = comparaison.lister(gros).then(() => 'fini', (e) => e.message);
    fs.rmSync(gros, { recursive: true, force: true });
    const fin = await lecture;
    affirmer(fin !== 'fini', 'un résultat a été rendu malgré la déconnexion');
    return fin;
  });

  await verifier('Annulation en cours de lecture', async () => {
    let n = 0;
    try { await comparaison.lister(ssd, () => {}, () => (n += 1) > 1); } catch (e) {
      affirmer(e instanceof comparaison.Annule, e.message);
      return 'arrêt propre';
    }
    throw new Error('pas annulé');
  });

  fs.rmSync(ssd, { recursive: true, force: true });
  fs.rmSync(nas, { recursive: true, force: true });
  console.log('');
  for (const [etat, nom, detail] of resultats) console.log(`${etat} ${nom}\n     ${detail}`);
  const echecs = resultats.filter((x) => x[0] === '❌').length;
  console.log(`\n${resultats.length - echecs}/${resultats.length} réussis`);
  process.exitCode = echecs ? 1 : 0;
}

main();
