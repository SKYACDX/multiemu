# Traer una partida de otro emulador (plan)

Estado: **aprobado por el usuario el 2026-10-05.** Orden: primero los errores de recarga (DS, GB) y la clave de nube del DS; después el normalizador y la interfaz de importar y exportar. Afecta a Android (`D:\Projects\multiemu`) y a escritorio (`D:\Projects\multiemu_exe`); la lógica de conversión tiene que ser idéntica en los dos.

## Qué hay hoy

| | Dónde vive el guardado | Importar | Nube |
|---|---|---|---|
| GB/GBC | Android `filesDir/saves/<crc32>.sav`; PC `.sav` junto a la ROM | No hay | Android **no**; PC sí (`gb:<crc32>`) |
| GBA | igual | No hay | `gba:<crc32>` en los dos |
| DS | Android `saves/<nombre-tamaño>.sav` (o `<crc32>` si se abrió desde la carpeta); PC `.sav` junto a la ROM | No hay | Android `nds:<nombre-tamaño>`, PC `nds:<crc32>`: **no coinciden** |
| 3DS | carpeta `sdmc/Nintendo 3DS/<id0>/<id1>/title/<alto>/<bajo>/data/`, sin extdata | No hay | `3ds:<programId>`, zip de `data/` |

En PC, poner un `.sav` crudo con el nombre de la ROM al lado ya funciona como importación. En Android no hay manera.

## Qué formatos traen los usuarios

| Sistema | Origen | Archivo | Qué hay que hacer |
|---|---|---|---|
| GB/GBC | mGBA, VBA-M, SameBoy, Gambatte, BGB, Pizza Boy, RetroArch/Lemuroid | `.sav`, `.srm` (crudo) | Aceptar tamaños distintos al de la RAM del cartucho (hoy MBC1/MBC5 exigen el tamaño exacto y si no **lo ignoran en silencio**). Pie de RTC de MBC3 de 48 o 44 bytes (ya soportado). |
| GBA | mGBA, VBA-M, My Boy!, Pizza Boy GBA, RetroArch (mGBA/gpSP) | `.sav`, `.srm` | mGBA ya detecta el tipo, rellena y lee el pie de RTC de 16 bytes. Comprobar el `.srm` de los núcleos VBA de RetroArch, que usa una disposición combinada (EEPROM + flash) y habría que recortarla. |
| DS | melonDS, DeSmuME, DraStic, NO$GBA, RetroArch | `.sav`, `.dsv`, `.srm` | Quitar el pie de 122 bytes de DeSmuME/DraStic (`.dsv`) en lugar de depender del recorte. Detectar el `.sav` comprimido de NO$GBA (cabecera `NocashGbaBackupMediaSavDataFile`) y descomprimirlo o rechazarlo con un mensaje claro. Ojo: para juegos que melonDS no conoce (hacks con código propio) el tamaño por defecto es EEPROM 64K, y un guardado más grande se cortaría. |
| 3DS | Citra, Lime3DS, Azahar (PC y Android), Mandarine; consola real con Checkpoint o JKSM | carpeta o zip | Dos formas: la carpeta `data/` de un emulador (con `00000001/…`), o el contenido del archivo de guardado que exporta Checkpoint (por ejemplo `main`), que hay que colocar dentro de `data/00000001/`. Extdata no se soporta todavía; se avisa si el zip la trae. |

## Lo que hay que construir

1. **Normalizador compartido**, con la misma especificación en Kotlin (Android) y en JS (escritorio). Recibe un archivo y el sistema, y devuelve los bytes que espera el núcleo o un error legible. Con tests de archivos sintéticos: pie `.dsv`, pies de RTC, tamaños cortos y largos, `.srm` combinado, NO$GBA, y zips de 3DS en las dos formas (Citra y Checkpoint) más rutas maliciosas (`..`, absolutas).
2. **«Importar guardado» y «Exportar guardado»** en el menú Guardado, para todos los sistemas (GB incluido). Al importar: se elige el archivo, se convierte, se hace copia del guardado actual (`save-backups/`), se escribe, se **reinicia el núcleo de verdad** y se avisa qué pasó. Exportar sirve para la prueba de ida y vuelta y para que nadie quede atrapado en multiemu.
3. **Escritorio:** el mismo normalizador al abrir un `.sav`, `.dsv` o `.srm` junto a la ROM, y un «Importar» para 3DS.

## Especificación del normalizador (v1)

La misma en Kotlin y en JS. Entrada: los bytes del archivo y el destino (`gb`, `gba`, `nds` o `nds-slot2`, el cartucho de GBA dentro del DS). La extensión del archivo no decide nada: solo sirve para el mensaje. Salida: los bytes que se escriben como `.sav` y una nota corta para el usuario, o un error legible. No se interpreta nada más allá de quitar envolturas.

