import { api, ApiError } from './api.js';
import {
  $, $$, calculatePreview, dateTime, debounce, escapeHtml, localDate, money,
  setBusy, statusLabel,
} from './utils.js';

const state = {
  user: null,
  catalogs: null,
  products: [],
  sales: [],
  users: [],
  currentSection: 'dashboard',
};

const isActive = (row) => String(row?.active ?? 'true').toLowerCase() !== 'false';
const isAdmin = () => state.user?.role === 'admin';
const settings = () => state.catalogs?.settings || {};
const currency = () => settings().currency || 'MXN';
const timeZone = () => settings().timezone || 'America/Merida';

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  $('#toastRegion').append(toast);
  setTimeout(() => toast.remove(), 4200);
}

function handleError(error) {
  console.error(error);
  if (error instanceof ApiError && ['UNAUTHENTICATED', 'INVALID_SESSION', 'SESSION_EXPIRED', 'SESSION_REVOKED', 'ACCOUNT_INACTIVE'].includes(error.code)) {
    showToast(error.message, 'error');
    showAuth('login');
    return;
  }
  showToast(error?.message || 'Ocurrió un error inesperado.', 'error');
}

function setAdminVisibility() {
  $$('.admin-only').forEach((element) => {
    element.style.display = isAdmin() ? '' : 'none';
  });
  $('#productOwner').required = isAdmin();
}

function showAuth(mode = 'login') {
  state.user = null;
  state.catalogs = null;
  state.products = [];
  state.sales = [];
  state.users = [];
  $('#loadingView').classList.add('hidden');
  $('#appView').classList.add('hidden');
  $('#authView').classList.remove('hidden');
  $('#loginPanel').classList.toggle('hidden', mode !== 'login');
  $('#setupPanel').classList.toggle('hidden', mode !== 'setup');
}

