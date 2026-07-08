import { AppError, assert } from '../_lib/errors.js';
import { errorResponse, getPathParts, normalizeMethod, ok, readJson } from '../_lib/http.js';
import { CsvStore } from '../_lib/store.js';
import { createSeedTables } from '../_lib/seed.js';
import {
  authenticateCredentials,
  publicUser,
  requireAdmin,
  requireUser,
} from '../_lib/auth.js';
import { clearSessionCookie, createSessionToken, sessionCookie } from '../_lib/session.js';
import { createPinRecord, timingSafeEqual } from '../_lib/crypto.js';
import {
  booleanString,
  isActive,
  money,
  normalizedUsername,
  numberInRange,
  optionalString,
  percentage,
  requiredString,
  slug,
  validateCode,
  validateInitials,
  validatePin,
} from '../_lib/validation.js';
import { calculateSale } from '../_lib/calculations.js';
import {
  activeRows,
  addAudit,
  findActive,
  nextSortOrder,
  nowIso,
  numericSale,
  productSequence,
  saleSequence,
  settingMap,
} from '../_lib/domain.js';

const CATALOG_TABLES = ['categories', 'subcategories', 'sizes', 'payment_methods', 'locations', 'settings'];
const ALL_CATALOG_TYPES = new Set(['categories', 'subcategories', 'sizes', 'payment_methods', 'locations']);

function sorted(rows) {
  return [...rows].sort((a, b) => {
    const order = Number(a.sort_order || 0) - Number(b.sort_order || 0);
    return order || String(a.name || a.localidad || '').localeCompare(String(b.name || b.localidad || ''), 'es');
  });
}

function clientCatalogs(tables, includeInactive) {
  const filter = (rows) => sorted(includeInactive ? rows : activeRows(rows));
  return {
    categories: filter(tables.categories),
    subcategories: filter(tables.subcategories),
    sizes: filter(tables.sizes),
    payment_methods: filter(tables.payment_methods),
    locations: filter(tables.locations),
    settings: settingMap(tables.settings),
  };
}

function findById(rows, id, label) {
  const row = rows.find((item) => item.id === id);
  if (!row) throw new AppError(404, 'NOT_FOUND', `${label} no encontrado.`);
  return row;
}

function ensureUnique(rows, field, value, currentId, label) {
  const normalized = String(value).trim().toUpperCase();
  const duplicate = rows.find(
    (row) => row.id !== currentId && String(row[field] || '').trim().toUpperCase() === normalized && isActive(row),
  );
  if (duplicate) throw new AppError(409, 'DUPLICATE_VALUE', `Ya existe ${label} con ese valor.`);
}

function safeEmail(value) {
  const email = optionalString(value, { max: 160 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'El correo electrónico no tiene un formato válido.');
  }
  return email;
}

function localDateToken(settings) {
  const timeZone = settings.timezone || 'America/Merida';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date()).replace(/-/g, '');
  } catch {
    return new Date().toISOString().slice(0, 10).replace(/-/g, '');
  }
}

function productPayload(body, tables, user, existing = null) {
  const ownerId = user.role === 'admin'
    ? requiredString(body.owner_user_id || existing?.owner_user_id, 'bordadora responsable')
    : user.id;
  const owner = tables.users.find((row) => row.id === ownerId && isActive(row));
  assert(owner, 400, 'INVALID_OWNER', 'La bordadora responsable no está disponible.');

  const categoryId = requiredString(body.category_id, 'categoría');
  const category = findActive(tables.categories, categoryId);
  assert(category, 400, 'INVALID_CATEGORY', 'La categoría seleccionada no está disponible.');

  const subcategoryId = requiredString(body.subcategory_id, 'subcategoría');
  const subcategory = findActive(tables.subcategories, subcategoryId);
  assert(subcategory, 400, 'INVALID_SUBCATEGORY', 'La subcategoría seleccionada no está disponible.');
  assert(
    subcategory.category_id === category.id,
    400,
    'INVALID_SUBCATEGORY',
    'La subcategoría no corresponde a la categoría seleccionada.',
  );

  const sizeId = requiredString(body.size_id, 'talla');
  const size = findActive(tables.sizes, sizeId);
  assert(size, 400, 'INVALID_SIZE', 'La talla seleccionada no está disponible.');

  return {
    name: requiredString(body.name, 'nombre del producto', { max: 160 }),
    description: optionalString(body.description, { max: 2000 }),
    owner,
    category,
    subcategory,
    size,
    salePrice: money(body.sale_price, 'El precio de venta'),
    notes: optionalString(body.notes, { max: 2000 }),
  };
}

