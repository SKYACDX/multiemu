# Roadmap del núcleo de Game Boy

Orden recomendado de implementación, cada uno testeable de forma aislada
antes de pasar al siguiente:

1. **CPU (SM83)** — `core/gb/include/gb/cpu.h`, `core/gb/src/cpu.cpp`.
   Estado: loads, ALU 8-bit, saltos, CALL/RET, PUSH/POP y rotaciones de A
   implementados y testeados contra un `FlatBus` de RAM. Pendiente: tabla
   0xCB (bit ops), DAA, y el retraso de un ciclo de EI.

2. **Cartucho / mappers** — `core/gb/src/cartridge.cpp`. Implementados:
   `RomOnlyCartridge` y `Mbc1Cartridge` (enable de RAM, bank switching de
   ROM y RAM, ambos modos). Pendiente: `Mbc3Cartridge` (+RTC), `Mbc5Cartridge`.
   Ver `docs/memory_map.md`.

3. **Bus real** — `core/gb/src/system_bus.cpp`. WRAM (con echo),
   HRAM, cartucho e IE/IF conectados. VRAM/OAM/resto de I-O son stubs
   (leen 0xFF, ignoran writes) hasta que exista la PPU/timer/joypad.

4. **Interrupciones** — `Cpu::serviceInterrupt()` (en `cpu.cpp`) chequea
   IE&IF&IME al inicio de cada `step()`; despierta de HALT con solo IE&IF
   (sin importar IME), y despacha (push PC, salta al vector, limpia IME y
   el bit de IF) cuando IME también está activo. Pendiente: el retraso de
   un ciclo en el efecto de EI.

5. **Timers** — `Timer` (`timer.h`/`timer.cpp`): DIV/TIMA/TMA/TAC
   implementados con un modelo de umbral por t-cycles (no cycle-accurate
   frente al detector de flanco real, pero correcto para la gran mayoría
   de juegos). `SystemBus::tick()` y `GameBoy::step()` ya lo mantienen
   sincronizado con la CPU.

6. **PPU** — `ppu.h`/`ppu.cpp`. Implementado: máquina de modos 2/3/0/1 con
   los timings estándar (80/172/204/456 t-cycles), LY/LYC/STAT con sus
   interrupciones, renderizado de background+window por tile (con scroll,
   selección de mapa/datos de tile), sprites de 8x8 y 8x16 (flip
   horizontal/vertical, prioridad OBJ-vs-BG, hasta 10 por línea con el
   orden de prioridad real por X/índice OAM), y DMA de OAM instantáneo
   (0xFF46, no bloquea CPU como en hardware real). Modelo "renderiza la
   línea completa al terminar el modo 3", no ciclo-a-ciclo: no reproduce
   trucos de raster a mitad de línea. Pendiente: modos CGB (paletas por
   tile, VRAM bank 1, prioridad BG-a-nivel-de-tile).

7. **Joypad** — `joypad.h`/`joypad.cpp`. Implementado: P1/JOYP con
   selección de grupo (direccionales/botones), lectura activa-baja, e
   interrupción en flanco de presión del grupo actualmente seleccionado.
   `GameBoy::setButtonPressed()` es el punto de entrada para la capa de
   plataforma.

8. **APU (audio)** — se puede posponer sin bloquear tener un emulador
   jugable (silencioso) mientras se valida CPU+PPU+input.

9. **Bindings nativos**
   - **Android**: hecho — `android/gbcore/src/main/cpp/gameboy_jni.cpp`
     (puente delgado, sin lógica propia) + `GameBoyNative.kt` (wrapper
     Kotlin: `load()`, `runFrame()`, `framebuffer: IntArray` ya en
     ARGB_8888, `setButtonPressed()`). Compilado y verificado
     cross-compilando `libgbjni.so` para arm64-v8a con el NDK standalone
     (sin proyecto Gradle todavía — ver `android/README.md`); los 5
     símbolos JNI se confirmaron exportados con `llvm-nm`.
   - **iOS**: pendiente — wrapper Objective-C++ que exponga el mismo
     framebuffer a Metal/UIImage.

   Nota para cuando se cree el proyecto Gradle real: gbcore/CMakeLists.txt
   ya está preparado para eso (`if(CMAKE_PROJECT_NAME STREQUAL PROJECT_NAME)`
   evita construir tests/tools del host al ser incluido como subdirectorio).

10. **App React Native** — pantalla de selección de ROM, renderizado del
    framebuffer (vía `<Image>` desde base64 al inicio, luego una vista
    nativa dedicada por rendimiento), mapeo de controles táctiles.

## GBA — hecho vía mGBA (no un core propio)

Escribir un segundo core CPU-accurate desde cero (ARM7TDMI, más una PPU
bastante más compleja que la del GB) se descartó por alcance. En vez de
eso, `app/android/gbacore/` vendoriza [mGBA](https://github.com/mgba-emu/mgba)
(MPL-2.0, ver `docs/mgba-setup.md`) como el motor real de emulación:

- `gba_jni.cpp` es un puente delgado sobre la API pública `mCore` de
  mGBA (`mCoreFindVF`, `loadROM` vía `VFileMemChunk`, `runFrame`,
  `setKeys`/`addKeys`/`clearKeys`) — sin lógica de emulación propia,
  mismo espíritu que `gameboy_jni.cpp`.
- `GbaNative.kt`/`GbaView.kt`/`GbaViewManager.kt` replican exactamente
  la forma de `GameBoyNative`/`GameBoyView`/`GameBoyViewManager`.
- `App.tsx` decide qué vista nativa montar (`GameBoyView` vs `GbaView`)
  según la extensión del archivo (`.gba`) o el slug de plataforma que
  reporta la API de RomHack Hub, y comparte D-pad/A/B/SELECT/START entre
  ambas (los nombres de botón coinciden en ambos enums); L/R sólo hacen
  algo cuando el sistema activo es GBA.
- Verificado de punta a punta con una ROM de GBA real provista por el
  usuario (Pokémon Rojo Fuego).

Esto deja mGBA como el único core "no escrito para este proyecto" en el
repo — es una integración, no una reescritura, que es exactamente el
patrón que el punto siguiente (NDS/3DS) debería seguir.

## Cuándo evaluar NDS/3DS

Ya con GB (core propio) y GBA (mGBA) jugables de punta a punta en un
dispositivo real, el mismo patrón de integración usado para GBA —
vendorizar el core existente (melonDS/Lime3DS) y envolverlo con un
puente JNI delgado, en vez de reescribir su lógica — es el camino
directo para agregar esos dos sistemas.
