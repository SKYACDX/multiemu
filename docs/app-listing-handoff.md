# Paquete de publicación: multiemu

Todo lo necesario para publicar la página de la app en
`emulatornds.online`, listo para copiar/pegar contra los endpoints de
`docs/app-listing-api.md`. No requiere redactar nada nuevo -- solo
llamar la API con estos payloads y subir los archivos indicados.

## 1. Ficha de la app (`PUT /api/app`)

```json
{
  "slug": "multiemu",
  "name": "multiemu",
  "tagline": "Game Boy, Game Boy Advance y Nintendo DS en un solo emulador",
  "description": "multiemu es un emulador para Android que junta Game Boy, Game Boy Color, Game Boy Advance y Nintendo DS en una sola app, con una interfaz pensada para jugar cómodo desde el celular.\n\nGB y GBA corren sobre núcleos ya maduros (uno propio para GB/GBC, mGBA para GBA); NDS corre sobre melonDS sin necesitar ningún archivo de BIOS real -- arranca directo al juego usando el firmware de código abierto del propio proyecto.\n\nLo que la distingue de un emulador genérico:\n\n- **Transferencia estilo Pal Park**: inserta un cartucho de GBA en el slot-2 mientras juegas Diamante, Perla, Platino, HeartGold o SoulSilver, exactamente como en el hardware real -- útil para migrar Pokémon de la 3ra generación.\n- **Temas personalizables**: cambia colores y formas de cada botón, guárdalos en tu dispositivo o publícalos para que otros los descarguen.\n- **Controles a tu medida**: arrastra cualquier grupo de botones a donde te acomode y ajusta el tamaño de las pantallas.\n- **Guardado en la nube**: sincroniza tu partida entre dispositivos, con detección de conflictos si el guardado local y el de la nube no coinciden.\n- **HackRoms y portadas**: busca parches y archivos públicos por juego, con portada automática cuando existe.\n- **Link local**: dos jugadores de GBA por cable, en el mismo dispositivo.\n\nRequiere Android 7.0 o superior. No incluye ni distribuye ROMs -- cada quien usa sus propias copias legales.",
  "features": [
    "Emulación de Game Boy / Game Boy Color (núcleo propio)",
    "Emulación de Game Boy Advance (mGBA)",
    "Emulación de Nintendo DS (melonDS, sin BIOS real -- FreeBIOS)",
    "Transferencia estilo Pal Park: cartucho GBA insertable en el slot-2 del DS",
    "Guardado manual por slots y sincronización en la nube",
    "Temas visuales personalizables, con editor propio y publicación pública",
    "Controles arrastrables y tamaño de pantalla ajustable",
    "Portada automática y búsqueda de HackRoms/archivos vía RomHack Hub",
    "Link local: 2 jugadores de GBA por cable en el mismo dispositivo"
  ]
}
```

## 2. Release publicado (`POST /api/app/releases`)

```json
{
  "version": "1.0",
  "versionCode": 1,
  "changelog": "Primera versión pública: GB/GBC, GBA y NDS, temas personalizables, transferencia por cartucho GBA (Pal Park), guardado en la nube y HackRoms.",
  "minAndroidSdk": 24
}
```

Después de crear el release, subir el APK con `slot: "apk:<releaseId>"`
siguiendo el paso de presign de `docs/app-listing-api.md`.

## 3. Archivos a subir

Todos ya están en el repo, listos tal cual:

| Slot | Archivo |
|---|---|
| `icon` | `app/store-assets/icon-1024.png` (también hay `icon-512.png` si el sistema prefiere ese tamaño) |
| `screenshot` (x8) | `app/store-assets/screenshots/01-home.png` a `08-hub-menu.png`, en ese orden |
| `apk:<releaseId>` | `app/android/app/build/outputs/apk/release/app-release.apk` |

## 4. Datos del APK

- `applicationId`: `com.multiemuapp`
- `versionName`: `1.0` / `versionCode`: `1`
- Firmado con el keystore de debug del proyecto (válido para instalar
  directo, **no** para publicarlo en Play Store -- para eso hace falta
  generar un keystore de release propio más adelante).
- No depende de Metro ni de ningún servidor de desarrollo: el JS ya
  viene empaquetado adentro, funciona standalone en cualquier
  dispositivo Android 7.0+.
