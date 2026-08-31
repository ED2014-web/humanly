# HumainGPT

Communauté de questions et réponses exclusivement humaines, avec historique, images et dessins.

## Lancer localement

```bash
npm install
npm run dev
```

Puis ouvrir http://localhost:3000.

## Tests

```bash
npm test
```

Le test vérifie qu’une conversation active reste récupérable après une actualisation et qu’elle peut être rouverte depuis l’historique.

La version utilise Supabase lorsqu’il est configuré : authentification email/mot de passe, historique des conversations, questions partagées, pièces jointes, dessins et mises à jour en temps réel. Sans variables Supabase, l’interface affiche un avertissement et aucune fausse connexion n’est autorisée. Les pièces jointes passent par une route serveur qui contrôle le nom, l’extension, le MIME déclaré, la signature binaire, la taille et ClamAV avant stockage.

## Configuration Supabase

1. Copie `.env.local.example` vers `.env.local`.
2. Renseigne l’URL du projet et la clé `anon` publique.
3. Dans Supabase > SQL Editor, exécute `supabase/schema.sql`.
4. Dans Authentication > Providers, active Email.

## Prochaine étape de production

Pour rendre l’application réellement multi-utilisateurs et accessible à tous :

1. Créer un projet gratuit Supabase.
2. Ajouter les tables `profiles`, `questions`, `answers` et `reports`.
3. Activer Supabase Auth avec email/mot de passe.
4. Activer Realtime sur les questions et réponses.
5. Créer un bucket Storage privé pour les pièces jointes.
6. Ajouter les variables `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY` dans Vercel.
7. Importer le dépôt GitHub dans Vercel.
8. Déployer un service ClamAV interne avec `POST /scan` en multipart, renvoyant `{ "clean": true }` ou `{ "infected": true }`.
9. Configurer `SUPABASE_SERVICE_ROLE_KEY` et `CLAMAV_URL` uniquement côté serveur ; ne jamais exposer la clé service au navigateur.

Sans `CLAMAV_URL`, les uploads sont refusés (fail-closed). Les extensions exécutables, scripts à risque et SVG sont bloqués, et les formats autorisés sont contrôlés par signature binaire lorsque cela est possible.

Le verrouillage d’une question est validé côté serveur avec une expiration atomique (`claimed_until`), et non uniquement dans le navigateur. Les pièces jointes et dessins sont envoyés dans le bucket `question-images`, enregistrés comme uploads `clean`, puis référencés par les tables `questions`, `answers` et `messages`. Pour une base existante, réexécute le script SQL : ses politiques sont idempotentes pour les éléments mis à jour.
