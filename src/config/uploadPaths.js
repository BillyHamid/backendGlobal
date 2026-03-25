/**
 * Racine des fichiers uploadés. Sur PaaS, monter un volume persistant et définir
 * SECURE_UPLOADS_ROOT=/chemin/absolu (ex. /var/lib/globalexchange/uploads).
 */
const path = require('path');
const fs = require('fs');

const root = process.env.SECURE_UPLOADS_ROOT
  ? path.resolve(process.env.SECURE_UPLOADS_ROOT)
  : path.join(__dirname, '../../secure_uploads');

const subdirs = ['transactions', 'cash_entries', 'financial_reports', 'special_expenses'];

if (!fs.existsSync(root)) {
  fs.mkdirSync(root, { recursive: true });
}
for (const sub of subdirs) {
  const p = path.join(root, sub);
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
}

module.exports = {
  root,
  transactions: path.join(root, 'transactions'),
  cash_entries: path.join(root, 'cash_entries'),
  financial_reports: path.join(root, 'financial_reports'),
  special_expenses: path.join(root, 'special_expenses'),
};
