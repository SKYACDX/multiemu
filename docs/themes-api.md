# API de temas para emulatornds.online

Especificación para el backend de `emulatornds.online`: qué necesita
exponer para que la app (y en el futuro la web) puedan crear, publicar,
buscar y descargar **temas** visuales para los emuladores (GB, GBA,
NDS, y cualquier sistema que se agregue después).

Este documento es solo el contrato de datos/API. La app todavía no
implementa el creador de temas ni el consumo de este API -- eso es un
paso siguiente, una vez esto exista del lado del servidor.

## Alcance de la v1 (decidido)

- **Un tema es por sistema** (`gb`, `gbc`, `gba`, `nds`, ...), igual que
  ya pasa hoy con la posición/tamaño de los controles (cada sistema
  tiene su propia configuración porque sus botones son distintos: NDS
  tiene X/Y, GB no tiene L/R). Un tema nunca mezcla sistemas.
- **v1 = presets + color**, no imágenes propias todavía. El creador de
  temas elige entre formas/estilos de botón predefinidos (los define la
  app, no el usuario) y personaliza colores de acento, fondo de
  "consola" y highlights. Esto es intencional: no requiere manejar
  subida/validación de imágenes ni moderación de contenido gráfico
  arbitrario en esta fase.
- **v2 (futura, no cubierta aquí en detalle)**: permitir que el usuario
  suba sus propias imágenes por botón/fondo (al estilo de un skin tipo
  DraStic). Cuando llegue ese momento, reutiliza el mismo patrón
  presign→PUT→registrar que ya usa `/api/saves/presign` (ver
  `api/romHackHubAccount.ts` en el repo de la app) -- el esquema de
  tema de abajo ya deja un lugar (`assets`) para eso sin romper v1.

## Modelo de datos: `Theme`

```jsonc
{
  "id": "thm_9f2a1c",
  "slug": "drastic-purple",
  "name": "DraStic morado",
  "system": "nds",                 // "gb" | "gbc" | "gba" | "nds" | ...
  "author": "wilbert",              // igual que "uploader" en /api/v1/files
  "createdAt": "2026-09-07T02:10:00Z",
  "updatedAt": "2026-09-07T02:10:00Z",
  "downloads": 128,
  "public": true,

  // -- v1: solo presets + color, sin assets propios --
  "palette": {
    "shellBackground": "#3a2a55",   // fondo de la "consola"
    "shellBorder": "#7a5cc2",       // borde/acento (hoy es SYSTEM_ACCENT fijo por sistema)
    "screenBezel": "#000000",
    "dpadColor": "#1c1424",
    "actionButtonColor": "#ffffff", // A/B/X/Y
    "shoulderButtonColor": "#5a4a7a" // L/R
  },
  "presets": {
    "dpad": "drastic-cross",         // id de un preset baked-in en la app
    "actionButtons": "drastic-round",
    "shoulderButtons": "drastic-pill"
  },

  // -- v2: reservado para imágenes propias por pieza, vacío en v1 --
  "assets": {
    "shellBackground": null,        // luego: {"downloadUrl": "...", "storedName": "..."}
    "dpad": null,
    "buttonA": null,
    "buttonB": null,
    "buttonX": null,
    "buttonY": null,
    "buttonL": null,
    "buttonR": null
  }
}
```

Notas:
- `presets` referencia IDs de presets que **vive en la app**, no en el
  servidor (ver "Catálogo de presets" abajo) -- el servidor solo
  guarda el string. Si la app agrega presets nuevos en una versión
  futura, temas viejos con presets desconocidos deben caer a un
  default sin tronar (la app hace ese fallback, no el servidor).
- `assets` va vacío/`null` en v1. Cuando exista v2, cada clave pasa a
  tener `{downloadUrl, storedName}` igual que ya hace `CloudSave` con
  `downloadUrl`.

## Endpoints necesarios

Mismo host/base que la API de cuenta ya existente
(`https://www.emulatornds.online`), mismo esquema de auth (`Authorization:
Bearer <token>`) para todo lo que escribe; lectura pública sin auth,
igual que `/api/v1/files`.

### Explorar temas públicos (sin auth)

