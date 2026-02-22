# Sécurité des Uploads de Preuves de Transaction

## Vue d'ensemble

Ce système implémente un upload sécurisé de fichiers de preuve lors de la confirmation des transactions, conforme aux standards de sécurité des applications financières.

## Fonctionnalités de sécurité

### 1. Validation stricte des fichiers
- **Types MIME vérifiés** : Seuls JPG, JPEG, PNG et PDF sont acceptés
- **Vérification de l'extension** : L'extension doit correspondre au type MIME réel
- **Taille maximale** : 5 MB par fichier
- **Nom unique** : Chaque fichier reçoit un UUID comme nom pour éviter les collisions

### 2. Stockage sécurisé
- **Dossier hors public** : Les fichiers sont stockés dans `/secure_uploads/transactions/`
- **Protection contre l'exécution** : Fichier `.htaccess` empêche l'exécution de scripts
- **Pas d'accès direct** : Les fichiers ne sont accessibles que via l'API avec authentification

### 3. Contrôles d'accès
- **Authentification requise** : Seuls les utilisateurs authentifiés peuvent uploader/télécharger
- **Vérification des permissions** : Permission `transfers.pay` requise pour confirmer
- **Journalisation** : Toutes les actions sont enregistrées dans `audit_logs`

### 4. Traçabilité légale
- **Audit complet** : Chaque confirmation enregistre :
  - ID de la transaction
  - ID de l'utilisateur
  - Chemin du fichier de preuve
  - Commentaire
  - Date/heure
  - Adresse IP
  - User-Agent
- **Téléchargements journalisés** : Chaque consultation d'une preuve est enregistrée

## Application de la migration

Pour appliquer la migration de base de données :

```bash
cd backend
node src/database/apply_migration.js 003_add_transfer_confirmation.sql
```

Ou manuellement via psql :

```bash
psql -U postgres -d global_exchange -f src/database/migrations/003_add_transfer_confirmation.sql
```

## Structure des fichiers

```
backend/
├── secure_uploads/
│   └── transactions/          # Dossier de stockage sécurisé
│       └── .htaccess          # Protection contre l'exécution
├── src/
│   ├── middleware/
│   │   └── upload.middleware.js    # Middleware multer sécurisé
│   ├── services/
│   │   ├── fileSecurity.service.js # Gestion sécurisée des fichiers
│   │   └── audit.service.js        # Journalisation d'audit
│   └── controllers/
│       └── transfer.controller.js   # Endpoints de confirmation
```

## Endpoints API

### POST `/api/transfers/:id/confirm`
Confirme une transaction avec une preuve obligatoire.

**Body (multipart/form-data)**:
- `proof_file` (file, requis) : Fichier de preuve (JPG, PNG, PDF, max 5MB)
- `comment` (string, optionnel) : Commentaire sur la confirmation

**Réponse**:
```json
{
  "success": true,
  "message": "Transfert XXX confirmé avec succès",
  "data": {
    "id": "...",
    "reference": "XXX",
    "status": "confirmed",
    "proofFile": "transactions/uuid-filename.ext",
    "confirmedAt": "2026-02-06T..."
  }
}
```

### GET `/api/transfers/:id/proof`
Télécharge le fichier de preuve (authentification requise).

**Headers**:
- `Authorization: Bearer <token>`

**Réponse**:
- Fichier binaire avec headers appropriés
- Journalisation automatique du téléchargement

## Frontend

Le composant `ConfirmTransferModal` gère l'interface utilisateur :
- Upload avec drag & drop
- Preview pour les images
- Validation côté client
- Gestion des erreurs

## Statut de transaction

Le nouveau statut `confirmed` indique qu'une transaction a été confirmée avec une preuve :
- `pending` → `confirmed` (avec preuve obligatoire)
- Les transactions confirmées ne peuvent plus être modifiées

## Notes importantes

1. **Preuve obligatoire** : Il est impossible de confirmer une transaction sans uploader un fichier
2. **Pas de modification** : Une fois confirmée, la transaction ne peut plus être modifiée
3. **Suppression automatique** : Si une nouvelle preuve est uploadée, l'ancienne est supprimée
4. **Nettoyage** : Les fichiers invalides sont automatiquement supprimés en cas d'erreur
