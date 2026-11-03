# Global Exchange - Backend API

Backend Node.js/Express pour la plateforme de transfert d'argent Global Exchange.

## Gestion des rôles et permissions

L'administrateur peut attribuer un rôle dans **Utilisateurs & Agents → Modifier** et configurer les droits opérationnels dans **Rôles & Permissions**. Les effectifs affichés viennent de la base. Les permissions des trois rôles non administrateurs sont enregistrées dans `role_permissions` ; sans configuration, les droits initiaux s'appliquent.

Pour mettre à jour une base existante sans réinitialiser les comptes : `npm run db:migrate:roles`, puis `npm run db:migrate:special-access`, puis redémarrer l'API et déployer le frontend reconstruit. Les migrations 011 et 012 sont aussi incluses dans `db:migrate:extra`.

Chaque requête authentifiée relit le rôle, le statut actif et les permissions actuels. Une session déjà ouverte n'accorde donc plus les anciens droits. L'interface se resynchronise au retour sur l'onglet et toutes les minutes.

Le rôle administrateur conserve tous ses droits ; seul un administrateur peut créer/modifier les comptes et configurer les rôles. Il ne peut pas supprimer/désactiver son propre compte ni retirer son propre rôle. L'ancien accès lié à l'email de Razack devient le droit individuel **Accès spécial** : modification/annulation des transferts, dépenses spéciales et prêts. Il se règle dans la fiche utilisateur (`users.has_special_access`) et reste valable après un changement de nom ou d'email. Les rapports financiers de Bernadette et les règles métier de pays, de statut et de justificatifs restent applicables.

La migration 012 reprend une seule fois l'accès de l'ancien compte Razack s'il existe. Elle n'attribue pas automatiquement ses droits à un remplaçant. La relancer ne restaure pas un accès ensuite retiré. Les nouveaux prêts utilisent le compte connecté comme prêteur et le bénéficiaire actif sélectionné ; les anciens prêts et les soldes des comptes restent rattachés à leurs utilisateurs d'origine.

### Donner l'accès à Idrissa en production

1. Livrer le backend modifié sur le serveur qui dessert `https://server.globalexchangeusa.cloud/api`. Dans cet environnement, appliquer les migrations 011 puis 012 avec les deux commandes ci-dessus, avant de redémarrer l'API. Ne pas lancer `db:seed` ou `db:reset` sur une base de production existante.
2. Reconstruire le frontend avec `VITE_API_URL=https://server.globalexchangeusa.cloud/api`, puis publier le contenu de `globalEX/dist` sur `https://globalexchangeusa.cloud`.
3. Avec un administrateur, ouvrir **Utilisateurs & Agents → Modifier** pour `idrissa.yabre@globalexchange.com`, puis cocher **Accès spécial : dépenses, prêts et gestion des transferts** et enregistrer. Si le compte est déjà administrateur, ces droits sont inclus et la case est cochée automatiquement. Pour reproduire le profil d'agent de Razack, choisir **Agent expéditeur** et cocher l'accès spécial ; le rôle administrateur donne davantage de droits.
4. Si l'ancien compte Razack existe encore, le désactiver depuis la liste pour fermer ses anciennes sessions. Conserver le compte si son historique lui est rattaché.
5. Idrissa se reconnecte. Vérifier **Dépenses Spéciales** et l'onglet **Prêt**, sans créer de transaction réelle pour ce contrôle.

Le frontend et le backend doivent être livrés ensemble. Un badge « Administrateur » affiché dans une ancienne session n'est pas une preuve du rôle actuel en base : l'API mise à jour relit le compte à chaque requête.

Validation : `npm test` dans `backend` et dans `globalEX`, puis `npm run build` dans `globalEX`. Les tests API ordinaires utilisent une base en mémoire, sans charger `.env`. Le test d'intégration `test/postgres-special-access.test.js` s'exécute avec `TEST_POSTGRES_URL` pointant exclusivement vers une base locale vide nommée `codex_test_…` ; il vérifie les migrations, les permissions, les prêts et la conservation des historiques sur PostgreSQL. Il est ignoré si cette variable n'est pas fournie.

## Prérequis

- **Node.js** v18+ 
- **PostgreSQL** v14+

## Installation

### 1. Installer PostgreSQL

Télécharger et installer PostgreSQL : https://www.postgresql.org/download/

### 2. Créer la base de données

```bash
# Se connecter à PostgreSQL
psql -U postgres

# Créer la base de données
CREATE DATABASE global_exchange;

# Quitter
\q
```

### 3. Installer les dépendances

```bash
cd backend
npm install
```

### 4. Configurer l'environnement

Modifier le fichier `.env` avec vos paramètres :

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=global_exchange
DB_USER=postgres
DB_PASSWORD=votre_mot_de_passe
```

### 5. Initialiser la base de données

À faire **dans l’ordre** (depuis le dossier `backend`, avec `.env` configuré avec `DATABASE_URL` ou `DB_*`) :

```bash
# 1. Créer les tables (schema principal)
npm run db:migrate

