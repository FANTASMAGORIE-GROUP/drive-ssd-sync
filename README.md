# SSD Drive Sync

App de bureau (Windows + Mac) : quand un SSD est branché, elle le reconnaît par son numéro de série
et remplit le Google Sheets des disques (onglet GÉNÉRAL + une ligne dans Emprunt Disque).
OpenAI choisit les colonnes à remplir ; Localisation, Contenu, État et Sauvegarde ne sont jamais touchés,
ni les cellules qui contiennent une formule.

## Développement
1. `npm install`
2. Créer `secrets.json` (non commité) : `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OPENAI_API_KEY`.
3. `npm start`

## Installeurs
Actions > « Compiler l'app » > Run workflow (ou pousser un tag `v*`).
Les secrets GitHub `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` doivent être définis.
La clé OpenAI n'est jamais intégrée à l'installeur : elle est demandée une fois au premier lancement.
Le `.exe` et le `.dmg` sont dans les artefacts du run. Ils ne sont pas signés : Windows affiche
« Informations complémentaires > Exécuter quand même », Mac demande clic droit > Ouvrir.

## Google Cloud
Projet « SSD Drive Sync » (`atomic-vault-513619-m6`), en mode test : ajouter chaque utilisatrice
dans Google Auth Platform > Audience > Utilisateurs test.
