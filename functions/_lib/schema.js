export const TABLE_DEFINITIONS = {
  users: {
    path: 'data/users.csv',
    columns: [
      'id', 'name', 'initials', 'username', 'pin_salt', 'pin_hash', 'role',
      'municipio', 'localidad', 'telefono', 'colectivo', 'correo', 'observaciones',
      'active', 'auth_version', 'created_at', 'updated_at',
    ],
  },
  categories: {
    path: 'data/categories.csv',
    columns: ['id', 'name', 'code', 'commission_percent', 'active', 'sort_order', 'created_at', 'updated_at'],
  },
  subcategories: {
    path: 'data/subcategories.csv',
    columns: ['id', 'category_id', 'name', 'code', 'active', 'sort_order', 'created_at', 'updated_at'],
  },
  sizes: {
    path: 'data/sizes.csv',
    columns: ['id', 'name', 'active', 'sort_order', 'created_at', 'updated_at'],
  },
  payment_methods: {
    path: 'data/payment_methods.csv',
    columns: ['id', 'name', 'code', 'card_fee_applies', 'active', 'sort_order', 'created_at', 'updated_at'],
  },
  locations: {
    path: 'data/locations.csv',
    columns: ['id', 'municipio', 'localidad', 'active', 'sort_order', 'created_at', 'updated_at'],
  },
  settings: {
    path: 'data/settings.csv',
    columns: ['key', 'value', 'updated_at'],
  },
  products: {
    path: 'data/products.csv',
    columns: [
      'id', 'name', 'description', 'entered_at', 'owner_user_id', 'owner_name', 'owner_initials',
      'category_id', 'category_name', 'category_code', 'subcategory_id', 'subcategory_name',
      'subcategory_code', 'size_id', 'size_name', 'sale_price', 'notes', 'status',
      'created_by_user_id', 'created_by_name', 'updated_by_user_id', 'updated_by_name',
      'created_at', 'updated_at', 'deleted_at',
    ],
  },
  sales: {
    path: 'data/sales.csv',
    columns: [
      'id', 'product_id', 'product_name', 'product_owner_user_id', 'product_owner_name',
      'registered_by_user_id', 'registered_by_name', 'sold_at', 'category_id', 'category_name',
      'payment_method_id', 'payment_method_name', 'base_price', 'discount_percent', 'discount_amount',
      'extra_percent', 'extra_amount', 'adjusted_price', 'store_commission_percent',
      'store_commission_amount', 'card_fee_percent', 'card_fee_amount', 'card_fee_tax_percent',
      'card_fee_tax_amount', 'total_card_cost', 'total_deductions', 'net_to_artisan', 'notes',
      'status', 'created_at', 'updated_at', 'deleted_at',
    ],
  },
  audit: {
    path: 'data/audit.csv',
    columns: ['id', 'timestamp', 'user_id', 'username', 'action', 'entity_type', 'entity_id', 'details'],
  },
};

export function tableDefinition(name) {
  const definition = TABLE_DEFINITIONS[name];
  if (!definition) throw new Error(`Tabla desconocida: ${name}`);
  return definition;
}