function salePayload(body, tables, product) {
  const paymentMethodId = requiredString(body.payment_method_id, 'método de pago');
  const paymentMethod = findActive(tables.payment_methods, paymentMethodId);
  assert(paymentMethod, 400, 'INVALID_PAYMENT_METHOD', 'El método de pago no está disponible.');

  const category = tables.categories.find((row) => row.id === product.category_id);
  assert(category, 400, 'INVALID_CATEGORY', 'No se encontró la categoría del producto.');

  const settings = settingMap(tables.settings);
  const calculation = calculateSale({
    basePrice: Number(product.sale_price),
    discountPercent: body.discount_percent || 0,
    extraPercent: body.extra_percent || 0,
    storeCommissionPercent: Number(category.commission_percent || 0),
    cardFeeApplies: String(paymentMethod.card_fee_applies).toLowerCase() === 'true',
    cardFeePercent: Number(settings.card_fee_percent || 0),
    cardFeeTaxPercent: Number(settings.card_fee_tax_percent || 0),
  });

  return {
    paymentMethod,
    category,
    settings,
    calculation,
    notes: optionalString(body.notes, { max: 2000 }),
  };
}

async function handleBootstrap(store) {
  const initialized = await store.initialized();
  return ok({ initialized });
}

async function handleSetup(store, request, env) {
  const body = await readJson(request);
  if (!env.SETUP_KEY) {
    throw new AppError(500, 'MISSING_SETUP_KEY', 'Falta configurar SETUP_KEY en Cloudflare.');
  }
  if (!timingSafeEqual(String(body.setup_key || ''), String(env.SETUP_KEY))) {
    throw new AppError(403, 'INVALID_SETUP_KEY', 'La clave de configuración no es correcta.');
  }

  const tables = await createSeedTables(env, {
    username: body.admin_username || 'ADM',
    pin: body.admin_pin || '9876',
    name: body.admin_name || 'Administradora',
  });
  await store.writeInitialTables(tables, 'Initialize Consejo de Bordadoras sales application');
  return ok({ message: 'La aplicación quedó inicializada.' }, 201);
}

async function handleLogin(store, request, env) {
  const body = await readJson(request);
  const pin = validatePin(body.pin);
  const user = await authenticateCredentials(store, request, env, body.username, pin);
  const token = await createSessionToken(user, env);
  return ok(
    { user: publicUser(user) },
    200,
    { 'Set-Cookie': sessionCookie(token, request, env) },
  );
}

async function handleSession(store, request, env) {
  const user = await requireUser(store, request, env);
  return ok({ user: publicUser(user) });
}

async function handleCatalogs(store, user) {
  const { tables } = await store.readTables(CATALOG_TABLES);
  return ok({ catalogs: clientCatalogs(tables, user.role === 'admin') });
}

