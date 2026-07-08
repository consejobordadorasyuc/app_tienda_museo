import { createPinRecord, randomToken } from './crypto.js';
import { normalizedUsername, validateInitials, validatePin } from './validation.js';

const INITIAL_SELLERS = [
  ['Aydé Acosta Fuentes', 'ACF'],
  ['Elizabeth Bolaños Jiménez', 'ABJ'],
  ['Rosa I. Jiménez Serralta', 'RJS'],
  ['Mayra P. Chi Pérez', 'MCP'],
  ['Karen Elizabeth Itza Pat', 'KIP'],
  ['Martha Elena May May', 'MMM'],
  ['Cándida del Socorro Jiménez Bójorguez', 'CJB'],
  ['María Dalila Casanova Farráez', 'MCF'],
  ['Maricela Beatriz Ix Poot', 'MIP'],
  ['Yolanda Isabel Solís Yeh', 'YSY'],
  ['Beatriz del Socorro Yervez Vera', 'BYV'],
  ['Norma Yolanda Naal Caamal', 'NNC'],
  ['Lidia Ucán Cocóm', 'LUC'],
  ['Silvia María Chan Moo', 'SCM'],
  ['Imelda de la Cruz Cocom Góngora', 'ICG'],
  ['Patricia Pat Pool', 'PPP'],
  ['Leticia Ché Koh', 'LCK'],
  ['Zelmy O. Dominguez Chan', 'ZDC'],
  ['Antonia Aracely Poot Poot', 'APP'],
  ['Lidia María del Rosario Tuz Tuz', 'LTT'],
];

const LOCATIONS = [
  ['Abalá', 'Abalá'],
  ['Abalá', 'Temozón'],
  ['Abalá', 'Mucuyché'],
  ['Dzán', 'Dzán'],
  ['Hoctún', 'San José Oriente'],
  ['Izamal', 'Citilcum'],
  ['Izamal', 'Kimbilá'],
  ['Maní', 'Tipikal'],
  ['Maní', 'Maní'],
  ['Mérida', 'Yaxnic'],
  ['Mérida', 'Mérida'],
  ['Mérida', 'San Pedro Chimay'],
  ['Muna', 'Muna'],
  ['Oxkutzcab', 'Oxkutzcab'],
  ['Oxkutzcab', 'Yaxhachén'],
  ['Tahdziú', 'Tahdziú'],
  ['Teabo', 'Teabo'],
  ['Tekax', 'Tekax de Álvaro Obregón'],
  ['Tekit', 'Tekit'],
  ['Valladolid', 'Tixhualactún'],
  ['Valladolid', 'Xocén'],
  ['Valladolid', 'Dzitnup'],
  ['Valladolid', 'Kanxoc'],
  ['Valladolid', 'Valladolid'],
  ['Valladolid', 'Tikuch'],
  ['Valladolid', 'San Antonio'],
];

const CATEGORY_SEEDS = [
  ['CAT-ADU', 'Prendas de adulto', 'ADU', 30],
  ['CAT-NIN', 'Prendas de niña o niño', 'NIN', 20],
  ['CAT-ACC', 'Accesorios', 'ACC', 10],
];

const SUBCATEGORY_SEEDS = [
  ['CAT-ADU', 'Blusa', 'BLU'],
  ['CAT-ADU', 'Hipil', 'HIP'],
  ['CAT-ADU', 'Vestido', 'VES'],
  ['CAT-ADU', 'Falda', 'FAL'],
  ['CAT-ADU', 'Camisa', 'CAM'],
  ['CAT-ADU', 'Faja', 'FAJ'],
  ['CAT-ADU', 'Otro', 'OTR'],
  ['CAT-NIN', 'Blusa', 'BLU'],
  ['CAT-NIN', 'Hipil', 'HIP'],
  ['CAT-NIN', 'Vestido', 'VES'],
  ['CAT-NIN', 'Falda', 'FAL'],
  ['CAT-NIN', 'Camisa', 'CAM'],
  ['CAT-NIN', 'Faja', 'FAJ'],
  ['CAT-NIN', 'Otro', 'OTR'],
  ['CAT-ACC', 'Bolsa', 'BOL'],
  ['CAT-ACC', 'Servilleta', 'SER'],
  ['CAT-ACC', 'Cinturón', 'CIN'],
  ['CAT-ACC', 'Aretes', 'ARE'],
  ['CAT-ACC', 'Collar', 'COL'],
  ['CAT-ACC', 'Otro', 'OTR'],
];

