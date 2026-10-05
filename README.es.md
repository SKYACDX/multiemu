# multiemu

[English](README.md) · **Español**

[![Licencia: GPL v3+](https://img.shields.io/badge/licencia-GPL--3.0--or--later-blue.svg)](LICENSE)
![Android 9+](https://img.shields.io/badge/Android-9%2B-3ddc84.svg)

**multiemu es un emulador libre y de código abierto para Android que reúne Game Boy, Game Boy Color, Game Boy Advance, Nintendo DS y Nintendo 3DS en una sola app.**

- **Sistemas:** Game Boy / Game Boy Color, Game Boy Advance, Nintendo DS, Nintendo 3DS.
- **Guardados en la nube:** con una cuenta gratuita de RomHack Hub, el guardado de tus juegos de GBA, DS y 3DS se sincroniza solo entre el teléfono y la app de Windows; los estados se suben y bajan por espacio.
- **Inalámbrica de 3DS por internet:** entra a una de las salas del servidor del proyecto y la inalámbrica local de un juego de 3DS (intercambios, combates) ve a las demás consolas de esa sala, de teléfono a teléfono o de teléfono a PC.
- **Núcleo de Game Boy propio:** GB/GBC corren en un núcleo escrito desde cero para este proyecto (`core/gb`); GBA, DS y 3DS usan mGBA, melonDS y Azahar.
- Estados de guardado con espacio automático, controles en pantalla que se pueden mover y redimensionar, temas de consola, velocidad ×1 a ×3.

**Descarga:** <https://www.emulatornds.online/app> — Android 9 o superior (3DS necesita un teléfono ARM de 64 bits). La app avisa sola cuando hay una versión nueva.

> multiemu **no** incluye ningún juego, BIOS ni firmware, ni lo hará nunca. Usa copias de juegos que tengas.

## Capturas

<p>
  <img src="fastlane/metadata/android/en-US/images/phoneScreenshots/1.png" width="200" alt="Juego de Nintendo DS en vertical">
  <img src="fastlane/metadata/android/en-US/images/phoneScreenshots/2.png" width="200" alt="Espacios de guardado con subida y bajada a la nube">
  <img src="fastlane/metadata/android/en-US/images/phoneScreenshots/3.png" width="200" alt="Juego de Game Boy Color">
  <img src="fastlane/metadata/android/en-US/images/phoneScreenshots/5.png" width="200" alt="Menú de pausa">
</p>
<p>
  <img src="fastlane/metadata/android/en-US/images/phoneScreenshots/6.png" width="600" alt="Juego de Nintendo DS en horizontal">
</p>

Los juegos que se ven son homebrew libres, no juegos de Nintendo: [µCity](https://github.com/AntonioND/ucity) (GBC, GPLv3+, arte CC BY-SA 4.0) y [µCity Advance](https://codeberg.org/SkyLyrac/ucity-advance) (GBA, GPL-3.0, arte CC BY-NC-SA 4.0) de Antonio Niño Díaz, y [Space Impakto DS](https://github.com/AntonioND/SpaceImpakto-DS) de Richard Eric M. Lope (MIT). Ninguno viene incluido en la app.

## Verificar el APK

Todas las versiones desde la 1.14 se firman solo con este certificado (APK Signature Scheme v3):

```
SHA-256: 36:6b:da:3a:15:d1:63:2c:da:04:64:e8:4a:b3:af:4d:2c:a9:b6:6c:e7:ae:5f:b0:58:5b:92:19:5b:5e:b4:41
```

Compruébalo en un APK descargado con `apksigner`, de las build-tools del Android SDK:

```bash
apksigner verify --print-certs multiemu-1.16.apk
```

La línea `Signer #1 certificate SHA-256 digest:` debe decir `366bda3a15d1632cda0464e84ab3af4d2ca9b66ce7ae5fb0585b92195b5eb441`. En el teléfono, apps como [AppVerifier](https://github.com/soupslurpr/AppVerifier) muestran la misma huella de una app instalada.

La clave de firma se cambió en octubre de 2026 (ver [docs/signing.md](docs/signing.md)). La nueva lleva una prueba firmada de que sustituye a la anterior (`ee73fd3b…`), así que Android 9+ la instala como actualización sin desinstalar. Android 7 y 8 se quedan en la 1.13.

## Compilar desde el código

Hace falta Node.js 22.11+, JDK 17, el Android SDK (compile SDK 37) con el NDK `29.0.14206865`, CMake 3.25+ y Ninja.

1. Dependencias de JavaScript:
   ```bash
   cd app && npm ci
   ```
2. Núcleos nativos. `third_party/` no se versiona: cada núcleo se clona en un tag fijo, se le aplican nuestros parches de `patches/` y se compila una vez fuera de Gradle:
   - mGBA 0.10.5 — [docs/mgba-setup.md](docs/mgba-setup.md)
   - melonDS 1.1 + `patches/melonds` — [docs/melonds-setup.md](docs/melonds-setup.md)
   - Azahar 2126.1.2 + `patches/azahar` — ver la cabecera de [`app/android/n3dscore/build-azahar.cmd`](app/android/n3dscore/build-azahar.cmd)
3. La app:
   ```bash
   cd app/android
   ./gradlew assembleRelease   # APK de release sin firmar
   ./gradlew assembleDev       # la misma app como com.multiemuapp.dev, firmada con la clave de debug; se instala al lado de la real
   ```

Más notas técnicas en [`docs/`](docs/) (mapa de memoria, contrato del guardado en la nube, comprobación de actualizaciones, publicación).

### El núcleo de Game Boy

Tests del núcleo:

```bash
cmake -S core/gb -B core/gb/build
cmake --build core/gb/build
ctest --test-dir core/gb/build --output-on-failure
```

Para probar el pipeline sin ninguna ROM comercial, `core/gb/tools/gen_test_rom.cpp` genera una ROM mínima escrita a mano en código máquina de Game Boy que dibuja franjas verticales, y `dump_frame` la corre hasta el primer VBlank y vuelca el framebuffer a un BMP:

```bash
./core/gb/build/gen_test_rom test_rom.gb
./core/gb/build/dump_frame test_rom.gb frame.bmp
```

Si el pipeline (CPU + bus + VRAM/OAM + PPU) funciona, `frame.bmp` muestra 20 franjas de 8 px alternando blanco y negro.

## Créditos

multiemu se apoya en [melonDS](https://github.com/melonDS-emu/melonDS) (DS), [mGBA](https://github.com/mgba-emu/mgba) (GBA), [Azahar](https://github.com/azahar-emu/azahar) (3DS) y [React Native](https://github.com/facebook/react-native). Sus licencias y nuestros parches están en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Reportar un problema

- [Abre un issue](https://github.com/SKYACDX/multiemu/issues/new/choose): hay plantillas para errores y para peticiones. Incluye la versión de la app (Ajustes de Android → Aplicaciones → multiemu), el modelo del teléfono y la versión de Android.
- O usa **Comentarios** en la pantalla de inicio de la app: llega directo a los desarrolladores, con captura opcional.
- Problemas de seguridad: no los publiques; usa *Report a vulnerability* en la pestaña Security de GitHub.

Las contribuciones son bienvenidas; ver [CONTRIBUTING.md](CONTRIBUTING.md).

## Requisitos legales

- La app **nunca** incluye BIOS, firmware ni ROMs de Nintendo. Cada quien los vuelca legalmente desde su propio hardware.
- No se distribuyen ROMs.

## Licencia

multiemu es software libre bajo la [GNU GPL v3 o posterior](LICENSE). Los emuladores que incluye conservan sus propias licencias; ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