| Destino | Tamaños válidos de los datos | Envolturas que se quitan |
|---|---|---|
| `gb` | 512, 2K, 8K, 32K, 64K, 128K | Ninguna: un pie de RTC de 44 o 48 bytes detrás de esos tamaños se deja, porque `core/gb` lo lee en MBC3. |
| `gba` | 512, 8K, 32K, 64K, 128K | El pie de RTC de 16 bytes de mGBA se deja (mGBA lo lee). Un `.srm` combinado de 0x22000 bytes (núcleos VBA de RetroArch) se convierte: si los primeros 0x20000 no son todos 0xFF, esos (SRAM/flash); si lo son, los últimos 0x2000 (EEPROM). *Hay que confirmarlo con un archivo real.* |
| `nds` | 512, 8K, 32K, 64K, 128K, 256K, 512K, 1M, 2M, 4M, 8M, 16M, 32M | `.dsv` de DeSmuME y DraStic: si los últimos 16 bytes son `\|-DESMUME SAVE-\|`, se quitan los últimos 122 (el pie). NO$GBA: si empieza por `NocashGbaBackupMediaSavDataFile`, sin compresión (u32 en 0x44 = 0) los datos van desde 0x4C; con compresión, error (v1). |
| `nds-slot2` | 512, 8K, 32K, 64K, 128K, y 128K+16 | Se quita un pie de RTC de 16 bytes salvo en 128K+16, el único tamaño con pie que melonDS acepta. |

- El tamaño se comprueba **después** de quitar la envoltura. Para `gb` y `gba` se admiten además los pies citados (+44, +48 en GB; +16 en GBA). Cualquier otro tamaño da error.
- Un archivo todo a 0xFF o todo a 0x00 se acepta, pero la nota avisa de que parece vacío.
- `core/gb` (compartido) deja de ignorar en silencio un guardado de tamaño distinto en MBC1/MBC5: copia lo que quepa y rellena el resto con 0xFF, como ya hace MBC3. Este cambio necesita el visto bueno de escritorio.
- Errores (texto para el usuario):
  - «Ese archivo no tiene el tamaño de un guardado de <sistema> (<n> bytes).»
  - «Es un guardado comprimido de NO$GBA. En NO$GBA, guárdalo sin compresión e inténtalo de nuevo.»
  - «Ese archivo está vacío.»
- Notas:
  - «Convertido desde DeSmuME/DraStic.»
  - «Convertido desde NO$GBA.»
  - «Convertido desde RetroArch (VBA).»
  - «Se quitó el reloj del cartucho (el DS no lo usa).»
- Tests: un archivo sintético por fila y por error, con los mismos vectores en Kotlin y JS (Android: `SaveNormalizerTest.kt`).
- Ojo con `nds-slot2`: el cartucho de GBA dentro del DS usa **el mismo** `.sav` que ese juego en mGBA. Si se le quita el reloj al meterlo en melonDS, melonDS reescribe el archivo entero sin él y mGBA lo pierde, aunque lo vuelve a escribir en el siguiente guardado. Para no tocarlo, se recorta solo en memoria y el archivo no se reescribe hasta que el juego guarda.
- Zips en Kotlin: `ZipInputStream` se fía del tamaño de la cabecera local, así que hay que comprobar también el tamaño y el CRC32 de cada entrada después de descomprimirla, como hace escritorio (863fb1f).

## Errores a arreglar antes (o la importación fallará igual)

- **DS (Android):** recargar la misma ROM conserva la sesión de melonDS (`DsView.adoptOrLoad` con la misma clave). Un guardado descargado de la nube o importado se queda en disco, pero el núcleo sigue con la memoria vieja y lo pisa en el siguiente guardado del juego. Probablemente ya afecta a la descarga desde la nube del DS: hay que confirmarlo con una prueba.
- **GB (Android):** `GameBoyView.loadRom` escribe la RAM actual en disco antes de cargar, así que importar y recargar el mismo juego pierde lo importado.
- **Clave de nube del DS:** Android usa `nds:<nombre-tamaño>` y escritorio `nds:<crc32>`, así que la nube del DS no cruza entre los dos. Además, Android crea dos guardados distintos para el mismo juego según cómo se abrió. Propuesta: pasar Android a `<crc32>` como escritorio, migrando el archivo local y buscando la clave vieja en la nube durante una temporada.
- **Escrituras no atómicas:** GB (`writeBytes`) y melonDS (`fopen "wb"`) pueden dejar el guardado a medias si la app muere escribiendo. Pasar a `.tmp` y renombrar.
- **Paridad:** GB en Android no tiene nube y en escritorio sí.

## Cómo lo verificamos

Para cada sistema y cada emulador de origen, la prueba de ida y vuelta:

1. Crear o tomar una partida en el emulador de origen.
2. Importarla en multiemu (Android y PC) y comprobar que el juego muestra el mismo progreso.
3. Guardar dentro del juego, exportar, y abrir la exportación en el emulador de origen: tiene que cargar con el progreso nuevo.

Material de prueba:
- Homebrew libres que guardan: µCity (GBC), µCity Advance (GBA) y Space Impakto DS (si guarda récords; hay que comprobarlo). Para 3DS no hay homebrew en `.3ds`, así que se usan los juegos propios del usuario.
- Partidas reales del usuario de otros emuladores, si las tiene.
- Emuladores gratuitos para generar archivos: mGBA, VBA-M, SameBoy, melonDS, DeSmuME y Azahar en PC; RetroArch o Lemuroid y Azahar en Android.