function nowIso() {
  return new Date().toISOString();
}

async function seedUser({ name, initials, username, pin, role, env, now }) {
  const safeUsername = normalizedUsername(username);
  const safeInitials = validateInitials(initials);
  const { salt, hash } = await createPinRecord(validatePin(pin), env.AUTH_PEPPER);
  return {
    id: `USR-${safeUsername}-${randomToken(4).toUpperCase()}`,
    name,
    initials: safeInitials,
    username: safeUsername,
    pin_salt: salt,
    pin_hash: hash,
    role,
    municipio: '',
    localidad: '',
    telefono: '',
    colectivo: '',
    correo: '',
    observaciones: '',
    active: 'true',
    auth_version: '1',
    created_at: now,
    updated_at: now,
  };
}

export async function createSeedTables(env, admin = {}) {
  const now = nowIso();
  const adminUsername = normalizedUsername(admin.username || 'ADM');
  const adminPin = validatePin(admin.pin || '9876');
  const adminName = String(admin.name || 'Administradora').trim() || 'Administradora';

  const users = [
    await seedUser({
      name: adminName,
      initials: 'ADM',
      username: adminUsername,
      pin: adminPin,
      role: 'admin',
      env,
      now,
    }),
  ];

  for (const [name, username] of INITIAL_SELLERS) {
    users.push(await seedUser({
      name,
      initials: username,
      username,
      pin: '1234',
      role: 'seller',
      env,
      now,
    }));
  }

  const categories = CATEGORY_SEEDS.map(([id, name, code, commission], index) => ({
    id,
    name,
    code,
    commission_percent: String(commission),
    active: 'true',
    sort_order: String(index + 1),
    created_at: now,
    updated_at: now,
  }));

  const subcategories = SUBCATEGORY_SEEDS.map(([categoryId, name, code], index) => ({
    id: `SUB-${categoryId.slice(4)}-${code}`,
    category_id: categoryId,
    name,
    code,
    active: 'true',
    sort_order: String(index + 1),
    created_at: now,
    updated_at: now,
  }));

  const sizes = ['Chica', 'Mediana', 'Grande', 'Extra grande'].map((name, index) => ({
    id: `SIZE-${index + 1}`,
    name,
    active: 'true',
    sort_order: String(index + 1),
    created_at: now,
    updated_at: now,
  }));

  const paymentMethods = [
    ['PAY-EFE', 'Efectivo', 'EFE', 'false'],
    ['PAY-TRA', 'Transferencia', 'TRA', 'false'],
    ['PAY-TCR', 'Tarjeta de crédito', 'TCR', 'true'],
    ['PAY-TDE', 'Tarjeta de débito', 'TDE', 'false'],
  ].map(([id, name, code, cardFee], index) => ({
    id,
    name,
    code,
    card_fee_applies: cardFee,
    active: 'true',
    sort_order: String(index + 1),
    created_at: now,
    updated_at: now,
  }));

  const locations = LOCATIONS.map(([municipio, localidad], index) => ({
    id: `LOC-${String(index + 1).padStart(3, '0')}`,
    municipio,
    localidad,
    active: 'true',
    sort_order: String(index + 1),
    created_at: now,
    updated_at: now,
  }));

  const settings = [
    ['store_name', 'Tienda del Consejo Estatal de Bordadoras de Yucatán'],
    ['card_fee_percent', '3.5'],
    ['card_fee_tax_percent', '16'],
    ['currency', 'MXN'],
    ['timezone', 'America/Merida'],
  ].map(([key, value]) => ({ key, value, updated_at: now }));

  return {
    users,
    categories,
    subcategories,
    sizes,
    payment_methods: paymentMethods,
    locations,
    settings,
    products: [],
    sales: [],
    audit: [{
      id: `AUD-${randomToken(8)}`,
      timestamp: now,
      user_id: users[0].id,
      username: users[0].username,
      action: 'INITIALIZE',
      entity_type: 'system',
      entity_id: 'application',
      details: JSON.stringify({ seller_count: INITIAL_SELLERS.length }),
    }],
  };
}
