# Aviso de actualización disponible

El backend de RomHack Hub ya expone todo lo necesario -- esto es
puramente trabajo de la app, ningún endpoint nuevo que pedir.

## Qué ya existe

`GET https://www.emulatornds.online/api/v1/app` (sin auth, mismo patrón
que `listHacks`/`getHack` en `app/src/api/romHackHub.ts`) devuelve:

```jsonc
{
  "listing": { ... },
  "latestRelease": {
    "id": "...",
    "version": "1.0",
    "versionCode": 1,
    "changelog": "...",
    "apkUrl": "https://...", // URL firmada, expira en minutos -- no guardarla, solo usarla al momento de descargar
    ...
  }
}
```

`versionCode` es el mismo campo que ya usa Android/Gradle
(`android.defaultConfig.versionCode`, hoy en `1`).

## Qué falta construir

1. **`getAppInfo()`** en `app/src/api/romHackHub.ts`, mismo estilo que
   `getHack()`: `GET /api/v1/app`, tipar la respuesta.
2. **Chequeo al abrir la app** (una vez por sesión, o cada N horas usando
   `getPreference`/`setPreference` de `RomLibraryNative.ts` para no golpear
   el endpoint en cada arranque -- guardar `lastUpdateCheckAt` y comparar):
   comparar `latestRelease.versionCode` contra el `versionCode` instalado
   (expuesto ya sea vía `DeviceInfo.getVersion()`/`getBuildNumber()` si
   `react-native-device-info` está disponible, o vía un valor nativo que
   se lea del lado Android -- revisar qué hay ya disponible antes de
   agregar una dependencia nueva).
3. **Banner o modal** si hay versión nueva: mostrar `changelog`, botón
   "Descargar" que abre `apkUrl` (o simplemente enlaza a
   `https://www.emulatornds.online/app`, que siempre tiene el link de
   descarga vigente -- más simple, evita lidiar con la expiración de la
   URL firmada si el usuario tarda en tocar el botón).
4. **"No mostrar de nuevo para esta versión"**: guardar el
   `versionCode` descartado con `setPreference('dismissedUpdateVersionCode', ...)`
   y no volver a mostrar el aviso para ese mismo `versionCode` (sí
   mostrarlo de nuevo si sale uno más nuevo).

## Nota

Instalar el APK descargado requiere permiso de "instalar apps
desconocidas" en Android (la app no está en Play Store) -- si no está ya
manejado en otro flujo, el botón de descarga debería al menos abrir el
navegador/gestor de descargas en vez de intentar instalar silenciosamente.
