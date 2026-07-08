# Esquema de datos

## `users.csv`

Contiene la administradora y las vendedoras. Los campos `pin_salt` y `pin_hash` no contienen el NIP original. `auth_version` permite invalidar sesiones cuando se restablece una contraseña.

## `products.csv`

El campo `id` usa la estructura:

```text
INICIALES-CATEGORÍA-SUBCATEGORÍA-CONSECUTIVO
```

Ejemplo: `ACF-ADU-BLU-0001`.

Estados:

- `available`: disponible.
- `sold`: vendido.
- `deleted`: eliminado lógicamente.

## `sales.csv`

Guarda tanto las referencias como una copia de los nombres y porcentajes utilizados al registrar la operación. Esto permite conservar el cálculo histórico aunque después cambie un catálogo.

Estados:

- `completed`: venta vigente.
- `cancelled`: venta cancelada por la administradora.

## Catálogos

- `categories.csv`: incluye código y porcentaje de comisión de la tienda.
- `subcategories.csv`: cada subcategoría pertenece a una categoría.
- `sizes.csv`: tallas disponibles.
- `payment_methods.csv`: `card_fee_applies` indica si se cobra comisión bancaria.
- `locations.csv`: relación municipio-localidad.
- `settings.csv`: porcentajes bancarios, moneda, zona horaria y nombre de la tienda.

## `audit.csv`

Registra las altas, ediciones, desactivaciones, cancelaciones y cambios de configuración. El campo `details` contiene JSON escapado dentro del CSV.
