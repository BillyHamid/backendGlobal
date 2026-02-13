# Global Exchange - Backend API

Backend Node.js/Express pour la plateforme de transfert d'argent Global Exchange.

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

```bash
# Créer les tables
npm run db:migrate

# Insérer les données de demo
npm run db:seed
```

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

## Comptes de démo

| Email | Rôle | Mot de passe |
|-------|------|--------------|
| admin@globalexchange.com | Admin | password123 |
| razack@globalexchange.com | Agent USA | password123 |
| bernadette@globalexchange.com | Agent BF | password123 |
| abibata@globalexchange.com | Agent BF | password123 |
| mohamadi@globalexchange.com | Agent BF | password123 |

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
npm run dev       # Démarrer en mode dev
npm start         # Démarrer en production
npm run db:migrate # Créer les tables
npm run db:seed   # Insérer données demo
npm run db:reset  # Réinitialiser la BDD
```