async function handleUsers(store, request, method, parts, user, env) {
  requireAdmin(user);

  if (method === 'GET' && parts.length === 1) {
    const { tables } = await store.readTables(['users']);
    return ok({ users: tables.users.map(publicUser).sort((a, b) => a.name.localeCompare(b.name, 'es')) });
  }

  if (method === 'POST' && parts.length === 1) {
    const body = await readJson(request);
    const now = nowIso();
    const result = await store.mutateTables(['users', 'audit'], async (tables) => {
      const username = normalizedUsername(body.username || body.initials);
      const initials = validateInitials(body.initials);
      ensureUnique(tables.users, 'username', username, null, 'una usuaria');
      ensureUnique(tables.users, 'initials', initials, null, 'una bordadora');
      const pinRecord = await createPinRecord(validatePin(body.pin || '1234'), env.AUTH_PEPPER);
      const created = {
        id: `USR-${username}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        name: requiredString(body.name, 'nombre', { max: 160 }),
        initials,
        username,
        pin_salt: pinRecord.salt,
        pin_hash: pinRecord.hash,
        role: 'seller',
        municipio: optionalString(body.municipio, { max: 120 }),
        localidad: optionalString(body.localidad, { max: 160 }),
        telefono: optionalString(body.telefono, { max: 40 }),
        colectivo: optionalString(body.colectivo, { max: 160 }),
        correo: safeEmail(body.correo),
        observaciones: optionalString(body.observaciones, { max: 2000 }),
        active: 'true',
        auth_version: '1',
        created_at: now,
        updated_at: now,
      };
      tables.users.push(created);
      addAudit(tables.audit, user, 'CREATE', 'user', created.id, { username: created.username });
      return { entity: publicUser(created) };
    }, `Add seller ${body.username || body.initials}`);
    return ok({ user: result.entity }, 201);
  }

  const id = parts[1];
  assert(id, 404, 'NOT_FOUND', 'Usuaria no encontrada.');

  if (method === 'PUT' && parts.length === 2) {
    const body = await readJson(request);
    const result = await store.mutateTables(['users', 'audit'], async (tables) => {
      const target = findById(tables.users, id, 'La usuaria');
      assert(target.role !== 'admin', 400, 'USE_ACCOUNT_ENDPOINT', 'La cuenta administradora se modifica en Mi cuenta.');
      const username = normalizedUsername(body.username ?? target.username);
      const initials = validateInitials(body.initials ?? target.initials);
      ensureUnique(tables.users, 'username', username, target.id, 'una usuaria');
      ensureUnique(tables.users, 'initials', initials, target.id, 'una bordadora');
      const wasActive = isActive(target);
      const newActive = booleanString(body.active, wasActive);
      Object.assign(target, {
        name: requiredString(body.name ?? target.name, 'nombre', { max: 160 }),
        initials,
        username,
        municipio: optionalString(body.municipio ?? target.municipio, { max: 120 }),
        localidad: optionalString(body.localidad ?? target.localidad, { max: 160 }),
        telefono: optionalString(body.telefono ?? target.telefono, { max: 40 }),
        colectivo: optionalString(body.colectivo ?? target.colectivo, { max: 160 }),
        correo: safeEmail(body.correo ?? target.correo),
        observaciones: optionalString(body.observaciones ?? target.observaciones, { max: 2000 }),
        active: newActive,
        updated_at: nowIso(),
      });
      if (wasActive && newActive === 'false') {
        target.auth_version = String(Number(target.auth_version || 1) + 1);
      }
      addAudit(tables.audit, user, 'UPDATE', 'user', target.id, { username: target.username });
      return { entity: publicUser(target) };
    }, `Update seller ${id}`);
    return ok({ user: result.entity });
  }

  if (method === 'DELETE' && parts.length === 2) {
    const result = await store.mutateTables(['users', 'audit'], async (tables) => {
      const target = findById(tables.users, id, 'La usuaria');
      assert(target.role !== 'admin', 400, 'CANNOT_DISABLE_ADMIN', 'No se puede desactivar la cuenta administradora.');
      target.active = 'false';
      target.auth_version = String(Number(target.auth_version || 1) + 1);
      target.updated_at = nowIso();
      addAudit(tables.audit, user, 'DEACTIVATE', 'user', target.id, { username: target.username });
      return { entity: publicUser(target) };
    }, `Deactivate seller ${id}`);
    return ok({ user: result.entity });
  }

  if (method === 'POST' && parts[2] === 'reset-pin' && parts.length === 3) {
    const body = await readJson(request);
    const result = await store.mutateTables(['users', 'audit'], async (tables) => {
      const target = findById(tables.users, id, 'La usuaria');
      const pinRecord = await createPinRecord(validatePin(body.pin), env.AUTH_PEPPER);
      target.pin_salt = pinRecord.salt;
      target.pin_hash = pinRecord.hash;
      target.auth_version = String(Number(target.auth_version || 1) + 1);
      target.updated_at = nowIso();
      addAudit(tables.audit, user, 'RESET_PIN', 'user', target.id, { username: target.username });
      return { entity: publicUser(target) };
    }, `Reset PIN for ${id}`);
    return ok({ user: result.entity });
  }

  throw new AppError(404, 'NOT_FOUND', 'Ruta de usuarias no encontrada.');
}

async function handleAdminAccount(store, request, user, env) {
  requireAdmin(user);
  const body = await readJson(request);
  const result = await store.mutateTables(['users', 'audit'], async (tables) => {
    const target = findById(tables.users, user.id, 'La administradora');
    const username = normalizedUsername(body.username ?? target.username);
    ensureUnique(tables.users, 'username', username, target.id, 'una usuaria');
    target.username = username;
    target.name = requiredString(body.name ?? target.name, 'nombre', { max: 160 });
    target.updated_at = nowIso();
    if (body.pin) {
      const pinRecord = await createPinRecord(validatePin(body.pin), env.AUTH_PEPPER);
      target.pin_salt = pinRecord.salt;
      target.pin_hash = pinRecord.hash;
      target.auth_version = String(Number(target.auth_version || 1) + 1);
    }
    addAudit(tables.audit, user, 'UPDATE_ACCOUNT', 'user', target.id, { username: target.username });
    return { entity: target };
  }, 'Update administrator account');

  const token = await createSessionToken(result.entity, env);
  return ok(
    { user: publicUser(result.entity) },
    200,
    { 'Set-Cookie': sessionCookie(token, request, env) },
  );
}

async function handleProducts(store, request, method, parts, user) {
  if (method === 'GET' && parts.length === 1) {
    const { tables } = await store.readTables(['products']);
    const products = tables.products
      .filter((row) => user.role === 'admin' || row.status !== 'deleted')
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return ok({ products });
  }

  if (method === 'POST' && parts.length === 1) {
    const body = await readJson(request);
    const result = await store.mutateTables(
      ['products', 'users', 'categories', 'subcategories', 'sizes', 'audit'],
      async (tables) => {
        const parsed = productPayload(body, tables, user);
        const prefix = `${parsed.owner.initials}-${parsed.category.code}-${parsed.subcategory.code}`;
        const sequence = productSequence(tables.products, prefix);
        const id = `${prefix}-${String(sequence).padStart(4, '0')}`;
        const now = nowIso();
        const product = {
          id,
          name: parsed.name,
          description: parsed.description,
          entered_at: now,
          owner_user_id: parsed.owner.id,
          owner_name: parsed.owner.name,
          owner_initials: parsed.owner.initials,
          category_id: parsed.category.id,
          category_name: parsed.category.name,
          category_code: parsed.category.code,
          subcategory_id: parsed.subcategory.id,
          subcategory_name: parsed.subcategory.name,
          subcategory_code: parsed.subcategory.code,
          size_id: parsed.size.id,
          size_name: parsed.size.name,
          sale_price: parsed.salePrice.toFixed(2),
          notes: parsed.notes,
          status: 'available',
          created_by_user_id: user.id,
          created_by_name: user.name,
          updated_by_user_id: user.id,
          updated_by_name: user.name,
          created_at: now,
          updated_at: now,
          deleted_at: '',
        };
        tables.products.push(product);
        addAudit(tables.audit, user, 'CREATE', 'product', id, { owner: parsed.owner.username });
        return { entity: product };
      },
      `Add product by ${user.username}`,
    );
    return ok({ product: result.entity }, 201);
  }

  const id = parts[1];
  assert(id, 404, 'NOT_FOUND', 'Producto no encontrado.');

  if (method === 'PUT' && parts.length === 2) {
    const body = await readJson(request);
    const result = await store.mutateTables(
      ['products', 'users', 'categories', 'subcategories', 'sizes', 'audit'],
      async (tables) => {
        const product = findById(tables.products, id, 'El producto');
        const ownsProduct = product.owner_user_id === user.id;
        assert(user.role === 'admin' || ownsProduct, 403, 'FORBIDDEN', 'Solo puedes editar tus propios productos.');
        assert(user.role === 'admin' || product.status === 'available', 400, 'PRODUCT_NOT_EDITABLE', 'Solo pueden editarse productos disponibles.');
        const parsed = productPayload(body, tables, user, product);
        Object.assign(product, {
          name: parsed.name,
          description: parsed.description,
          owner_user_id: parsed.owner.id,
          owner_name: parsed.owner.name,
          owner_initials: parsed.owner.initials,
          category_id: parsed.category.id,
          category_name: parsed.category.name,
          category_code: parsed.category.code,
          subcategory_id: parsed.subcategory.id,
          subcategory_name: parsed.subcategory.name,
          subcategory_code: parsed.subcategory.code,
          size_id: parsed.size.id,
          size_name: parsed.size.name,
          sale_price: parsed.salePrice.toFixed(2),
          notes: parsed.notes,
          updated_by_user_id: user.id,
          updated_by_name: user.name,
          updated_at: nowIso(),
        });
        addAudit(tables.audit, user, 'UPDATE', 'product', id, {});
        return { entity: product };
      },
      `Update product ${id}`,
    );
    return ok({ product: result.entity });
  }

  if (method === 'DELETE' && parts.length === 2) {
    const result = await store.mutateTables(['products', 'audit'], async (tables) => {
      const product = findById(tables.products, id, 'El producto');
      const ownsProduct = product.owner_user_id === user.id;
      assert(user.role === 'admin' || ownsProduct, 403, 'FORBIDDEN', 'Solo puedes eliminar tus propios productos.');
      assert(user.role === 'admin' || product.status === 'available', 400, 'PRODUCT_NOT_DELETABLE', 'No puedes eliminar un producto vendido.');
      product.status = 'deleted';
      product.deleted_at = nowIso();
      product.updated_at = product.deleted_at;
      product.updated_by_user_id = user.id;
      product.updated_by_name = user.name;
      addAudit(tables.audit, user, 'DELETE', 'product', id, {});
      return { entity: product };
    }, `Delete product ${id}`);
    return ok({ product: result.entity });
  }

  throw new AppError(404, 'NOT_FOUND', 'Ruta de productos no encontrada.');
}

async function handleSales(store, request, method, parts, user) {
  if (method === 'GET' && parts.length === 1) {
    const { tables } = await store.readTables(['sales']);
    const sales = tables.sales
      .filter((row) => user.role === 'admin' || row.status === 'completed')
      .map(numericSale)
      .sort((a, b) => String(b.sold_at).localeCompare(String(a.sold_at)));
    return ok({ sales });
  }

  if (method === 'POST' && parts.length === 1) {
    const body = await readJson(request);
    const result = await store.mutateTables(
      ['sales', 'products', 'categories', 'payment_methods', 'settings', 'audit'],
      async (tables) => {
        const product = findById(tables.products, requiredString(body.product_id, 'producto'), 'El producto');
        assert(product.status === 'available', 409, 'PRODUCT_UNAVAILABLE', 'El producto ya no está disponible para venta.');
        const parsed = salePayload(body, tables, product);
        const dateToken = localDateToken(parsed.settings);
        const id = `VTA-${dateToken}-${String(saleSequence(tables.sales, dateToken)).padStart(4, '0')}`;
        const now = nowIso();
        const c = parsed.calculation;
        const sale = {
          id,
          product_id: product.id,
          product_name: product.name,
          product_owner_user_id: product.owner_user_id,
          product_owner_name: product.owner_name,
          registered_by_user_id: user.id,
          registered_by_name: user.name,
          sold_at: now,
          category_id: parsed.category.id,
          category_name: parsed.category.name,
          payment_method_id: parsed.paymentMethod.id,
          payment_method_name: parsed.paymentMethod.name,
          base_price: c.base_price.toFixed(2),
          discount_percent: String(c.discount_percent),
          discount_amount: c.discount_amount.toFixed(2),
          extra_percent: String(c.extra_percent),
          extra_amount: c.extra_amount.toFixed(2),
          adjusted_price: c.adjusted_price.toFixed(2),
          store_commission_percent: String(c.store_commission_percent),
          store_commission_amount: c.store_commission_amount.toFixed(2),
          card_fee_percent: String(c.card_fee_percent),
          card_fee_amount: c.card_fee_amount.toFixed(2),
          card_fee_tax_percent: String(c.card_fee_tax_percent),
          card_fee_tax_amount: c.card_fee_tax_amount.toFixed(2),
          total_card_cost: c.total_card_cost.toFixed(2),
          total_deductions: c.total_deductions.toFixed(2),
          net_to_artisan: c.net_to_artisan.toFixed(2),
          notes: parsed.notes,
          status: 'completed',
          created_at: now,
          updated_at: now,
          deleted_at: '',
        };
        tables.sales.push(sale);
        product.status = 'sold';
        product.updated_at = now;
        product.updated_by_user_id = user.id;
        product.updated_by_name = user.name;
        addAudit(tables.audit, user, 'CREATE', 'sale', id, { product_id: product.id });
        return { entity: numericSale(sale) };
      },
      `Register sale by ${user.username}`,
    );
    return ok({ sale: result.entity }, 201);
  }

  const id = parts[1];
  assert(id, 404, 'NOT_FOUND', 'Venta no encontrada.');
  requireAdmin(user);

  if (method === 'PUT' && parts.length === 2) {
    const body = await readJson(request);
    const result = await store.mutateTables(
      ['sales', 'products', 'categories', 'payment_methods', 'settings', 'audit'],
      async (tables) => {
        const sale = findById(tables.sales, id, 'La venta');
        assert(sale.status === 'completed', 400, 'SALE_NOT_EDITABLE', 'La venta cancelada no puede editarse.');
        const oldProduct = findById(tables.products, sale.product_id, 'El producto anterior');
        const newProductId = requiredString(body.product_id || sale.product_id, 'producto');
        const newProduct = findById(tables.products, newProductId, 'El producto');
        if (newProduct.id !== oldProduct.id) {
          assert(newProduct.status === 'available', 409, 'PRODUCT_UNAVAILABLE', 'El nuevo producto no está disponible.');
          if (oldProduct.status === 'sold') oldProduct.status = 'available';
          oldProduct.updated_at = nowIso();
          newProduct.status = 'sold';
          newProduct.updated_at = nowIso();
        }
        const parsed = salePayload({
          payment_method_id: body.payment_method_id || sale.payment_method_id,
          discount_percent: body.discount_percent ?? sale.discount_percent,
          extra_percent: body.extra_percent ?? sale.extra_percent,
          notes: body.notes ?? sale.notes,
        }, tables, newProduct);
        const c = parsed.calculation;
        Object.assign(sale, {
          product_id: newProduct.id,
          product_name: newProduct.name,
          product_owner_user_id: newProduct.owner_user_id,
          product_owner_name: newProduct.owner_name,
          category_id: parsed.category.id,
          category_name: parsed.category.name,
          payment_method_id: parsed.paymentMethod.id,
          payment_method_name: parsed.paymentMethod.name,
          base_price: c.base_price.toFixed(2),
          discount_percent: String(c.discount_percent),
          discount_amount: c.discount_amount.toFixed(2),
          extra_percent: String(c.extra_percent),
          extra_amount: c.extra_amount.toFixed(2),
          adjusted_price: c.adjusted_price.toFixed(2),
          store_commission_percent: String(c.store_commission_percent),
          store_commission_amount: c.store_commission_amount.toFixed(2),
          card_fee_percent: String(c.card_fee_percent),
          card_fee_amount: c.card_fee_amount.toFixed(2),
          card_fee_tax_percent: String(c.card_fee_tax_percent),
          card_fee_tax_amount: c.card_fee_tax_amount.toFixed(2),
          total_card_cost: c.total_card_cost.toFixed(2),
          total_deductions: c.total_deductions.toFixed(2),
          net_to_artisan: c.net_to_artisan.toFixed(2),
          notes: parsed.notes,
          updated_at: nowIso(),
        });
        addAudit(tables.audit, user, 'UPDATE', 'sale', id, { product_id: newProduct.id });
        return { entity: numericSale(sale) };
      },
      `Update sale ${id}`,
    );
    return ok({ sale: result.entity });
  }

  if (method === 'DELETE' && parts.length === 2) {
    const result = await store.mutateTables(['sales', 'products', 'audit'], async (tables) => {
      const sale = findById(tables.sales, id, 'La venta');
      assert(sale.status === 'completed', 400, 'SALE_ALREADY_CANCELLED', 'La venta ya está cancelada.');
      sale.status = 'cancelled';
      sale.deleted_at = nowIso();
      sale.updated_at = sale.deleted_at;
      const product = tables.products.find((row) => row.id === sale.product_id);
      if (product && product.status === 'sold') {
        product.status = 'available';
        product.updated_at = sale.updated_at;
        product.updated_by_user_id = user.id;
        product.updated_by_name = user.name;
      }
      addAudit(tables.audit, user, 'CANCEL', 'sale', id, { product_id: sale.product_id });
      return { entity: numericSale(sale) };
    }, `Cancel sale ${id}`);
    return ok({ sale: result.entity });
  }

  throw new AppError(404, 'NOT_FOUND', 'Ruta de ventas no encontrada.');
}

function catalogInput(type, body, tables, existing = null) {
  const now = nowIso();
  const common = {
    active: booleanString(body.active, existing ? isActive(existing) : true),
    sort_order: String(body.sort_order ?? existing?.sort_order ?? nextSortOrder(tables[type])),
    updated_at: now,
  };

  if (type === 'categories') {
    const name = requiredString(body.name ?? existing?.name, 'nombre', { max: 120 });
    const code = validateCode(body.code ?? existing?.code, 'código');
    ensureUnique(tables.categories, 'name', name, existing?.id, 'una categoría');
    ensureUnique(tables.categories, 'code', code, existing?.id, 'una categoría');
    return {
      id: existing?.id || `CAT-${code}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
      name,
      code,
      commission_percent: String(percentage(body.commission_percent ?? existing?.commission_percent ?? 0, 'La comisión')),
      ...common,
      created_at: existing?.created_at || now,
    };
  }

  if (type === 'subcategories') {
    const categoryId = requiredString(body.category_id ?? existing?.category_id, 'categoría');
    assert(findActive(tables.categories, categoryId), 400, 'INVALID_CATEGORY', 'La categoría no está disponible.');
    const name = requiredString(body.name ?? existing?.name, 'nombre', { max: 120 });
    const code = validateCode(body.code ?? existing?.code, 'código');
    const duplicate = tables.subcategories.find((row) => (
      row.id !== existing?.id
      && row.category_id === categoryId
      && isActive(row)
      && (row.name.toUpperCase() === name.toUpperCase() || row.code.toUpperCase() === code.toUpperCase())
    ));
    assert(!duplicate, 409, 'DUPLICATE_VALUE', 'Ya existe esa subcategoría dentro de la categoría.');
    return {
      id: existing?.id || `SUB-${code}-${crypto.randomUUID().slice(0, 5).toUpperCase()}`,
      category_id: categoryId,
      name,
      code,
      ...common,
      created_at: existing?.created_at || now,
    };
  }

  if (type === 'sizes') {
    const name = requiredString(body.name ?? existing?.name, 'nombre', { max: 80 });
    ensureUnique(tables.sizes, 'name', name, existing?.id, 'una talla');
    return {
      id: existing?.id || `SIZE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      name,
      ...common,
      created_at: existing?.created_at || now,
    };
  }

  if (type === 'payment_methods') {
    const name = requiredString(body.name ?? existing?.name, 'nombre', { max: 100 });
    const code = validateCode(body.code ?? existing?.code, 'código');
    ensureUnique(tables.payment_methods, 'name', name, existing?.id, 'un método de pago');
    ensureUnique(tables.payment_methods, 'code', code, existing?.id, 'un método de pago');
    return {
      id: existing?.id || `PAY-${code}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
      name,
      code,
      card_fee_applies: booleanString(body.card_fee_applies, existing ? existing.card_fee_applies === 'true' : false),
      ...common,
      created_at: existing?.created_at || now,
    };
  }

  if (type === 'locations') {
    const municipio = requiredString(body.municipio ?? existing?.municipio, 'municipio', { max: 120 });
    const localidad = requiredString(body.localidad ?? existing?.localidad, 'localidad', { max: 160 });
    const duplicate = tables.locations.find((row) => (
      row.id !== existing?.id
      && isActive(row)
      && row.municipio.toUpperCase() === municipio.toUpperCase()
      && row.localidad.toUpperCase() === localidad.toUpperCase()
    ));
    assert(!duplicate, 409, 'DUPLICATE_VALUE', 'La relación municipio/localidad ya existe.');
    return {
      id: existing?.id || `LOC-${slug(`${municipio}-${localidad}`)}-${crypto.randomUUID().slice(0, 4)}`,
      municipio,
      localidad,
      ...common,
      created_at: existing?.created_at || now,
    };
  }

  throw new AppError(400, 'INVALID_CATALOG', 'El catálogo indicado no existe.');
}

async function handleCatalogAdmin(store, request, method, parts, user) {
  requireAdmin(user);
  const type = parts[1];
  assert(ALL_CATALOG_TYPES.has(type), 404, 'NOT_FOUND', 'Catálogo no encontrado.');

  if (method === 'POST' && parts.length === 2) {
    const body = await readJson(request);
    const names = [type, 'audit', ...(type === 'subcategories' ? ['categories'] : [])];
    const result = await store.mutateTables(names, async (tables) => {
      const created = catalogInput(type, body, tables);
      tables[type].push(created);
      addAudit(tables.audit, user, 'CREATE', type, created.id, {});
      return { entity: created };
    }, `Add ${type} item`);
    return ok({ item: result.entity }, 201);
  }

  const id = parts[2];
  assert(id, 404, 'NOT_FOUND', 'Elemento no encontrado.');

  if (method === 'PUT' && parts.length === 3) {
    const body = await readJson(request);
    const names = [type, 'audit', ...(type === 'subcategories' ? ['categories'] : [])];
    const result = await store.mutateTables(names, async (tables) => {
      const existing = findById(tables[type], id, 'El elemento');
      const updated = catalogInput(type, body, tables, existing);
      Object.assign(existing, updated);
      addAudit(tables.audit, user, 'UPDATE', type, id, {});
      return { entity: existing };
    }, `Update ${type} item ${id}`);
    return ok({ item: result.entity });
  }

  if (method === 'DELETE' && parts.length === 3) {
    const result = await store.mutateTables([type, 'audit'], async (tables) => {
      const existing = findById(tables[type], id, 'El elemento');
      existing.active = 'false';
      existing.updated_at = nowIso();
      addAudit(tables.audit, user, 'DEACTIVATE', type, id, {});
      return { entity: existing };
    }, `Deactivate ${type} item ${id}`);
    return ok({ item: result.entity });
  }

  throw new AppError(404, 'NOT_FOUND', 'Ruta de catálogo no encontrada.');
}

async function handleSettings(store, request, user) {
  requireAdmin(user);
  const body = await readJson(request);
  const allowed = {
    store_name: () => requiredString(body.store_name, 'nombre de la tienda', { max: 180 }),
    card_fee_percent: () => String(percentage(body.card_fee_percent, 'La comisión de tarjeta')),
    card_fee_tax_percent: () => String(percentage(body.card_fee_tax_percent, 'El impuesto de la comisión')),
    currency: () => requiredString(body.currency, 'moneda', { min: 3, max: 3 }).toUpperCase(),
    timezone: () => requiredString(body.timezone, 'zona horaria', { max: 80 }),
  };

  try {
    new Intl.DateTimeFormat('es-MX', { timeZone: body.timezone }).format(new Date());
  } catch {
    throw new AppError(400, 'INVALID_TIMEZONE', 'La zona horaria no es válida.');
  }

  const values = Object.fromEntries(Object.entries(allowed).map(([key, read]) => [key, read()]));
  const result = await store.mutateTables(['settings', 'audit'], async (tables) => {
    const now = nowIso();
    for (const [key, value] of Object.entries(values)) {
      const row = tables.settings.find((item) => item.key === key);
      if (row) {
        row.value = value;
        row.updated_at = now;
      } else {
        tables.settings.push({ key, value, updated_at: now });
      }
    }
    addAudit(tables.audit, user, 'UPDATE', 'settings', 'global', values);
    return { entity: values };
  }, 'Update application settings');
  return ok({ settings: result.entity });
}

export async function onRequest(context) {
  const { request, env } = context;
  const method = normalizeMethod(request);

  if (method === 'OPTIONS') return new Response(null, { status: 204 });

  try {
    const parts = getPathParts(request);
    const store = new CsvStore(env);

    if (method === 'GET' && parts[0] === 'bootstrap') return await handleBootstrap(store);
    if (method === 'POST' && parts[0] === 'setup') return await handleSetup(store, request, env);
    if (method === 'POST' && parts[0] === 'login') return await handleLogin(store, request, env);
    if (method === 'POST' && parts[0] === 'logout') {
      return ok({}, 200, { 'Set-Cookie': clearSessionCookie(request) });
    }
    if (method === 'GET' && parts[0] === 'session') return await handleSession(store, request, env);

    const user = await requireUser(store, request, env);

    if (method === 'GET' && parts[0] === 'catalogs' && parts.length === 1) return await handleCatalogs(store, user);
    if (parts[0] === 'catalogs' && parts.length >= 2) return await handleCatalogAdmin(store, request, method, parts, user);
    if (parts[0] === 'users') return await handleUsers(store, request, method, parts, user, env);
    if (method === 'PUT' && parts[0] === 'admin' && parts[1] === 'account') {
      return await handleAdminAccount(store, request, user, env);
    }
    if (parts[0] === 'products') return await handleProducts(store, request, method, parts, user);
    if (parts[0] === 'sales') return await handleSales(store, request, method, parts, user);
    if (method === 'PUT' && parts[0] === 'settings') return await handleSettings(store, request, user);

    throw new AppError(404, 'NOT_FOUND', 'La ruta solicitada no existe.');
  } catch (error) {
    return errorResponse(error);
  }
}