# 2. Appliquer les migrations additionnelles (preuves, caisse, etc.)
npm run db:migrate:extra

# 3. Créer au moins un utilisateur + taux de change (seed)
npm run db:seed
```

Sans ces étapes, il n’y a aucun utilisateur en base : le login échouera.

### 6. Démarrer le serveur

```bash
# Mode développement (avec hot reload)
npm run dev

# Mode production
npm start
```

Le serveur démarre sur `http://localhost:5000`

## API Endpoints

### Authentification

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| POST | `/api/auth/login` | Connexion |
| POST | `/api/auth/register` | Inscription |
| GET | `/api/auth/me` | Utilisateur actuel |
| POST | `/api/auth/logout` | Déconnexion |
| POST | `/api/auth/change-password` | Changer mot de passe |

### Utilisateurs

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/users` | Liste des utilisateurs |
| GET | `/api/users/:id` | Détails utilisateur |
| POST | `/api/users` | Créer utilisateur |
| PUT | `/api/users/:id` | Modifier utilisateur |
| DELETE | `/api/users/:id` | Supprimer utilisateur |

### Transferts

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/transfers` | Liste des transferts |
| GET | `/api/transfers/pending` | Transferts en attente |
| GET | `/api/transfers/:id` | Détails transfert |
| POST | `/api/transfers` | Créer transfert |
| PATCH | `/api/transfers/:id/pay` | Marquer comme payé |
| PATCH | `/api/transfers/:id/cancel` | Annuler transfert |

### Bénéficiaires & Expéditeurs

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/beneficiaries` | Liste bénéficiaires |
| POST | `/api/beneficiaries` | Créer bénéficiaire |
| GET | `/api/senders` | Liste expéditeurs |
| POST | `/api/senders` | Créer expéditeur |

### Statistiques

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/stats/dashboard` | Stats dashboard |
| GET | `/api/stats/transfers` | Stats transferts |
| GET | `/api/stats/agents` | Performance agents |

## Comptes de démo (après `npm run db:seed`)

Mot de passe pour tous : **password123**

| Email | Rôle |
|-------|------|
| admin@globalexchange.com | Admin |
| superviseur@globalexchange.com | Superviseur |
| razack@globalexchange.com | Agent expéditeur USA |
| bernadette@globalexchange.com | Agent payeur BF |
| abibata@globalexchange.com | Agent payeur BF |
| mohamadi@globalexchange.com | Agent payeur BF |

## Structure du projet

```
backend/
├── src/
│   ├── config/
│   │   ├── database.js    # Configuration PostgreSQL
│   │   └── constants.js   # Constantes (rôles, statuts)
│   ├── controllers/       # Logique métier
│   ├── database/
│   │   ├── schema.sql     # Schéma SQL
│   │   ├── migrate.js     # Script migration
│   │   └── seed.js        # Données initiales
│   ├── middleware/
│   │   ├── auth.middleware.js     # JWT & permissions
│   │   ├── error.middleware.js    # Gestion erreurs
│   │   └── validate.middleware.js # Validation
│   ├── routes/            # Routes API
│   └── server.js          # Point d'entrée
├── .env                   # Variables d'environnement
└── package.json
```

## Scripts disponibles

```bash
npm run dev            # Démarrer en mode dev
npm start              # Démarrer en production
npm run db:migrate     # Créer les tables (schema.sql)
npm run db:migrate:extra # Migrations 002–008 (preuves, caisse, rapports…)
npm run db:seed        # Insérer utilisateurs + taux de change
npm run db:reset       # Réinitialiser la BDD
npm run db:reset:special-test  # Vider dépenses simples + prêts, soldes wallets → 0 (tests)
```

**Rapports financiers** (migrations `008` + `009`) : montants en **XOF** ; Bernadette crée les rapports avec justificatifs ; l’admin (SANA Djibrill) valide via `/api/financial-reports`. Fichiers dans `secure_uploads/financial_reports/`. Si la colonne `currency` manque : `npm run db:migrate:financial-reports-xof`.

### Base sur Render (production)

1. Dans le dashboard Render, récupérer **DATABASE_URL** (PostgreSQL).
2. En local : mettre `DATABASE_URL=...` dans `backend/.env` (ou les variables `DB_*`).
3. Base vide uniquement : depuis `backend`, `npm run db:migrate:all`. Pour une base existante, appliquer les migrations nécessaires comme indiqué ci-dessus, sans réinitialiser les comptes. `db:seed` sert à préparer une démonstration et modifie les comptes et mots de passe existants.
4. Vérifier que le Web Service a bien `DATABASE_URL`, `JWT_SECRET` et éventuellement `FRONTEND_URL`.
5. Se connecter avec le compte administrateur de cet environnement.