async function showApp(user) {
  state.user = user;
  $('#loadingView').classList.add('hidden');
  $('#authView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  $('#currentUserName').textContent = user.name;
  $('#currentUserRole').textContent = user.role === 'admin' ? 'Administradora' : 'Vendedora';
  setAdminVisibility();
  await refreshAll();
  switchSection('dashboard');
}

async function refreshAll({ quiet = false } = {}) {
  const requests = [api('catalogs'), api('products'), api('sales')];
  if (isAdmin()) requests.push(api('users'));
  const [catalogResponse, productsResponse, salesResponse, usersResponse] = await Promise.all(requests);
  state.catalogs = catalogResponse.catalogs;
  state.products = productsResponse.products || [];
  state.sales = salesResponse.sales || [];
  state.users = usersResponse?.users || [];
  $('#appStoreName').textContent = settings().store_name || 'Tienda del Consejo';
  renderEverything();
  if (!quiet) showToast('Datos actualizados.');
}

function renderEverything() {
  renderSummary();
  renderProductFilters();
  renderProducts();
  renderSaleFormOptions();
  renderSales();
  if (isAdmin()) {
    renderUsers();
    renderCatalogTable();
    fillSettingsForm();
    fillAccountForm();
  }
}

function switchSection(name) {
  if (name === 'admin' && !isAdmin()) return;
  state.currentSection = name;
  $$('.page-section').forEach((section) => section.classList.add('hidden'));
  $(`#section-${name}`)?.classList.remove('hidden');
  $$('.nav-button').forEach((button) => button.classList.toggle('active', button.dataset.section === name));
  if (name === 'register-sale') updateSalePreview();
}

function renderSummary() {
  const available = state.products.filter((product) => product.status === 'available').length;
  const sold = state.products.filter((product) => product.status === 'sold').length;
  const today = localDate(new Date().toISOString(), timeZone());
  const todaySales = state.sales.filter((sale) => sale.status === 'completed' && localDate(sale.sold_at, timeZone()) === today);
  const totalNet = state.sales
    .filter((sale) => sale.status === 'completed')
    .reduce((sum, sale) => sum + Number(sale.net_to_artisan || 0), 0);
  const totalGross = state.sales
    .filter((sale) => sale.status === 'completed')
    .reduce((sum, sale) => sum + Number(sale.adjusted_price || 0), 0);

  $('#summaryCards').innerHTML = [
    ['Productos disponibles', available, 'Listos para vender'],
    ['Productos vendidos', sold, 'Marcados en inventario'],
    ['Ventas de hoy', todaySales.length, money(todaySales.reduce((sum, sale) => sum + Number(sale.adjusted_price || 0), 0), currency())],
    ['Neto acumulado', money(totalNet, currency()), `De ${money(totalGross, currency())} cobrados`],
  ].map(([label, value, detail]) => `
    <article class="summary-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </article>
  `).join('');

  const recent = state.sales.filter((sale) => sale.status === 'completed').slice(0, 6);
  const container = $('#recentSales');
  if (!recent.length) {
    container.className = 'recent-list empty-state';
    container.textContent = 'Todavía no hay ventas registradas.';
    return;
  }
  container.className = 'recent-list';
  container.innerHTML = recent.map((sale) => `
    <div class="recent-item">
      <strong>${escapeHtml(sale.id)}</strong>
      <div><strong>${escapeHtml(sale.product_name)}</strong><br><small>${escapeHtml(sale.product_owner_name)}</small></div>
      <span>${escapeHtml(dateTime(sale.sold_at, timeZone()))}</span>
      <strong class="price">${escapeHtml(money(sale.adjusted_price, currency()))}</strong>
    </div>
  `).join('');
}

function activeCatalog(name) {
  return (state.catalogs?.[name] || []).filter(isActive);
}

function optionHtml(rows, valueField = 'id', labelField = 'name', selected = '') {
  return rows.map((row) => `
    <option value="${escapeHtml(row[valueField])}" ${String(row[valueField]) === String(selected) ? 'selected' : ''}>${escapeHtml(row[labelField])}</option>
  `).join('');
}

function renderProductFilters() {
  const select = $('#productCategoryFilter');
  const current = select.value;
  select.innerHTML = `<option value="">Todas</option>${optionHtml(activeCatalog('categories'))}`;
  select.value = current;
}

function filteredProducts() {
  const query = $('#productSearch').value.trim().toLowerCase();
  const status = $('#productStatusFilter').value;
  const category = $('#productCategoryFilter').value;
  const onlyMine = isAdmin() && $('#myProductsFilter').checked;
  return state.products.filter((product) => {
    const haystack = `${product.id} ${product.name} ${product.owner_name} ${product.category_name} ${product.subcategory_name}`.toLowerCase();
    return (!query || haystack.includes(query))
      && (!status || product.status === status)
      && (!category || product.category_id === category)
      && (!onlyMine || product.owner_user_id === state.user.id);
  });
}

function renderProducts() {
  const products = filteredProducts();
  $('#productsEmpty').classList.toggle('hidden', products.length > 0);
  $('#productsTableBody').innerHTML = products.map((product) => {
    const canEdit = isAdmin() || (product.owner_user_id === state.user.id && product.status === 'available');
    const canDelete = isAdmin() || (product.owner_user_id === state.user.id && product.status === 'available');
    const actions = [
      product.status === 'available' ? `<button class="button secondary" data-product-action="sell" data-id="${escapeHtml(product.id)}" type="button">Vender</button>` : '',
      canEdit ? `<button class="button ghost" data-product-action="edit" data-id="${escapeHtml(product.id)}" type="button">Editar</button>` : '',
      canDelete && product.status !== 'deleted' ? `<button class="button danger" data-product-action="delete" data-id="${escapeHtml(product.id)}" type="button">Eliminar</button>` : '',
    ].join('');
    return `
      <tr>
        <td><span class="product-id">${escapeHtml(product.id)}</span></td>
        <td><strong>${escapeHtml(product.name)}</strong><br><small class="muted">${escapeHtml(product.subcategory_name)}</small></td>
        <td>${escapeHtml(product.owner_name)}</td>
        <td>${escapeHtml(product.category_name)}</td>
        <td>${escapeHtml(product.size_name)}</td>
        <td class="price">${escapeHtml(money(product.sale_price, currency()))}</td>
        <td><span class="badge ${escapeHtml(product.status)}">${escapeHtml(statusLabel(product.status))}</span></td>
        <td><div class="table-actions">${actions}</div></td>
      </tr>
    `;
  }).join('');
}

function fillProductDialogSelects(product = null) {
  if (isAdmin()) {
    const owners = state.users.filter((user) => user.role === 'seller' && (isActive(user) || user.id === product?.owner_user_id));
    $('#productOwner').innerHTML = `<option value="">Selecciona</option>${optionHtml(owners, 'id', 'name', product?.owner_user_id)}`;
  }
  const categories = (state.catalogs.categories || []).filter((row) => isActive(row) || row.id === product?.category_id);
  $('#productCategory').innerHTML = `<option value="">Selecciona</option>${optionHtml(categories, 'id', 'name', product?.category_id)}`;
  const sizes = (state.catalogs.sizes || []).filter((row) => isActive(row) || row.id === product?.size_id);
  $('#productSize').innerHTML = `<option value="">Selecciona</option>${optionHtml(sizes, 'id', 'name', product?.size_id)}`;
  renderProductSubcategories(product?.subcategory_id);
}

function renderProductSubcategories(selected = '') {
  const categoryId = $('#productCategory').value;
  const rows = (state.catalogs.subcategories || []).filter((row) => row.category_id === categoryId && (isActive(row) || row.id === selected));
  $('#productSubcategory').innerHTML = `<option value="">Selecciona</option>${optionHtml(rows, 'id', 'name', selected)}`;
}

function openProductDialog(product = null) {
  $('#productForm').reset();
  $('#productEditId').value = product?.id || '';
  $('#productDialogTitle').textContent = product ? `Editar ${product.id}` : 'Agregar producto';
  fillProductDialogSelects(product);
  if (product) {
    $('#productName').value = product.name;
    $('#productDescription').value = product.description || '';
    if (isAdmin()) $('#productOwner').value = product.owner_user_id;
    $('#productCategory').value = product.category_id;
    renderProductSubcategories(product.subcategory_id);
    $('#productSubcategory').value = product.subcategory_id;
    $('#productSize').value = product.size_id;
    $('#productPrice').value = product.sale_price;
    $('#productNotes').value = product.notes || '';
  }
  $('#productDialog').showModal();
}

function renderSaleFormOptions(selectedProduct = '') {
  const available = state.products.filter((product) => product.status === 'available' || product.id === selectedProduct);
  $('#saleProductId').innerHTML = `<option value="">Selecciona un producto</option>${available.map((product) => `
    <option value="${escapeHtml(product.id)}">${escapeHtml(product.id)} — ${escapeHtml(product.name)} — ${escapeHtml(money(product.sale_price, currency()))}</option>
  `).join('')}`;
  if (selectedProduct) $('#saleProductId').value = selectedProduct;
  $('#salePaymentMethod').innerHTML = `<option value="">Selecciona un método</option>${optionHtml(activeCatalog('payment_methods'))}`;
}

function filterSaleProductOptions() {
  const query = $('#saleProductSearch').value.trim().toLowerCase();
  const current = $('#saleProductId').value;
  const available = state.products.filter((product) => product.status === 'available' && (`${product.id} ${product.name} ${product.owner_name}`.toLowerCase().includes(query)));
  $('#saleProductId').innerHTML = `<option value="">Selecciona un producto</option>${available.map((product) => `
    <option value="${escapeHtml(product.id)}">${escapeHtml(product.id)} — ${escapeHtml(product.name)} — ${escapeHtml(money(product.sale_price, currency()))}</option>
  `).join('')}`;
  if (available.some((product) => product.id === current)) $('#saleProductId').value = current;
  updateSalePreview();
}

function currentSaleCalculation() {
  const product = state.products.find((item) => item.id === $('#saleProductId').value);
  const category = state.catalogs?.categories?.find((item) => item.id === product?.category_id);
  const payment = state.catalogs?.payment_methods?.find((item) => item.id === $('#salePaymentMethod').value);
  return {
    product,
    category,
    payment,
    calculation: calculatePreview({
      basePrice: product?.sale_price || 0,
      discountPercent: $('#saleDiscount').value,
      extraPercent: $('#saleExtra').value,
      commissionPercent: category?.commission_percent || 0,
      cardFeeApplies: payment?.card_fee_applies === 'true',
      cardFeePercent: settings().card_fee_percent || 0,
      cardFeeTaxPercent: settings().card_fee_tax_percent || 0,
    }),
  };
}

function updateSalePreview() {
  const { category, payment, calculation: c } = currentSaleCalculation();
  $('#calcBase').textContent = money(c.base, currency());
  $('#calcDiscount').textContent = `− ${money(c.discountAmount, currency())}`;
  $('#calcExtra').textContent = `+ ${money(c.extraAmount, currency())}`;
  $('#calcAdjusted').textContent = money(c.adjustedPrice, currency());
  $('#calcCommissionLabel').textContent = `Comisión de tienda (${Number(category?.commission_percent || 0)}%)`;
  $('#calcCommission').textContent = `− ${money(c.storeCommissionAmount, currency())}`;
  $('#calcCardLabel').textContent = `Comisión de tarjeta (${payment?.card_fee_applies === 'true' ? Number(settings().card_fee_percent || 0) : 0}%)`;
  $('#calcCard').textContent = `− ${money(c.cardFeeAmount, currency())}`;
  $('#calcCardTaxLabel').textContent = `${Number(settings().card_fee_tax_percent || 0)}% sobre comisión bancaria`;
  $('#calcCardTax').textContent = `− ${money(c.cardFeeTaxAmount, currency())}`;
  $('#calcNet').textContent = money(c.net, currency());
}

function filteredSales() {
  const query = $('#saleSearch').value.trim().toLowerCase();
  const from = $('#saleDateFrom').value;
  const to = $('#saleDateTo').value;
  const status = isAdmin() ? $('#saleStatusFilter').value : '';
  return state.sales.filter((sale) => {
    const saleDate = localDate(sale.sold_at, timeZone());
    const haystack = `${sale.id} ${sale.product_id} ${sale.product_name} ${sale.product_owner_name} ${sale.registered_by_name}`.toLowerCase();
    return (!query || haystack.includes(query))
      && (!from || saleDate >= from)
      && (!to || saleDate <= to)
      && (!status || sale.status === status);
  });
}

function renderSales() {
  const sales = filteredSales();
  $('#salesEmpty').classList.toggle('hidden', sales.length > 0);
  $('#salesTableBody').innerHTML = sales.map((sale) => `
    <tr>
      <td><span class="product-id">${escapeHtml(sale.id)}</span></td>
      <td>${escapeHtml(dateTime(sale.sold_at, timeZone()))}</td>
      <td><strong>${escapeHtml(sale.product_name)}</strong><br><small class="muted">${escapeHtml(sale.product_id)} · ${escapeHtml(sale.product_owner_name)}</small></td>
      <td>${escapeHtml(sale.registered_by_name)}</td>
      <td>${escapeHtml(sale.payment_method_name)}</td>
      <td class="price">${escapeHtml(money(sale.adjusted_price, currency()))}</td>
      <td class="price">${escapeHtml(money(sale.store_commission_amount, currency()))}</td>
      <td class="price">${escapeHtml(money(sale.net_to_artisan, currency()))}</td>
      <td><span class="badge ${escapeHtml(sale.status)}">${escapeHtml(statusLabel(sale.status))}</span></td>
      ${isAdmin() ? `<td><div class="table-actions">${sale.status === 'completed' ? `<button class="button ghost" data-sale-action="edit" data-id="${escapeHtml(sale.id)}" type="button">Editar</button><button class="button danger" data-sale-action="delete" data-id="${escapeHtml(sale.id)}" type="button">Cancelar</button>` : ''}</div></td>` : ''}
    </tr>
  `).join('');
}

function openSaleEditDialog(sale) {
  $('#saleEditForm').reset();
  $('#saleEditId').value = sale.id;
  const products = state.products.filter((product) => product.status === 'available' || product.id === sale.product_id);
  $('#saleEditProduct').innerHTML = products.map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.id)} — ${escapeHtml(product.name)}</option>`).join('');
  $('#saleEditProduct').value = sale.product_id;
  $('#saleEditPayment').innerHTML = optionHtml(activeCatalog('payment_methods'), 'id', 'name', sale.payment_method_id);
  $('#saleEditDiscount').value = sale.discount_percent;
  $('#saleEditExtra').value = sale.extra_percent;
  $('#saleEditNotes').value = sale.notes || '';
  $('#saleEditDialog').showModal();
}

function locationData() {
  return (state.catalogs?.locations || []).filter(isActive);
}

function fillMunicipalities(selected = '') {
  const municipalities = [...new Set(locationData().map((row) => row.municipio))].sort((a, b) => a.localeCompare(b, 'es'));
  $('#userMunicipio').innerHTML = `<option value="">Sin especificar</option>${municipalities.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}`;
  $('#userMunicipio').value = selected;
}

function fillLocalities(municipio, selected = '') {
  const localities = locationData().filter((row) => row.municipio === municipio).map((row) => row.localidad);
  $('#userLocalidad').innerHTML = `<option value="">Sin especificar</option>${localities.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}`;
  $('#userLocalidad').value = selected;
}

function renderUsers() {
  const users = state.users.filter((user) => user.role === 'seller');
  $('#usersTableBody').innerHTML = users.map((user) => `
    <tr>
      <td><strong>${escapeHtml(user.name)}</strong><br><small class="muted">${escapeHtml(user.telefono || user.correo || '')}</small></td>
      <td>${escapeHtml(user.username)}</td>
      <td>${escapeHtml(user.initials)}</td>
      <td>${escapeHtml(user.municipio || '—')}</td>
      <td>${escapeHtml(user.localidad || '—')}</td>
      <td><span class="badge ${isActive(user) ? 'active' : 'inactive'}">${isActive(user) ? 'Activa' : 'Inactiva'}</span></td>
      <td><div class="table-actions">
        <button class="button ghost" data-user-action="edit" data-id="${escapeHtml(user.id)}" type="button">Editar</button>
        <button class="button secondary" data-user-action="pin" data-id="${escapeHtml(user.id)}" type="button">Cambiar NIP</button>
        ${isActive(user) ? `<button class="button danger" data-user-action="delete" data-id="${escapeHtml(user.id)}" type="button">Desactivar</button>` : ''}
      </div></td>
    </tr>
  `).join('');
}

function openUserDialog(user = null) {
  $('#userForm').reset();
  $('#userEditId').value = user?.id || '';
  $('#userDialogTitle').textContent = user ? 'Editar vendedora' : 'Agregar vendedora';
  $('#userPinField').classList.toggle('hidden', Boolean(user));
  $('#userActiveField').classList.toggle('hidden', !user);
  fillMunicipalities(user?.municipio || '');
  fillLocalities(user?.municipio || '', user?.localidad || '');
  if (user) {
    $('#userName').value = user.name;
    $('#userInitials').value = user.initials;
    $('#userUsername').value = user.username;
    $('#userPhone').value = user.telefono || '';
    $('#userEmail').value = user.correo || '';
    $('#userCollective').value = user.colectivo || '';
    $('#userObservations').value = user.observaciones || '';
    $('#userActive').checked = isActive(user);
  } else {
    $('#userPin').value = '1234';
    $('#userActive').checked = true;
  }
  $('#userDialog').showModal();
}

const CATALOG_LABELS = {
  categories: 'Categoría',
  subcategories: 'Subcategoría',
  sizes: 'Talla',
  payment_methods: 'Método de pago',
  locations: 'Municipio y localidad',
};

function renderCatalogTable() {
  const type = $('#catalogTypeSelect').value;
  const rows = state.catalogs?.[type] || [];
  const columns = {
    categories: ['Nombre', 'Código', 'Comisión', 'Estado', 'Acciones'],
    subcategories: ['Categoría', 'Nombre', 'Código', 'Estado', 'Acciones'],
    sizes: ['Nombre', 'Estado', 'Acciones'],
    payment_methods: ['Nombre', 'Código', 'Cargo bancario', 'Estado', 'Acciones'],
    locations: ['Municipio', 'Localidad', 'Estado', 'Acciones'],
  }[type];
  $('#catalogTableHead').innerHTML = `<tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr>`;
  const categoryName = (id) => state.catalogs.categories.find((row) => row.id === id)?.name || '—';
  $('#catalogTableBody').innerHTML = rows.map((row) => {
    const values = {
      categories: [row.name, row.code, `${row.commission_percent}%`],
      subcategories: [categoryName(row.category_id), row.name, row.code],
      sizes: [row.name],
      payment_methods: [row.name, row.code, row.card_fee_applies === 'true' ? 'Sí' : 'No'],
      locations: [row.municipio, row.localidad],
    }[type];
    return `<tr>
      ${values.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}
      <td><span class="badge ${isActive(row) ? 'active' : 'inactive'}">${isActive(row) ? 'Activo' : 'Inactivo'}</span></td>
      <td><div class="table-actions"><button class="button ghost" data-catalog-action="edit" data-id="${escapeHtml(row.id)}" type="button">Editar</button>${isActive(row) ? `<button class="button danger" data-catalog-action="delete" data-id="${escapeHtml(row.id)}" type="button">Desactivar</button>` : ''}</div></td>
    </tr>`;
  }).join('');
}

function catalogFieldHtml(type, item = null) {
  const active = item ? isActive(item) : true;
  const activeField = `<label class="span-2 checkbox-line"><input id="catalogActive" type="checkbox" ${active ? 'checked' : ''}> Elemento activo</label>`;
  if (type === 'categories') return `
    <label class="span-2">Nombre<input id="catalogName" maxlength="120" value="${escapeHtml(item?.name || '')}" required></label>
    <label>Código<input id="catalogCode" maxlength="8" value="${escapeHtml(item?.code || '')}" required></label>
    <label>Comisión de tienda (%)<input id="catalogCommission" type="number" min="0" max="100" step="0.0001" value="${escapeHtml(item?.commission_percent ?? 0)}" required></label>${activeField}`;
  if (type === 'subcategories') return `
    <label class="span-2">Categoría<select id="catalogCategory" required><option value="">Selecciona</option>${optionHtml(state.catalogs.categories.filter((row) => isActive(row) || row.id === item?.category_id), 'id', 'name', item?.category_id)}</select></label>
    <label>Nombre<input id="catalogName" maxlength="120" value="${escapeHtml(item?.name || '')}" required></label>
    <label>Código<input id="catalogCode" maxlength="8" value="${escapeHtml(item?.code || '')}" required></label>${activeField}`;
  if (type === 'sizes') return `<label class="span-2">Nombre<input id="catalogName" maxlength="80" value="${escapeHtml(item?.name || '')}" required></label>${activeField}`;
  if (type === 'payment_methods') return `
    <label>Nombre<input id="catalogName" maxlength="100" value="${escapeHtml(item?.name || '')}" required></label>
    <label>Código<input id="catalogCode" maxlength="8" value="${escapeHtml(item?.code || '')}" required></label>
    <label class="span-2 checkbox-line"><input id="catalogCardFee" type="checkbox" ${item?.card_fee_applies === 'true' ? 'checked' : ''}> Aplicar comisión bancaria a este método</label>${activeField}`;
  return `
    <label>Municipio<input id="catalogMunicipio" maxlength="120" value="${escapeHtml(item?.municipio || '')}" required></label>
    <label>Localidad<input id="catalogLocalidad" maxlength="160" value="${escapeHtml(item?.localidad || '')}" required></label>${activeField}`;
}

function openCatalogDialog(item = null) {
  const type = $('#catalogTypeSelect').value;
  $('#catalogEditId').value = item?.id || '';
  $('#catalogDialogTitle').textContent = `${item ? 'Editar' : 'Agregar'} ${CATALOG_LABELS[type].toLowerCase()}`;
  $('#catalogFields').innerHTML = catalogFieldHtml(type, item);
  $('#catalogDialog').showModal();
}

function catalogPayload(type) {
  const common = { active: $('#catalogActive').checked };
  if (type === 'categories') return { ...common, name: $('#catalogName').value, code: $('#catalogCode').value, commission_percent: $('#catalogCommission').value };
  if (type === 'subcategories') return { ...common, category_id: $('#catalogCategory').value, name: $('#catalogName').value, code: $('#catalogCode').value };
  if (type === 'sizes') return { ...common, name: $('#catalogName').value };
  if (type === 'payment_methods') return { ...common, name: $('#catalogName').value, code: $('#catalogCode').value, card_fee_applies: $('#catalogCardFee').checked };
  return { ...common, municipio: $('#catalogMunicipio').value, localidad: $('#catalogLocalidad').value };
}

function fillSettingsForm() {
  $('#settingStoreName').value = settings().store_name || '';
  $('#settingCardFee').value = settings().card_fee_percent || '3.5';
  $('#settingCardTax').value = settings().card_fee_tax_percent || '16';
  $('#settingCurrency').value = settings().currency || 'MXN';
  $('#settingTimezone').value = settings().timezone || 'America/Merida';
}

function fillAccountForm() {
  $('#accountName').value = state.user.name;
  $('#accountUsername').value = state.user.username;
  $('#accountPin').value = '';
}

function switchAdminPanel(name) {
  $$('.admin-panel').forEach((panel) => panel.classList.add('hidden'));
  $(`#admin-${name}`).classList.remove('hidden');
  $$('.subnav-button').forEach((button) => button.classList.toggle('active', button.dataset.adminPanel === name));
}

