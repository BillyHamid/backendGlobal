/**
 * Envoi de notifications WhatsApp via WhatChimp (Webhook Workflow).
 * Quand un transfert est confirmé (payé), on envoie un message à l'expéditeur (client).
 *
 * Configuration WhatChimp :
 * 1. Créer un modèle de message (template) avec variables ex. : reference, amount_received, currency_received, beneficiary_name
 * 2. Créer un Webhook Workflow, choisir ce template, récupérer l'URL de callback
 * 3. Dans le workflow, mapper les champs reçus (phone, reference, amount_received, etc.) vers les variables du template
 * 4. Mettre WHATCHIMP_WEBHOOK_URL dans .env
 */

const https = require('https');
const http = require('http');

const WHATCHIMP_WEBHOOK_URL = process.env.WHATCHIMP_WEBHOOK_URL || '';
const WHATCHIMP_ENABLED = process.env.WHATCHIMP_ENABLED === 'true' || process.env.WHATCHIMP_ENABLED === '1';

/**
 * Normalise le numéro de téléphone en format E.164 pour WhatsApp.
 * @param {string} phone - Numéro saisi (ex. 70123456, +22670123456)
 * @param {string} senderCountry - Code pays expéditeur (USA, BFA, etc.)
 * @returns {string} Numéro avec indicatif (ex. +22670123456)
 */
function normalizePhoneForWhatsApp(phone, senderCountry) {
  if (!phone || typeof phone !== 'string') return '';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 0) return '';
  // Déjà au format international
  if (phone.trim().startsWith('+')) return phone.trim();
  // Burkina Faso
  if (senderCountry === 'BFA' || senderCountry === 'Burkina Faso') {
    const local = cleaned.startsWith('226') ? cleaned : `226${cleaned}`;
    return local.startsWith('226') ? `+${local}` : `+226${cleaned}`;
  }
  // USA
  if (senderCountry === 'USA' || senderCountry === 'États-Unis') {
    const local = cleaned.startsWith('1') && cleaned.length >= 11 ? cleaned : `1${cleaned}`;
    return `+${local}`;
  }
  return `+${cleaned}`;
}

/**
 * Envoie une notification WhatsApp à l'expéditeur via le webhook WhatChimp.
 * Payload envoyé (à mapper dans le workflow WhatChimp) :
 *   phone, reference, amount_received, currency_received, beneficiary_name, sender_name
 *
 * @param {Object} params
 * @param {string} params.senderPhone - Téléphone de l'expéditeur (client)
 * @param {string} params.senderCountry - Pays de l'expéditeur (USA, BFA)
 * @param {string} params.senderName - Nom complet expéditeur
 * @param {string} params.reference - Référence du transfert
 * @param {number} params.amountReceived - Montant reçu par le bénéficiaire
 * @param {string} params.currencyReceived - Devise (USD, XOF)
 * @param {string} params.beneficiaryName - Nom du bénéficiaire
 * @returns {Promise<{ success: boolean; error?: string }>}
 */
async function sendTransferPaidToSender({
  senderPhone,
  senderCountry,
  senderName,
  reference,
  amountReceived,
  currencyReceived,
  beneficiaryName
}) {
  if (!WHATCHIMP_ENABLED || !WHATCHIMP_WEBHOOK_URL) {
    return { success: false, error: 'WhatChimp non configuré (WHATCHIMP_WEBHOOK_URL / WHATCHIMP_ENABLED)' };
  }

  const phone = normalizePhoneForWhatsApp(senderPhone, senderCountry);
  if (!phone) {
    return { success: false, error: 'Numéro expéditeur manquant ou invalide' };
  }

  const amountFormatted = typeof amountReceived === 'number'
    ? amountReceived.toLocaleString('fr-FR', { maximumFractionDigits: 0 })
    : String(amountReceived);

  const payload = {
    phone,
    reference,
    amount_received: amountFormatted,
    currency_received: currencyReceived || 'XOF',
    beneficiary_name: beneficiaryName || '',
    sender_name: senderName || ''
  };

  try {
    const body = JSON.stringify(payload);
    const url = new URL(WHATCHIMP_WEBHOOK_URL);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const result = await new Promise((resolve, reject) => {
      const opts = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body, 'utf8')
        }
      };
      const req = lib.request(opts, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true });
          } else {
            console.error('[WhatChimp] Webhook error:', res.statusCode, data);
            resolve({ success: false, error: `WhatChimp ${res.statusCode}: ${data}` });
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error('WhatChimp webhook timeout'));
      });
      req.write(body);
      req.end();
    });

    return result;
  } catch (err) {
    console.error('[WhatChimp] Request failed:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  sendTransferPaidToSender,
  normalizePhoneForWhatsApp,
  isConfigured: () => Boolean(WHATCHIMP_ENABLED && WHATCHIMP_WEBHOOK_URL)
};
