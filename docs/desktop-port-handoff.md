# Port de escritorio (.exe): qué necesita para igualar al APK

Escrito el 2026-09-12 desde la sesión de Android, para una sesión nueva
que arranque el build de Windows. Todo lo de aquí está verificado en
dispositivo salvo donde diga lo contrario.

La app Android es React Native + tres núcleos nativos. La pregunta que
responde este documento no es "cómo se hace un emulador", sino **qué
partes son reutilizables tal cual, cuáles hay que rehacer, y qué trampas
ya pisamos** para que no se vuelvan a pisar.

---

## 1. Qué se reutiliza y qué no

| Pieza | Dónde | ¿Sirve en escritorio? |
|---|---|---|
| Núcleo GB/GBC (propio) | `core/gb` | **Sí, tal cual.** Es C++ independiente de plataforma a propósito; el JNI es una capa aparte (`gbcore/src/main/cpp/gameboy_jni.cpp`). |
| GBA | mGBA vendorizado, `third_party/mgba` | **Sí.** Sin modificar: su `git status` está limpio. |
| NDS | melonDS 1.1 vendorizado, `third_party/melonds` | **Sí, pero con parches.** Ver sección 2 — es la parte delicada. |
| Capa `Platform::` de melonDS | `dscore/src/main/cpp/ds_platform.cpp` | Parcialmente. La lógica (red, firmware) se traduce; el I/O y el log son de Android. melonDS trae su propia versión Qt de referencia. |
| UI, temas, cuenta, nube, HackRoms | `app/src/*.tsx`, `app/src/api/*` | Depende del stack que elijas. Ver sección 5. |
| Parcheadores IPS/UPS/BPS, CRC32 | `app/src/patchers/` | **Sí**, TypeScript puro sin dependencias de RN. |

---

## 2. melonDS: los parches son obligatorios, y no todos son de Android

`third_party/` está **gitignorado** y `third_party/melonds` es un clon con
su propio repo. Los cambios viven versionados como parche:

```bash
git clone --depth 1 --branch 1.1 https://github.com/melonDS-emu/melonDS.git third_party/melonds
git -C third_party/melonds am ../../patches/melonds/*.patch
```

Ver `docs/melonds-setup.md` para los flags de build por ABI.

### Los que SÍ necesitas en escritorio

- **VRAM con seguimiento de "sucio"** (`GPU3D_OpenGL.cpp`). Upstream
  resube ~700KB de texturas **por frame**, con un `// SUCKY!!! TODO`
  encima. Medido con simpleperf: era el mayor bloque de tiempo de driver
  del hilo de emulación (23.6%). El seguimiento ya existía en el core y
  solo lo usaba el renderer por software. Ganancia grande e independiente
  de plataforma.
- **Canal del punto de acceso** (`WifiAP.cpp`). Upstream clava melonAP en
  el canal 6 y descarta lo que la DS envíe desde otro. Pokémon Blanco
  escanea 1, 7 y 13: medido, 611 tramas rechazadas seguidas y el juego
  colgado indefinidamente. Ahora el AP sigue el canal de la DS. **Sin
  esto, una clase entera de juegos no conecta.**

### El que te va a morder si no lo lees

**El orden de canales del compositor** (`GPU_OpenGL_shaders.h`). Cambiamos
el swizzle final de `.bgr` (upstream) a `.rgb`. Eso es correcto **solo**
porque bliteamos la textura directo a una superficie RGBA8. Un frontend
que la *samplee* de forma normal (como el Qt de upstream) necesita el
`.bgr` original. Si tu `.exe` dibuja la salida como textura y ves los
azules en naranja, es esto. `ds_jni.cpp` (`nativeGetFramebuffer`) muestra
la compensación del otro lado.

### Los que probablemente no necesites

Portabilidad a GLES: `UnpackABGR1555` (GLES no tiene
`GL_UNSIGNED_SHORT_1_5_5_5_REV`) y `precision highp usampler2D`.
Inofensivos pero innecesarios en GL de escritorio. Los arreglos de
portabilidad a MSVC sí te sirven si compilas con Visual Studio.

### Trampa de build que costó un crash con corrupción de memoria

`NDS.h` tiene un **miembro de datos** detrás de `#ifdef JIT_ENABLED`, así
que `sizeof(NDS)` cambia según el define. Si el core se compila con
`ENABLE_JIT=ON` y tu frontend no repite `JIT_ENABLED`, tu
`make_unique<NDS>` reserva de menos y el constructor de `ARMJIT` pisa el
heap. Confirmado con ASan. **El define tiene que coincidir en ambos lados.**

---

## 3. Conexión a internet del DS (recién terminada)

Funciona, con Regalo Misterioso confirmado en Pokémon Blanco. En
escritorio lo tienes **más fácil** que nosotros: el frontend Qt de melonDS
ya trae todo esto hecho, así que puedes copiarlo en vez de reconstruirlo.

Lo que hicimos, por si te sirve el mapa:

