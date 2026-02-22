/**
 * Dispatcher WhatsApp : utilise Twilio ou WhatChimp selon la config.
 * - WHATSAPP_PROVIDER=twilio  → Twilio (sandbox = pas de template requis)
 * - WHATSAPP_PROVIDER=whatchimp ou non défini → WhatChimp (template validé requis)
 * Si les deux sont configurés, WHATSAPP_PROVIDER prime.
 */

const twilioService = require('./whatsappTwilio.service');
const whatchimpService = require('./whatsappWhatchimp.service');

const PROVIDER = (process.env.WHATSAPP_PROVIDER || '').toLowerCase();

function getProvider() {
  if (PROVIDER === 'twilio' && twilioService.isConfigured()) return twilioService;
  if (PROVIDER === 'whatchimp' && whatchimpService.isConfigured()) return whatchimpService;
  if (twilioService.isConfigured()) return twilioService;
  if (whatchimpService.isConfigured()) return whatchimpService;
  return null;
}

async function sendTransferPaidToSender(params) {
  const provider = getProvider();
  if (!provider) return { success: false, error: 'Aucun fournisseur WhatsApp configuré' };
  return provider.sendTransferPaidToSender(params);
}

module.exports = {
  sendTransferPaidToSender,
  isConfigured: () => Boolean(getProvider())
};
