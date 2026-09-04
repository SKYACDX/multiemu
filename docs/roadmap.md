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

4. **Interrupciones** — VBlank, LCD STAT, Timer, Serial, Joypad. El CPU
   necesita un método `requestInterrupt()`/chequeo en cada `step()` que
   empuje PC a la stack y salte al vector correspondiente si `IME` está
   activo.

5. **Timers** — DIV/TIMA/TMA/TAC, corren en paralelo a la CPU contando
   t-cycles; disparan la interrupción de Timer.

6. **PPU** — la parte más grande después de la CPU: modos 0-3 por scanline,
   renderizado de background/window (tiles) y sprites (OAM), y disparo de
   VBlank/STAT. Se recomienda primero un renderizador "scanline al final
   del modo 3" (más simple) antes de intentar ciclo-a-ciclo.

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