```
GET /api/v1/themes?system=nds&q=drastic&sort=downloads&limit=20&offset=0
```
Respuesta:
```jsonc
{"themes": [Theme, ...], "pagination": {"limit": 20, "offset": 0, "total": 41, "hasMore": true}}
```
- `system` filtra por plataforma (mismos slugs que `/api/v1/platforms`).
- `sort`: `downloads` | `newest` (mínimo estos dos para v1).
- `q` busca por `name`/`author`, igual que `listFiles`.

### Ver un tema

```
GET /api/v1/themes/:id
```
→ `{"theme": Theme}`. Sin auth, cualquiera puede verlo si `public: true`.

### Crear un tema (auth)

```
POST /api/themes
Authorization: Bearer <token>
{
  "slug": "drastic-purple",
  "name": "DraStic morado",
  "system": "nds",
  "palette": { ...igual que arriba... },
  "presets": { ...igual que arriba... },
  "public": true
}
```
→ `{"theme": Theme}` con `id`/`author`/`createdAt` ya resueltos por el
servidor (el `author` sale del token, no lo manda el cliente).

### Actualizar un tema propio (auth)

```
PATCH /api/themes/:id
Authorization: Bearer <token>
{ ...campos a cambiar... }
```
Rechazar con 403 si el token no es el autor.

### Borrar un tema propio (auth)

```
DELETE /api/themes/:id
Authorization: Bearer <token>
```

### Descargar / aplicar un tema

No hay descarga de archivo binario en v1 (todo el tema es el JSON de
`GET /api/v1/themes/:id`) -- pero sí conviene un endpoint separado que
solo incrementa el contador, para que "descargar" en el listado público
y "aplicar sin guardar" en el propio no se mezclen en las métricas:

```
POST /api/v1/themes/:id/downloads
```
→ `204`, incrementa `downloads` en 1. Sin auth (es solo telemetría, no
gate de acceso).

### v2 (reservado, no implementar todavía): subir un asset de imagen

Mismo patrón que `uploadCloudSave`:
```
POST /api/themes/:id/assets/presign
Authorization: Bearer <token>
{"slot": "buttonA", "filename": "a.png", "fileSize": 12345, "contentType": "image/png"}
```
→ `{"uploadUrl": "...", "storedName": "..."}`, el cliente hace
`PUT uploadUrl` con los bytes, y luego:
```
POST /api/themes/:id/assets
{"slot": "buttonA", "storedName": "...", "originalName": "a.png"}
```
registra esa pieza en `assets.buttonA`. Cuando esto se construya,
definir también: tamaño máximo por imagen (sugerido 512KB, son
íconos), y si se permite solo PNG/WEBP o cualquier formato de imagen.

## Catálogo de presets (vive en la app, no en el servidor)

Para v1, la app trae baked-in un catálogo pequeño de presets por
pieza (ej. `dpad`: `default`, `drastic-cross`, `retro-square`;
`actionButtons`: `default`, `drastic-round`, `pill`). El servidor no
necesita saber qué dibuja cada preset, solo guardar el string y
devolverlo tal cual. Esto significa:
- Agregar un preset nuevo es un cambio solo de la app (nueva versión),
  no requiere tocar el backend.
- Un tema viejo apuntando a un preset que ya no existe debe
  renderizarse con un fallback razonable en el cliente, nunca fallar.

## Moderación y límites (a decidir por el equipo, no bloquea v1 técnico)

- ¿Hay revisión antes de que un tema aparezca en el listado público, o
  se publica al instante como los archivos de `/api/v1/files`?
- Límite de temas públicos por cuenta (evitar spam) -- sugerido: mismo
  criterio que ya usen para `/api/v1/files`.
- `report`/`hide` de un tema: no está en este documento, agregar si ya
  existe ese flujo para archivos y se quiere igual para temas.

## Qué falta del lado de la app (fuera de este documento)

Una vez el API exista:
1. Pantalla "Crear tema": elegir sistema, colores (palette) y presets,
   con preview en vivo reusando `GameControls`/`DsView` ya existentes.
2. Guardar/aplicar localmente (reusar el mecanismo de
   `getPreference`/`setPreference` que ya persiste `controlLayout_${system}`,
   agregando `theme_${system}`).
3. Pantalla "Explorar temas" (mismo patrón que `FilesScreen.tsx`):
   listar, filtrar por sistema, aplicar sin publicar nada propio.
4. Publicar el tema propio (solo si el usuario tiene sesión, reusa
   `romHackHubAccount.ts`).
