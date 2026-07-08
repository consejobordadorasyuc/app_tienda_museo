# Tienda del Consejo Estatal de Bordadoras de Yucatán

Aplicación web en **HTML, CSS y JavaScript** para controlar inventario, ventas, comisiones, usuarias y catálogos. Está preparada para desplegarse en **Cloudflare Pages** y guardar los datos en archivos CSV dentro de una rama separada de un repositorio privado de GitHub.

## Funciones incluidas

- Inicio de sesión mediante usuario y NIP o contraseña.
- Una cuenta administradora inicial configurable; valores sugeridos: `ADM` / `9876`.
- Veinte cuentas iniciales de vendedoras con NIP temporal `1234`.
- NIP protegidos mediante HMAC-SHA-256, sal individual y un secreto que permanece en Cloudflare. Los NIP nunca se escriben en texto plano en GitHub.
- Alta, edición y eliminación lógica de productos.
- Permisos: cada vendedora puede modificar únicamente sus productos; la administradora puede modificar todos.
- Registro de ventas con descuento o cargo extra, método de pago y cálculo automático.
- Comisión por categoría y comisión bancaria configurables.
- Bloqueo de edición de ventas para vendedoras.
- Administración de vendedoras, categorías, subcategorías, tallas, métodos de pago, municipios y localidades.
- Historial de auditoría en CSV.
- Escrituras atómicas de varios CSV mediante la API de Git de GitHub para evitar que una venta quede registrada sin actualizar el producto.
- Interfaz adaptable a computadora, tableta y teléfono.

## Estructura

```text
public/                    Sitio estático
  index.html
  assets/styles.css
  js/app.js
functions/                 Cloudflare Pages Functions
  api/[[path]].js           API completa
  _lib/                     Autenticación, GitHub, CSV y cálculos
wrangler.jsonc             Configuración local de Pages
.dev.vars.example          Plantilla de variables locales
docs/                      Esquema y notas técnicas
```

Los datos se crean en la rama configurada en `GITHUB_DATA_BRANCH`, por defecto `data`:

```text
data/
  users.csv
  products.csv
  sales.csv
  categories.csv
  subcategories.csv
  sizes.csv
  payment_methods.csv
  locations.csv
  settings.csv
  audit.csv
```

## 1. Crear el repositorio

1. Crea un repositorio **privado** en GitHub.
2. Sube todo este proyecto a la rama `main`.
3. No crees manualmente la rama `data`; la aplicación puede crearla durante la configuración inicial.

## 2. Crear el token de GitHub

Crea un **fine-grained personal access token** limitado únicamente al repositorio de la aplicación.

Permiso requerido para el repositorio:

- **Contents: Read and write**

No coloques el token en ningún archivo del repositorio.

## 3. Crear el proyecto de Cloudflare Pages

En Cloudflare:

1. Abre **Workers & Pages**.
2. Crea una aplicación de Pages conectada al repositorio.
3. Selecciona `main` como rama de producción.
4. Configura:
   - **Build command:** dejar vacío.
   - **Build output directory:** `public`.
5. Confirma que la carpeta `functions` se encuentra en la raíz del repositorio.
6. En los controles de ramas, evita despliegues de la rama `data`. La rama de producción debe seguir siendo `main`.

## 4. Variables y secretos

En **Settings → Variables and Secrets**, agrega estas variables para producción y, si se usarán, para los despliegues de vista previa.

### Variables normales

| Variable | Ejemplo |
|---|---|
| `GITHUB_OWNER` | `nombre-de-la-organizacion` |
| `GITHUB_REPO` | `consejo-bordadoras-tienda` |
| `GITHUB_DATA_BRANCH` | `data` |
| `GITHUB_BASE_BRANCH` | `main` |
| `SESSION_HOURS` | `8` |

### Secretos cifrados

| Secreto | Uso |
|---|---|
| `GITHUB_TOKEN` | Token con acceso de lectura y escritura al repositorio |
| `AUTH_SECRET` | Firma de las sesiones |
| `AUTH_PEPPER` | Protección adicional de los NIP almacenados |
| `SETUP_KEY` | Autoriza la creación inicial de los CSV |

Genera valores largos e independientes para los tres secretos propios. Con Node.js:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Ejecuta el comando tres veces y usa un resultado diferente para `AUTH_SECRET`, `AUTH_PEPPER` y `SETUP_KEY`.

Después de agregar o modificar variables, vuelve a desplegar el proyecto.

## 5. Configuración inicial

Al abrir la aplicación por primera vez aparecerá el formulario **Configuración inicial**.

1. Escribe el valor configurado como `SETUP_KEY`.
2. Confirma o cambia el nombre de la administradora.
3. Confirma o cambia el usuario `ADM`.
4. Confirma o cambia el NIP `9876`.
5. Presiona **Crear archivos iniciales**.

La aplicación creará la rama `data`, los diez CSV, los catálogos iniciales y las cuentas de las primeras vendedoras.

Las cuentas iniciales de vendedoras usan como usuario las iniciales mostradas en el listado recibido y el NIP temporal `1234`. La administradora debe cambiar los NIP conforme se entreguen las cuentas.

## 6. Desarrollo local

Requisitos: Node.js 20 o posterior.

```bash
npm install
cp .dev.vars.example .dev.vars
```

Completa `.dev.vars` con un repositorio de pruebas y ejecuta:

```bash
npm run dev
```

Wrangler mostrará la dirección local. No uses el repositorio de producción para pruebas destructivas.

## 7. Publicación manual con Wrangler

Después de iniciar sesión en Cloudflare:

```bash
npm install
npx wrangler login
npm run deploy -- --project-name nombre-del-proyecto-pages
```

La integración de GitHub es preferible porque cada cambio en `main` se publica automáticamente. Los commits de la rama `data` no deben generar despliegues.

## Cálculos iniciales

```text
Precio ajustado = precio base - descuento + cargo extra
Comisión de tienda = precio ajustado × porcentaje de la categoría
Comisión bancaria = precio ajustado × porcentaje bancario
Adicional bancario = comisión bancaria × porcentaje adicional
Neto bordadora = precio ajustado - comisión tienda - comisión bancaria - adicional bancario
```

Descuento y cargo extra son mutuamente excluyentes.

Valores iniciales:

- Prendas de adulto: 30 %.
- Prendas de niña o niño: 20 %.
- Accesorios: 10 %.
- Tarjeta de crédito: comisión bancaria de 3.5 %.
- Adicional sobre la comisión bancaria: 16 %.

Todos esos porcentajes pueden modificarse desde el perfil administrador.

## Decisiones de integridad

- Los productos y ventas no se borran físicamente: se marcan como eliminados o cancelados para conservar el historial.
- Al cancelar una venta, el producto vuelve al estado disponible.
- El ID de un producto no cambia aunque posteriormente se modifiquen su categoría o subcategoría.
- Al restablecer un NIP, las sesiones anteriores de la usuaria quedan invalidadas.
- La API vuelve a calcular los importes; no confía en los valores calculados por el navegador.

## Copias de seguridad

GitHub conserva el historial de commits de la rama `data`, pero conviene descargar periódicamente los CSV o clonar esa rama:

```bash
git clone --branch data --single-branch URL_DEL_REPOSITORIO respaldo-datos
```

## Límites de esta versión

Los CSV son adecuados para una primera etapa y un volumen moderado. Cada operación crea un commit en GitHub. Si el número de usuarias, ventas simultáneas o registros aumenta considerablemente, la capa `CsvStore` puede sustituirse por Cloudflare D1 sin reconstruir la interfaz.