La matriz de resultados (sistema × origen × archivo → resultado) se guarda en este documento cuando se haga.

## Notas de la sesión de escritorio (revisión del plan)

- Clave del DS en escritorio: `nds:<crc32 de la ROM entera>`, en hex sin rellenar. Si Android añade nube de GB, un `.gbc` va como `gb:<crc32>` (no `gbc:`), igual que en escritorio.
- Slot-2 del DS (cartucho de GBA): melonDS solo acepta 512 B, 8K, 32K, 64K y 128K, y como excepción 128K+16 (el pie de RTC de mGBA). Un guardado con reloj de otro tamaño (por ejemplo 8K+16) da «BAD GBA SAVE LENGTH». En el camino del slot-2, el normalizador quita el pie de RTC salvo en 128K+16; en el camino de mGBA no hace falta.
- Modelo para recargar: escritorio cierra el núcleo **antes** de escribir el archivo y luego reabre el juego (`bringGameSave`). Importar tiene que hacer lo mismo en las dos apps; en Windows es obligatorio, porque mGBA tiene el `.sav` abierto.
- Los tamaños estrictos de MBC1/MBC5 son del núcleo `core/gb`, compartido: arreglarlo ahí sirve para los dos.
- 3DS en escritorio: ya importa un zip estilo Citra/Azahar con comprobación de rutas, límite de 256 MB y copia de respaldo. Falta el formato de Checkpoint y el aviso de extdata.
- Escrituras atómicas en escritorio: `.sav` y estados ya usan archivo temporal; falta revisar `WriteNDSSave` de melonDS.

## Requisitos de seguridad (sesión de seguridad)

Valen para Android y escritorio. Seguridad revisa el código antes del push.

- **Zips de 3DS:**
  - Los límites se aplican mientras se descomprime, no según la cabecera: tope total, tope por entrada, número máximo de entradas y relación de compresión máxima.
  - Se rechazan enlaces simbólicos y entradas que no sean archivos, nombres duplicados (sin distinguir mayúsculas), nombres reservados de Windows y caracteres no válidos.
  - Contra zip slip se valida la ruta ya resuelta, que tiene que quedar dentro del destino.
  - Se extrae a una carpeta temporal, se valida y solo entonces se mueve. Si algo falla, el guardado actual no se toca.
- **Longitud y CRC de cada entrada (lección de escritorio, 1f8f01a):** se cuentan los bytes reales al descomprimir y se exige que la longitud final y el CRC32 coincidan con los de la cabecera. Un zip que declara 1 KB y trae 300 MB no puede colarse truncado sin aviso. Los nombres reservados de Windows, `:` y los duplicados sin distinguir mayúsculas se rechazan también en Android, porque un zip importado aquí puede acabar en la nube y bajarse en Windows.
- **Archivos sueltos:** solo se aceptan los tamaños válidos para ese sistema o tipo de memoria (contando el pie de `.dsv`). El contenido nunca se interpreta más allá de copiarlo a la memoria de guardado.
- **Superficie:**
  - Android: SAF (`ACTION_OPEN_DOCUMENT` / `CREATE_DOCUMENT`), sin permisos amplios de almacenamiento, y copia a almacenamiento privado antes de procesar.
  - Escritorio: el diálogo se abre en el proceso main y el renderer solo recibe el resultado por IPC; nada de un «leer archivo por ruta» genérico.
  - No se envían rutas ni nombres de archivos importados a ningún sitio.
- **Nube:** importar no sube ni sobrescribe la nube sin confirmación explícita. Si se sube, primero se hace copia de la versión de la nube.
- **Escrituras atómicas:** `.tmp` + fsync + rename (en Windows, reemplazando el destino), y una sola copia `.bak` rotada.
- **Tests:** zip slip (`..`, absolutas, con unidad, symlink), zip bomb, demasiadas entradas, tamaños inválidos y fallo a mitad de importación con el original intacto.

## A quién afecta

- **Escritorio** (multiemu_exe): normalizador, clave de nube del DS si se unifica, «Importar» para 3DS.
- **Web** (RomHack Hub), respuesta de esa sesión: no hay endpoint para renombrar claves, pero la migración del DS se puede hacer entera en el cliente (descargar la vieja, subir con la nueva y borrar la vieja). Cuidado: `POST /api/saves` sobrescribe sin avisar si la clave+slot ya existe, así que hay que mirar antes y comparar, para no pisar la que subió Windows. Si hiciera falta, un `PATCH /api/saves/:id {gameKey}` serían unas 15 líneas, con el OK del usuario. Subir un guardado desde la web es viable: la web calcularía el CRC32 de la ROM en el navegador, sin subirla, o el program ID para 3DS. Ojo: el perfil público `/u/<usuario>` lista las claves en bruto, y hoy las del DS muestran el nombre del archivo de la ROM; pasar a crc32 lo evita.
- **Seguridad:** se abren archivos que elige el usuario (es una frontera de confianza): límites de tamaño, rutas en los zips, no ejecutar nada.
