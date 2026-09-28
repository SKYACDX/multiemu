# API de la página de la app (multiemu) para emulatornds.online

Especificación para el backend de `emulatornds.online`: qué necesita
exponer para tener una página pública de la app (multiemu) con su
ícono, capturas, lista de funcionalidades y el APK para descargar --
mismo patrón que ya usan `/api/v1/files` (lectura pública) y
`/api/themes` (escritura con Bearer token + presign para subir
binarios), documentado en `docs/themes-api.md`.

A diferencia de temas o archivos, esto **no es una colección** -- hay
una sola app, con un historial de versiones. El modelo separa "ficha
de la app" (texto/metadata, cambia poco) de "release" (una versión
concreta, con su propio APK).

## Modelo de datos

### `AppListing` (la ficha, singular)

```jsonc
{
  "slug": "multiemu",
  "name": "multiemu",
  "tagline": "Game Boy, Game Boy Advance y Nintendo DS en un solo emulador",
  "description": "Texto largo (markdown permitido) para la página.",
  "features": [
    "Emulación de Game Boy / Game Boy Color (núcleo propio)",
    "Emulación de Game Boy Advance (mGBA)",
    "Emulación de Nintendo DS (melonDS, sin BIOS real -- FreeBIOS)",
    "Link local: 2 jugadores GBA por cable en el mismo dispositivo",
    "Guardado manual por slots y sincronización en la nube",
    "Cartucho GBA insertable en el slot-2 del DS (Pal Park / transferencia GBA)",
    "Portada automática y HackRoms/parches vía RomHack Hub",
    "Temas visuales personalizables y publicables"
  ],
  "iconUrl": null,       // ver assets abajo
  "screenshots": [],     // lista de URLs, ver assets abajo
  "updatedAt": "2026-09-07T00:00:00Z"
}
```

### `AppRelease` (una versión publicada)

```jsonc
{
  "id": "rel_9f2a1c",
  "version": "1.0.0",       // versionName
  "versionCode": 1,
  "changelog": "Primera versión pública.",
  "platform": "ANDROID",    // "ANDROID" | "WINDOWS" -- nuevo campo (2026-09-12)
  "minAndroidSdk": 24,       // null en releases WINDOWS
  "apkUrl": null,            // ver assets abajo -- es el .apk o el .exe según platform
  "apkSize": 0,
  "downloads": 0,
  "publishedAt": "2026-09-07T00:00:00Z"
}
```

**Nota para multiemu (Android): no cambia nada de este lado.** `platform`
es un campo nuevo y aditivo -- si no lo mandás en `POST /api/app/releases`
se asume `"android"` automáticamente, y `GET /api/v1/app` (el endpoint que
la app usa para chequear actualizaciones) sigue devolviendo únicamente la
última release **ANDROID** como `latestRelease`, aunque exista una release
`WINDOWS` más nueva. El build de escritorio (.exe) se publica por otra vía
y nunca aparece ahí.

## Endpoints

Mismo host/base y esquema de auth que ya existen (lectura pública sin
auth bajo `/api/v1`, escritura con `Authorization: Bearer <token>`
bajo `/api`).

### Leer la ficha (sin auth)
```
GET /api/v1/app
```
→ `{"listing": AppListing, "latestRelease": AppRelease}`

### Historial de versiones (sin auth)
```
GET /api/v1/app/releases?limit=20&offset=0&platform=android
```
→ `{"releases": AppRelease[], "pagination": {...}}` (mismo shape de
paginación que `/api/v1/files` y `/api/v1/themes`). `platform` es
opcional (`android` | `windows`); sin él devuelve ambas mezcladas
ordenadas por `versionCode`.

### Actualizar la ficha (auth, solo cuentas con permiso de equipo)
```
PUT /api/app
{ "tagline": "...", "description": "...", "features": ["..."] }
```
→ `{"listing": AppListing}`. Quién puede llamar esto es una decisión
de moderación del equipo (no de este documento) -- a diferencia de
temas, esto no es contenido de usuario, así que probablemente deba
requerir un rol especial en vez de "cualquier cuenta logueada".

