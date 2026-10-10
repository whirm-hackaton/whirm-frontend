# Authentification

`Auth` gère la connexion, la déconnexion et la session via le backend. Il reste indépendant du wallet.

## Démarrage local

Démarrer le backend et sa base de données. Utiliser **localhost** pour les deux services :

- Backend : `http://localhost:3000`.
- Frontend : `http://localhost:5173`, autorisé dans le `CORS_ORIGINS` du backend.

Pour préparer les comptes de test, depuis le **backend** :

```sh
pnpm db:migrate
pnpm db:seed
```

Les identifiants sont dans son README.

Depuis le **frontend** :

```sh
pnpm dev
```

Vite transmet `/auth/*` et `/wallets` au backend en conservant l’en-tête `Origin`.

## API

[Documentation OpenAPI](http://localhost:3000/ui)

| Action | Endpoint | Résultat |
| --- | --- | --- |
| Connexion | `POST /auth/login` avec `{ email, password }` | `200` : utilisateur ; `401` : refus |
| Vérification | `GET /auth/me` | `200` : utilisateur ; `401` : session absente ou expirée |
| Déconnexion | `POST /auth/logout` | `204` : session révoquée, cookie effacé |

L’utilisateur est renvoyé sous la forme `{ user: { id, email, displayName } }`.

## Session

- Cookie `session` : **HttpOnly**, **SameSite=Lax**, valable **24 heures** sans renouvellement. Requêtes avec `credentials: 'include'`.
- Restauration au montage ; vérification au retour sur la page et chaque minute lorsqu’elle est visible avec une session active.
- Expiration : utilisateur retiré de l’état local, reconnexion proposée. Erreur réseau ou serveur : message affiché ; une déconnexion échouée peut être réessayée.
- Mot de passe vidé dès l’envoi. Aucun identifiant ou jeton écrit dans le stockage du navigateur par le frontend.

La session n’autorise aucune dépense blockchain.

## Intégration

```svelte
<script lang="ts">
  import { Auth, type AuthSession } from '$lib/auth'

  let session = $state<AuthSession | null>(null)
</script>

<Auth onSessionChange={(next) => { session = next }} />
```

Le callback transmet l’utilisateur public ou `null`. Démonter le composant arrête ses requêtes et transmet `null`, sans révoquer la session serveur.

Le client `createAuth()` expose `subscribe`, `restore()`, `connect(email, password)`, `disconnect()`, `expire()` et `destroy()`.

Le snippet optionnel `children(session, expireSession)` affiche le parcours connecté à la place de l’introduction. `App.svelte` y assemble le [wallet connecté à l’API](wallet.md), avec une instance distincte par utilisateur. `Auth` reste monté pour gérer déconnexion et expiration. Un `401` du wallet appelle `expireSession()` et retire immédiatement l’utilisateur et les métadonnées locales.

## Vérification

```sh
pnpm exec tsc --ignoreConfig \
  src/lib/auth/auth.ts src/lib/auth/auth.test.ts \
  --outDir node_modules/.tmp/auth-tests \
  --module nodenext --target es2023 --skipLibCheck

node --test "$PWD/node_modules/.tmp/auth-tests/auth.test.js"

pnpm check
pnpm build
```

Seuls les tests remplacent `fetch` ; l’application utilise le backend.

Au navigateur, vérifier :

- Refus, connexion, restauration après rechargement, puis déconnexion.
- Révocation depuis un autre onglet, détectée au retour ou à la vérification périodique.
- Clavier, affichage mobile et erreurs réseau.

## Production

Servir en **HTTPS**, router `/auth/*` et `/wallets` vers le backend sur la même origine que le frontend, et autoriser cette origine dans `CORS_ORIGINS`.

## Historique

Temporary stubs `simulation.ts` and `simulation.test.ts` from [HS-27](https://projects.dotshark.dev/hackatons/task/HS-27/construire-la-connexion-swissquote-et-ses-erreurs-ct-fronten), pending backend authentication, were replaced by the HTTP client and its tests.

Le [guide d’intégration](integration.md) documente le lancement commun, CORS/cookies, les tests et la correspondance avec les tickets Kaneo.
