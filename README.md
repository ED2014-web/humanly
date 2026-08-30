# Humanly

MVP d’une communauté de questions et réponses exclusivement humaines.

## Lancer localement

```bash
npm install
npm run dev
```

Puis ouvrir http://localhost:3000.

La version utilise Supabase lorsqu’il est configuré : authentification email/mot de passe, questions partagées et mises à jour en temps réel. Sans variables Supabase, l’interface affiche un avertissement et aucune fausse connexion n’est autorisée.

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
5. Créer un bucket Storage privé pour les images.
6. Ajouter les variables `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY` dans Vercel.
7. Importer le dépôt GitHub dans Vercel.

Le verrouillage d’une question devra être validé côté serveur avec une expiration atomique (`claimed_until`), et non uniquement dans le navigateur. Cela évite que deux utilisateurs réservent la même question.
