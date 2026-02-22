/**
 * Envoi de notifications WhatsApp via Twilio.
 * En sandbox : message texte libre possible (sans template validé), uniquement vers les numéros ayant rejoint le sandbox.
 *
 * Configuration :
 * - TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN (Console Twilio)
 * - TWILIO_WHATSAPP_FROM = numéro WhatsApp Twilio (ex. whatsapp:+14155238886 pour le sandbox)
 */

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || ''; // ex. whatsapp:+14155238886

const isConfigured = () =>
  Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_WHATSAPP_FROM);

function normalizePhone(phone, senderCountry) {
  if (!phone || typeof phone !== 'string') return '';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 0) return '';
  if (phone.trim().startsWith('+')) return phone.trim();
  if (senderCountry === 'BFA' || senderCountry === 'Burkina Faso') {
    const local = cleaned.startsWith('226') ? cleaned : `226${cleaned}`;
    return `+${local}`;
  }
  if (senderCountry === 'USA' || senderCountry === 'États-Unis') {
    const local = cleaned.startsWith('1') && cleaned.length >= 11 ? cleaned : `1${cleaned}`;
    return `+${local}`;
  }
  return `+${cleaned}`;
}

/**
 * Envoie un WhatsApp à l'expéditeur via Twilio (même signature que WhatChimp).
 * En sandbox : pas de template requis, message texte libre.
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
  if (!isConfigured()) {
    return { success: false, error: 'Twilio WhatsApp non configuré' };
  }

  const to = normalizePhone(senderPhone, senderCountry);
  if (!to) return { success: false, error: 'Numéro expéditeur invalide' };

  const amountFormatted = typeof amountReceived === 'number'
    ? amountReceived.toLocaleString('fr-FR', { maximumFractionDigits: 0 })
    : String(amountReceived);

  const body = [
    `Bonjour ${senderName || 'Client'},`,
    '',
    `Votre transfert ${reference} a été payé.`,
    `Montant remis au bénéficiaire : ${amountFormatted} ${currencyReceived || 'XOF'}.`,
    beneficiaryName ? `Bénéficiaire : ${beneficiaryName}.` : '',
    '',
    '— Global Exchange'
  ].filter(Boolean).join('\n');

  const from = TWILIO_WHATSAPP_FROM.startsWith('whatsapp:')
    ? TWILIO_WHATSAPP_FROM
    : `whatsapp:${TWILIO_WHATSAPP_FROM}`;
  const toWhatsApp = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;

  try {
    const twilio = require('twilio');
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

    await client.messages.create({
      body,
      from,
      to: toWhatsApp
    });
    return { success: true };
  } catch (err) {
    console.error('[Twilio WhatsApp] Error:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  sendTransferPaidToSender,
  isConfigured
};