1. Compilar `src/net/` (solo `Net.cpp`, `Net_Slirp.cpp`,
   `PacketDispatcher.cpp`) más el libslirp vendorizado. **No** uses el
   objetivo `net-utils` completo: arrastra `Net_PCap` (libpcap) y
   `LAN`/`Netplay`/`LocalMP` (ENet). En escritorio *sí* puedes querer
   Net_PCap (modo directo), que en Android era inviable.
2. Implementar `Platform::Net_SendPacket` / `Net_RecvPacket` sobre un
   `Net` con driver `Net_Slirp`. `Net::RecvPacket` ya bombea el driver.
3. **Persistir el firmware.** Esto es lo que hace que se configure una vez
   y todas las ROMs lo hereden: la configuración de CWF vive en el
   firmware de la consola, no en el cartucho. `Platform::WriteFirmware` se
   dispara justo cuando la pantalla de CWF de un juego guarda. Ojo: llega
   en ráfagas (6 llamadas idénticas por arranque), compara antes de
   escribir.

El servicio de Nintendo cerró en 2014: el usuario pone un DNS comunitario
a mano una vez (ver el changelog de la v1.8 para los pasos exactos).

---

## 4. Publicación: el `.exe` usa la misma API

`docs/app-listing-api.md` ya está actualizado con el campo `platform`
(2026-09-12). Lo esencial:

- `POST /api/app/releases` con `"platform": "windows"`, **omitiendo**
  `minAndroidSdk`.
- El slot de asset sigue llamándose `apk:<releaseId>` aunque subas un
  `.exe`. El nombre no cambió.
- **`versionCode` es una secuencia global compartida entre plataformas.**
  El más alto publicado hoy es **10** (v1.8 Android), así que el primer
  release de Windows debe ser **11**, no 1.
- `GET /api/v1/app` sigue devolviendo solo la última release de Android
  como `latestRelease`, así que publicar Windows no dispara el aviso de
  actualización de la app Android. Es a propósito.
- Token admin en `.secrets/romhackhub-admin-token.txt` (no expira, ver
  `docs/publishing.md`).

**Detalle a verificar con la sesión web:** hoy `GET /api/v1/app/releases`
devuelve `platform: null` en las releases existentes, no `"ANDROID"`. No
bloquea nada, pero conviene confirmar si el campo se expone en lectura
pública antes de depender de él para filtrar.

---

## 5. Funcionalidad que el APK tiene y el `.exe` debería igualar

Ordenado por cuánto trabajo propio implica, no por importancia.

**Reutilizable casi tal cual (lógica en TS/C++ sin RN):**

- Parcheadores IPS/UPS/BPS y CRC32 (`app/src/patchers/`)
- Guardados `.sav` por CRC32 de la ROM, y estados por slots
- Clientes de API de RomHack Hub (`app/src/api/`): cuenta, nube, temas,
  HackRoms, ficha de la app

**Hay que rehacer en el stack que elijas:**

- Emulación en pantalla y entrada (en escritorio: teclado y mando, no
  controles táctiles — buena parte de la complejidad de la app Android
  desaparece)
- Temas visuales y su editor
- Guardado en la nube con detección de conflictos
- Navegador de HackRoms y descarga
- Portada automática
- Comentarios con captura adjunta
- Aviso de actualización (`docs/update-check.md`)

**Específico de la DS, no lo pierdas:**

- Cartucho GBA en el slot-2 (transferencia estilo Pal Park)
- Internet / CWF (sección 3)
- Link local de GBA: en Android son dos jugadores en **un** dispositivo;
  en escritorio probablemente quieras otra cosa

---

## 6. Lecciones de rendimiento que valen en cualquier plataforma

Medidas en un Adreno 610, pero el razonamiento no es de Android:

- **No sincronices la emulación con el refresco de la pantalla.** Un frame
  de DS 3D costaba más de un intervalo de vsync, y un bucle atado a vsync
  solo puede empezar en un borde: 36ms de trabajo esperaban un tercer
  intervalo y clavaban el emulador en exactamente 60/3 = 20fps. Marcar el
  ritmo contra los 59.8237Hz propios de la DS lo subió a ~33fps sin tocar
  nada más.
- **Leer el framebuffer de vuelta a CPU es un stall.** `glReadPixels`
  síncrono serializa la CPU detrás de la GPU en cada frame. Con PBO
  asíncrono, y mejor aún dibujando directo a la superficie, desaparece.
- **Mide antes de optimizar.** Forzamos el inline de una función llamada
  98k veces por frame convencidos de que ayudaría: 12.19ms contra 12.21ms
  de baseline, puro ruido. Revertido. En cambio el problema real (la
  subida de VRAM por frame) no se parecía a un hotspot en el perfil plano.

Recorrido completo en el mismo escenario: **21fps → 58.7fps**.

---

## 7. Estado del repo

- `master`, remoto `SKYACDX/multiemu` (privado)
- `third_party/` gitignorado; melonDS parcheado vive en `patches/melonds/`
- El APK de release se firma con `app/android/app/multiemu-release.keystore`
  (gitignorado). **En Windows la firma es otro mundo**: un `.exe` sin
  firmar dispara SmartScreen, y un certificado de firma de código cuesta
  dinero. Decidirlo pronto, no al final.
