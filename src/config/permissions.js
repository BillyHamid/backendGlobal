// Les droits d'administration des comptes et des rôles restent réservés aux admins.
const PERMISSIONS = [
  { id: 'transfers.view', group: 'Transferts', label: 'Consulter les transferts' },
  { id: 'transfers.create', group: 'Transferts', label: 'Créer des transferts' },
  { id: 'transfers.edit', group: 'Transferts', label: 'Modifier les transferts en attente' },
  { id: 'transfers.pay', group: 'Transferts', label: 'Confirmer les paiements' },
  { id: 'transfers.cancel', group: 'Transferts', label: 'Annuler les transferts' },
  { id: 'transfers.delete', group: 'Transferts', label: 'Supprimer les transferts' },
  { id: 'beneficiaries.view', group: 'Contacts', label: 'Consulter les bénéficiaires' },
  { id: 'beneficiaries.create', group: 'Contacts', label: 'Créer des bénéficiaires' },
  { id: 'beneficiaries.edit', group: 'Contacts', label: 'Modifier et supprimer des bénéficiaires' },
  { id: 'senders.view', group: 'Contacts', label: 'Consulter les expéditeurs' },
  { id: 'senders.create', group: 'Contacts', label: 'Créer des expéditeurs' },
  { id: 'senders.edit', group: 'Contacts', label: 'Modifier et supprimer des expéditeurs' },
  { id: 'cash.view', group: 'Caisse', label: 'Consulter les caisses et justificatifs' },
  { id: 'cash.entry', group: 'Caisse', label: 'Enregistrer des entrées de caisse' },
  { id: 'cash.expense', group: 'Caisse', label: 'Enregistrer des dépenses de caisse' },
  { id: 'users.view', group: 'Utilisateurs', label: 'Consulter les utilisateurs et agents' },
];

const agentPermissions = [
  'transfers.view', 'transfers.create', 'transfers.pay',
  'beneficiaries.view', 'beneficiaries.create', 'senders.view', 'senders.create',
  'cash.view', 'cash.entry', 'cash.expense',
];
const DEFAULT_PERMISSIONS = {
  admin: PERMISSIONS.map(permission => permission.id),
  supervisor: ['transfers.view', 'transfers.cancel', 'beneficiaries.view', 'senders.view', 'users.view', 'cash.view', 'cash.entry', 'cash.expense'],
  sender_agent: [...agentPermissions],
  payer_agent: [...agentPermissions],
};

// Une action doit rester utilisable depuis l'écran correspondant.
const DEPENDENCIES = {
  'transfers.create': ['transfers.view', 'beneficiaries.view', 'beneficiaries.create', 'senders.view', 'senders.create'],
  'transfers.edit': ['transfers.view'],
  'transfers.pay': ['transfers.view'],
  'transfers.cancel': ['transfers.view'],
  'transfers.delete': ['transfers.view'],
  'beneficiaries.create': ['beneficiaries.view'],
  'beneficiaries.edit': ['beneficiaries.view'],
  'senders.create': ['senders.view'],
  'senders.edit': ['senders.view'],
  'cash.entry': ['cash.view'],
  'cash.expense': ['cash.view'],
};

module.exports = { PERMISSIONS, DEFAULT_PERMISSIONS, DEPENDENCIES };