async function submitWithButton(form, callback, busyText = 'Guardando…') {
  const button = form.querySelector('button[type="submit"]');
  setBusy(button, true, busyText);
  try {
    await callback();
  } catch (error) {
    handleError(error);
  } finally {
    setBusy(button, false);
  }
}

function closeDialog(id) {
  const dialog = $(`#${id}`);
  if (dialog?.open) dialog.close();
}

function bindEvents() {
  $('#loginForm').addEventListener('submit', (event) => {
    event.preventDefault();
    submitWithButton(event.currentTarget, async () => {
      const response = await api('login', {
        method: 'POST',
        body: { username: $('#loginUsername').value, pin: $('#loginPin').value },
      });
      $('#loginPin').value = '';
      await showApp(response.user);
    }, 'Ingresando…');
  });

  $('#setupForm').addEventListener('submit', (event) => {
    event.preventDefault();
    submitWithButton(event.currentTarget, async () => {
      await api('setup', {
        method: 'POST',
        body: {
          setup_key: $('#setupKey').value,
          admin_name: $('#setupAdminName').value,
          admin_username: $('#setupAdminUsername').value,
          admin_pin: $('#setupAdminPin').value,
        },
      });
      showToast('Archivos iniciales creados. Ya puedes ingresar.');
      showAuth('login');
      $('#loginUsername').value = $('#setupAdminUsername').value;
    }, 'Creando archivos…');
  });

  $('#logoutButton').addEventListener('click', async () => {
    try { await api('logout', { method: 'POST' }); } catch { /* La cookie también vencerá. */ }
    showAuth('login');
  });

  $$('.nav-button').forEach((button) => button.addEventListener('click', () => switchSection(button.dataset.section)));
  $('#refreshButton').addEventListener('click', async () => {
    setBusy($('#refreshButton'), true, 'Actualizando…');
    try { await refreshAll(); } catch (error) { handleError(error); } finally { setBusy($('#refreshButton'), false); }
  });

  $('#productSearch').addEventListener('input', debounce(renderProducts));
  $('#productStatusFilter').addEventListener('change', renderProducts);
  $('#productCategoryFilter').addEventListener('change', renderProducts);
  $('#myProductsFilter').addEventListener('change', renderProducts);
  $('#addProductButton').addEventListener('click', () => openProductDialog());
  $('#productCategory').addEventListener('change', () => renderProductSubcategories());
  $('#productsTableBody').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-product-action]');
    if (!button) return;
    const product = state.products.find((item) => item.id === button.dataset.id);
    if (!product) return;
    if (button.dataset.productAction === 'edit') openProductDialog(product);
    if (button.dataset.productAction === 'sell') {
      switchSection('register-sale');
      renderSaleFormOptions(product.id);
      $('#saleProductId').value = product.id;
      updateSalePreview();
    }
    if (button.dataset.productAction === 'delete' && confirm(`¿Eliminar el producto ${product.id}? El registro permanecerá en el historial.`)) {
      try {
        await api(`products/${encodeURIComponent(product.id)}`, { method: 'DELETE' });
        showToast('Producto eliminado.');
        await refreshAll({ quiet: true });
      } catch (error) { handleError(error); }
    }
  });

  $('#productForm').addEventListener('submit', (event) => {
    event.preventDefault();
    submitWithButton(event.currentTarget, async () => {
      const id = $('#productEditId').value;
      const body = {
        name: $('#productName').value,
        description: $('#productDescription').value,
        owner_user_id: isAdmin() ? $('#productOwner').value : undefined,
        category_id: $('#productCategory').value,
        subcategory_id: $('#productSubcategory').value,
        size_id: $('#productSize').value,
        sale_price: $('#productPrice').value,
        notes: $('#productNotes').value,
      };
      await api(id ? `products/${encodeURIComponent(id)}` : 'products', { method: id ? 'PUT' : 'POST', body });
      closeDialog('productDialog');
      showToast(id ? 'Producto actualizado.' : 'Producto registrado.');
      await refreshAll({ quiet: true });
    });
  });

  $('#saleProductSearch').addEventListener('input', debounce(filterSaleProductOptions));
  $('#saleProductId').addEventListener('change', updateSalePreview);
  $('#salePaymentMethod').addEventListener('change', updateSalePreview);
  $('#saleDiscount').addEventListener('input', () => {
    if (Number($('#saleDiscount').value) > 0) $('#saleExtra').value = 0;
    updateSalePreview();
  });
  $('#saleExtra').addEventListener('input', () => {
    if (Number($('#saleExtra').value) > 0) $('#saleDiscount').value = 0;
    updateSalePreview();
  });
  $('#saleForm').addEventListener('submit', (event) => {
    event.preventDefault();
    submitWithButton(event.currentTarget, async () => {
      const product = state.products.find((item) => item.id === $('#saleProductId').value);
      if (!product) throw new Error('Selecciona un producto disponible.');
      const { calculation } = currentSaleCalculation();
      if (!confirm(`¿Confirmar la venta de ${product.name} por ${money(calculation.adjustedPrice, currency())}?`)) return;
      await api('sales', {
        method: 'POST',
        body: {
          product_id: product.id,
          discount_percent: $('#saleDiscount').value || 0,
          extra_percent: $('#saleExtra').value || 0,
          payment_method_id: $('#salePaymentMethod').value,
          notes: $('#saleNotes').value,
        },
      });
      event.currentTarget.reset();
      $('#saleDiscount').value = 0;
      $('#saleExtra').value = 0;
      $('#saleProductSearch').value = '';
      showToast('Venta registrada correctamente.');
      await refreshAll({ quiet: true });
      switchSection('sales-history');
    }, 'Registrando…');
  });

  $('#saleSearch').addEventListener('input', debounce(renderSales));
  $('#saleDateFrom').addEventListener('change', renderSales);
  $('#saleDateTo').addEventListener('change', renderSales);
  $('#saleStatusFilter').addEventListener('change', renderSales);
  $('#salesTableBody').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-sale-action]');
    if (!button) return;
    const sale = state.sales.find((item) => item.id === button.dataset.id);
    if (!sale) return;
    if (button.dataset.saleAction === 'edit') openSaleEditDialog(sale);
    if (button.dataset.saleAction === 'delete' && confirm(`¿Cancelar la venta ${sale.id}? El producto volverá a estar disponible.`)) {
      try {
        await api(`sales/${encodeURIComponent(sale.id)}`, { method: 'DELETE' });
        showToast('Venta cancelada y producto restaurado.');
        await refreshAll({ quiet: true });
      } catch (error) { handleError(error); }
    }
  });
  $('#saleEditDiscount').addEventListener('input', () => { if (Number($('#saleEditDiscount').value) > 0) $('#saleEditExtra').value = 0; });
  $('#saleEditExtra').addEventListener('input', () => { if (Number($('#saleEditExtra').value) > 0) $('#saleEditDiscount').value = 0; });
  $('#saleEditForm').addEventListener('submit', (event) => {
    event.preventDefault();
    submitWithButton(event.currentTarget, async () => {
      const id = $('#saleEditId').value;
      await api(`sales/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: {
          product_id: $('#saleEditProduct').value,
          discount_percent: $('#saleEditDiscount').value || 0,
          extra_percent: $('#saleEditExtra').value || 0,
          payment_method_id: $('#saleEditPayment').value,
          notes: $('#saleEditNotes').value,
        },
      });
      closeDialog('saleEditDialog');
      showToast('Venta actualizada.');
      await refreshAll({ quiet: true });
    });
  });

  $$('.subnav-button').forEach((button) => button.addEventListener('click', () => switchAdminPanel(button.dataset.adminPanel)));
  $('#addUserButton').addEventListener('click', () => openUserDialog());
  $('#userMunicipio').addEventListener('change', () => fillLocalities($('#userMunicipio').value));
  $('#usersTableBody').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-user-action]');
    if (!button) return;
    const user = state.users.find((item) => item.id === button.dataset.id);
    if (!user) return;
    if (button.dataset.userAction === 'edit') openUserDialog(user);
    if (button.dataset.userAction === 'pin') {
      $('#resetPinUserId').value = user.id;
      $('#resetPinUserName').textContent = `Cuenta: ${user.name} (${user.username})`;
      $('#resetPinValue').value = '';
      $('#resetPinDialog').showModal();
    }
    if (button.dataset.userAction === 'delete' && confirm(`¿Desactivar la cuenta de ${user.name}?`)) {
      try {
        await api(`users/${encodeURIComponent(user.id)}`, { method: 'DELETE' });
        showToast('Cuenta desactivada.');
        await refreshAll({ quiet: true });
      } catch (error) { handleError(error); }
    }
  });
  $('#userForm').addEventListener('submit', (event) => {
    event.preventDefault();
    submitWithButton(event.currentTarget, async () => {
      const id = $('#userEditId').value;
      const body = {
        name: $('#userName').value,
        initials: $('#userInitials').value,
        username: $('#userUsername').value,
        pin: id ? undefined : $('#userPin').value,
        municipio: $('#userMunicipio').value,
        localidad: $('#userLocalidad').value,
        telefono: $('#userPhone').value,
        colectivo: $('#userCollective').value,
        correo: $('#userEmail').value,
        observaciones: $('#userObservations').value,
        active: id ? $('#userActive').checked : true,
      };
      await api(id ? `users/${encodeURIComponent(id)}` : 'users', { method: id ? 'PUT' : 'POST', body });
      closeDialog('userDialog');
      showToast(id ? 'Vendedora actualizada.' : 'Vendedora registrada.');
      await refreshAll({ quiet: true });
    });
  });
  $('#resetPinForm').addEventListener('submit', (event) => {
    event.preventDefault();
    submitWithButton(event.currentTarget, async () => {
      await api(`users/${encodeURIComponent($('#resetPinUserId').value)}/reset-pin`, {
        method: 'POST', body: { pin: $('#resetPinValue').value },
      });
      closeDialog('resetPinDialog');
      showToast('NIP restablecido. La sesión anterior de la usuaria quedó invalidada.');
      await refreshAll({ quiet: true });
    });
  });

  $('#catalogTypeSelect').addEventListener('change', renderCatalogTable);
  $('#addCatalogButton').addEventListener('click', () => openCatalogDialog());
  $('#catalogTableBody').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-catalog-action]');
    if (!button) return;
    const type = $('#catalogTypeSelect').value;
    const item = state.catalogs[type].find((row) => row.id === button.dataset.id);
    if (!item) return;
    if (button.dataset.catalogAction === 'edit') openCatalogDialog(item);
    if (button.dataset.catalogAction === 'delete' && confirm('¿Desactivar este elemento del catálogo? Los registros anteriores no se modificarán.')) {
      try {
        await api(`catalogs/${type}/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
        showToast('Elemento desactivado.');
        await refreshAll({ quiet: true });
      } catch (error) { handleError(error); }
    }
  });
  $('#catalogForm').addEventListener('submit', (event) => {
    event.preventDefault();
    submitWithButton(event.currentTarget, async () => {
      const type = $('#catalogTypeSelect').value;
      const id = $('#catalogEditId').value;
      await api(id ? `catalogs/${type}/${encodeURIComponent(id)}` : `catalogs/${type}`, {
        method: id ? 'PUT' : 'POST', body: catalogPayload(type),
      });
      closeDialog('catalogDialog');
      showToast(id ? 'Elemento actualizado.' : 'Elemento agregado.');
      await refreshAll({ quiet: true });
    });
  });

  $('#settingsForm').addEventListener('submit', (event) => {
    event.preventDefault();
    submitWithButton(event.currentTarget, async () => {
      await api('settings', {
        method: 'PUT',
        body: {
          store_name: $('#settingStoreName').value,
          card_fee_percent: $('#settingCardFee').value,
          card_fee_tax_percent: $('#settingCardTax').value,
          currency: $('#settingCurrency').value,
          timezone: $('#settingTimezone').value,
        },
      });
      showToast('Ajustes guardados.');
      await refreshAll({ quiet: true });
    });
  });

  $('#accountForm').addEventListener('submit', (event) => {
    event.preventDefault();
    submitWithButton(event.currentTarget, async () => {
      const response = await api('admin/account', {
        method: 'PUT',
        body: {
          name: $('#accountName').value,
          username: $('#accountUsername').value,
          pin: $('#accountPin').value || undefined,
        },
      });
      state.user = response.user;
      $('#currentUserName').textContent = response.user.name;
      $('#accountPin').value = '';
      showToast('Cuenta administradora actualizada.');
    });
  });

  $$('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => closeDialog(button.dataset.closeDialog)));
  $$('.dialog').forEach((dialog) => dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  }));
}

async function initialize() {
  bindEvents();
  try {
    const bootstrap = await api('bootstrap');
    if (!bootstrap.initialized) {
      showAuth('setup');
      return;
    }
    try {
      const session = await api('session');
      await showApp(session.user);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) showAuth('login');
      else throw error;
    }
  } catch (error) {
    $('#loadingView').classList.add('hidden');
    showAuth('login');
    handleError(error);
  }
}

initialize();
