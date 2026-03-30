/**
 * Comptes démo — source unique pour seed + sync des mots de passe.
 * Mot de passe = PASS_ROOT + passSuffix (attention : « C0 » = C + chiffre zéro, pas la lettre O).
 */
const PASS_ROOT = 'MonC0mpte#';

const DEMO_USER_DEFS = [
  {
    email: 'admin@globalexchange.com',
    passSuffix: 'admin',
    name: 'SANA Djibrill',
    phone: '+1 555 000 0001',
    role: 'admin',
    country: 'USA',
    agent_code: null,
  },
  {
    email: 'superviseur@globalexchange.com',
    passSuffix: 'super',
    name: 'Jean Superviseur',
    phone: '+1 555 000 0002',
    role: 'supervisor',
    country: 'USA',
    agent_code: null,
  },
  {
    email: 'razack@globalexchange.com',
    passSuffix: 'razack',
    name: 'Zongo Razack',
    phone: '+1 555 123 4567',
    role: 'sender_agent',
    country: 'USA',
    agent_code: 'USA-001',
  },
  {
    email: 'bernadette@globalexchange.com',
    passSuffix: 'bernadette',
    name: 'Bernadette Tassembedo',
    phone: '+226 70 00 00 01',
    role: 'payer_agent',
    country: 'Burkina Faso',
    agent_code: 'BF-001',
  },
  {
    email: 'abibata@globalexchange.com',
    passSuffix: 'abibata',
    name: 'Abibata Zougrana',
    phone: '+226 70 00 00 02',
    role: 'payer_agent',
    country: 'Burkina Faso',
    agent_code: 'BF-002',
  },
  {
    email: 'mohamadi@globalexchange.com',
    passSuffix: 'mohamadi',
    name: 'Mohamadi Sana',
    phone: '+226 70 00 00 03',
    role: 'payer_agent',
    country: 'Burkina Faso',
    agent_code: 'BF-003',
  },
  {
    email: 'adjara@globalexchange.com',
    passSuffix: 'adjara',
    name: 'Adjara',
    phone: '+1 555 000 0010',
    role: 'sender_agent',
    country: 'USA',
    agent_code: 'USA-002',
  },
];

function plainPasswordFor(def) {
  return `${PASS_ROOT}${def.passSuffix}`;
}

module.exports = {
  PASS_ROOT,
  DEMO_USER_DEFS,
  plainPasswordFor,
};
