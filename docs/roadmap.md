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

7. **Joypad** — mapeo de botones a 0xFF00, sin lógica compleja.

8. **APU (audio)** — se puede posponer sin bloquear tener un emulador
   jugable (silencioso) mientras se valida CPU+PPU+input.

9. **Bindings nativos** — una vez CPU+Bus+Cartridge+PPU+Joypad producen un
   frame y aceptan input, se envuelve todo en:
   - Android: JNI (`Java_com_multiemu_..._step`), copiando el framebuffer
     a una `Bitmap`/textura OpenGL.
   - iOS: wrapper Objective-C++ que expone el mismo framebuffer a Metal/
     UIImage.

10. **App React Native** — pantalla de selección de ROM, renderizado del
    framebuffer (vía `<Image>` desde base64 al inicio, luego una vista
    nativa dedicada por rendimiento), mapeo de controles táctiles.

## Cuándo evaluar NDS/3DS

Solo después de tener el punto 9 (GB jugable de punta a punta en un
dispositivo real). En ese momento, la interfaz de "core" que la app ya usa
(step, framebuffer, input, save state) sirve de contrato para envolver
melonDS/Lime3DS como cores alternativos, en vez de reescribir su lógica.