### Publicar una versión nueva (auth, mismo permiso que arriba)
```
POST /api/app/releases
{ "version": "1.0.0", "versionCode": 1, "changelog": "...", "minAndroidSdk": 24 }
```
→ `{"release": AppRelease}` con `apkUrl: null` hasta que se suba el
APK (paso siguiente). `platform` es opcional, default `"android"` --
para publicar el build de escritorio se manda `"platform": "windows"`
y se omite `minAndroidSdk` (se rechaza con 400 si falta en un release
android, pero no se pide en uno windows):
```
POST /api/app/releases
{ "version": "1.0.0", "versionCode": 2, "changelog": "...", "platform": "windows" }
```
`versionCode` es una secuencia única global (compartida entre
android y windows) -- simplemente hay que seguir incrementándola,
no reiniciarla por plataforma.

### Contador de descargas del APK (sin auth, solo telemetría)
```
POST /api/v1/app/releases/:id/downloads
```
→ `204`.

## Subir binarios (ícono, capturas, APK)

Mismo patrón presign→PUT→registrar que `uploadCloudSave` ya usa
(`api/romHackHubAccount.ts`) y que el documento de temas reserva para
su v2:

```
POST /api/app/assets/presign
Authorization: Bearer <token>
{"slot": "icon", "filename": "icon-1024.png", "fileSize": 123456, "contentType": "image/png"}
```
→ `{"uploadUrl": "...", "storedName": "..."}`. El cliente hace
`PUT uploadUrl` con los bytes, y luego:
```
POST /api/app/assets
{"slot": "icon", "storedName": "...", "originalName": "icon-1024.png"}
```
registra esa pieza. `slot` es uno de: `icon`, `screenshot` (puede
repetirse, se acumulan en `screenshots[]`), o `apk:<releaseId>` (para
adjuntar el binario a una versión concreta vía `AppRelease.apkUrl` --
el mismo slot sirve para el `.exe` de un release `platform: "windows"`,
el nombre del slot no cambia aunque el archivo no sea un APK).

**Capturas por plataforma (2026-09-26):** `AppScreenshot` ahora tiene
su propio `platform` (`"android"` | `"windows"`, default `"android"`
si se omite) -- se manda en el registro, no en el presign:
```
POST /api/app/assets
{"slot": "screenshot", "storedName": "...", "originalName": "win1.png", "platform": "windows"}
```
Antes todas las capturas caían en un solo array compartido y se
mezclaban entre las pestañas Android/Windows de `/app` -- ahora
`AppListing.screenshotsByPlatform` (`{ANDROID: string[], WINDOWS:
string[]}`) las separa. El campo viejo `screenshots` (array plano con
todas mezcladas) se mantiene igual, por compatibilidad -- no hace
falta cambiar nada si algo ya lo lee.

Límites sugeridos: ícono ≤2MB (PNG, idealmente 1024x1024 ya
recortado con esquinas/círculo como los mipmaps de Android), captura
≤5MB cada una, APK sin límite fijo pero considerar que el
release build actual pesa ~70MB.

## Qué ya está listo del lado de la app (no requiere backend)

- **Ícono**: generado y aplicado (`app/android/app/src/main/res/mipmap-*`),
  además de copias en `app/store-assets/icon-1024.png` y
  `icon-512.png` listas para subir tal cual como `slot: "icon"`.
- **Lista de features**: la de `AppListing.features` arriba ya
  refleja lo implementado (no hay que redactarla desde cero).
- **Capturas**: pendiente -- se pueden generar en el emulador ahora
  mismo si se quiere adjuntarlas junto con el resto.

## Qué falta del lado de la app (una vez el API exista)

No hay UI en la app misma para esto (a diferencia de temas, esto lo
publica el equipo, no el usuario) -- solo hace falta un script/paso
manual una vez para: subir ícono + capturas + APK del release actual
usando los endpoints de arriba.
