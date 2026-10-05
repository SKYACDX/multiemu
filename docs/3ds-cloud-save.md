# Guardado de 3DS en la nube: contrato con el .exe

Definido e implementado primero en `multiemu_exe` (`src/save3ds.js` y
`test/save3ds.test.js`, 2026-10-05). Android tiene que seguirlo al pie de la
letra para que los dos dispositivos vean la misma partida. En Android:
`N3dsCloudSave.kt` (con `N3dsCloudSaveTest`, que fija la huella de referencia)
y los flujos de guardado del juego de `App.tsx`.

## Qué se sube

- **Solo** la carpeta `data` del juego:
  `sdmc/Nintendo 3DS/<id0>/<id1>/title/<alto>/<bajo>/data/`. Sin extdata
  (v1); si algún día se añade, se coordina antes (otro slot o prefijo).
- Un zip determinista. Rutas **relativas a esa carpeta `data`**, con "/",
  sin id0/id1 ni "title/...": p. ej. `00000001.metadata`,
  `00000001/00000001.sav`. Una carpeta vacía va como entrada de longitud 0
  con "/" final.
- Al restaurar se escribe en el id0/id1 que exista en el dispositivo local.
  Al leer se rechazan rutas con `..`, absolutas o con letra de unidad.
- Los estados de 3DS **no** se sincronizan (pasan del límite de 20 MB del
  servidor).

## Clave

- `3ds:<programId>`, programId en **minúsculas**, 16 dígitos: alto (8) +
  bajo (8), p. ej. `3ds:00040000000ba900`.
- Leído del header NCCH: offset 0x118, 8 bytes little-endian. En .3ds/.cci
  la partición 0 empieza en `u32 @ 0x120 × 0x200`; un .cxi empieza con el
  NCCH. (No el CRC de la ROM: en 1-4 GB tarda segundos.)
- Slot **99**, nombre de archivo `game.zip`.

## Comparar sin depender de fechas

Por contenido, con una huella (no el CRC del zip, cuyos bytes dependen de
la herramienta y la zona horaria):

- CRC32 acumulado (zlib/IEEE) sobre cada entrada, ordenadas por nombre en
  bytes UTF-8, con: nombre, `0x00`, tamaño en decimal ASCII, `0x00`, bytes
  del contenido. Si el contenido mide 0 no se hashea.
- Las carpetas solo cuentan si están vacías.
- Referencia: `{"00000001/00000001.sav": [1,2,3,4], "empty/": vacía}` da
  **2018605636**.
- "Sin partida": el árbol no tiene ningún archivo salvo `*.metadata`
  (Azahar crea un `00000001.metadata` de 1 KB al arrancar el juego por
  primera vez). Cuenta como vacío: nunca se sube ni se compara.

## Flujo

Antes de abrir el núcleo:

- sin datos locales y con nube: "¿Descargarlo?" (Descargar / No);
- ambos existen y difieren: La nube / Este equipo / Más tarde (cerrar el
  diálogo = Más tarde). Elegir la nube hace copia de seguridad del guardado
  local antes de reemplazarlo.

Subida automática cada 45 s solo si cambió y ningún archivo se tocó en los
últimos 5 s (el núcleo escribe directo), y al salir del juego.

## En Android

La carpeta vive en `filesDir/3ds/Azahar/sdmc/...` (ver `N3dsView.loadRomPath`).
El modelo emulado (Old 3DS por defecto en Android) no cambia `data`.
