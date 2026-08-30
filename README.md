# Humanly

MVP d’une communauté de questions et réponses exclusivement humaines.

## Lancer localement

```bash
npm install
npm run dev
```

Puis ouvrir http://localhost:3000.

La version actuelle est un prototype frontend : les questions sont conservées en mémoire du navigateur et les images sont prévisualisées localement. Les boutons de connexion utilisent un compte de démonstration.

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
