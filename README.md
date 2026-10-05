# multiemu

Emulador multi-sistema (Game Boy / Game Boy Color, con Nintendo DS y 3DS como
metas futuras) para Android e iOS.

## Estrategia

- **Game Boy / GBC**: núcleo escrito desde cero en C++ (`core/gb`), como
  proyecto de aprendizaje. Es la prioridad actual.
- **Nintendo DS / 3DS**: no se reescriben desde cero. Cuando llegue el
  momento, se integran núcleos open-source maduros (melonDS para NDS,
  Lime3DS para 3DS) detrás de la misma interfaz de "core" que usa la UI, para
  que la app no tenga que distinguir de dónde viene cada emulador.
- **UI**: React Native (Android + iOS), con módulos nativos (JNI en Android,
  Objective-C++ en iOS) que hacen de puente hacia el núcleo en C++.

## Estado actual

- [x] Estructura del repo
- [x] CPU (SM83) — registros, flags, tabla de opcodes (falta 0xCB, DAA)
- [x] Bus de memoria — WRAM/HRAM/cartucho conectados; VRAM/OAM/I-O son
      stubs hasta que exista la PPU
- [x] Cartucho / mappers — ROM only y MBC1 implementados; MBC3/MBC5 pendientes
- [x] Timers e interrupciones — DIV/TIMA/TMA/TAC y despacho IE/IF/IME,
      `GameBoy` mantiene CPU+timer sincronizados
- [x] PPU — modos OAM/transfer/HBlank/VBlank, LYC/STAT, background+window+
      sprites (con prioridad y flip), DMA de OAM; falta CGB y timing
      cycle-accurate dentro de una scanline
- [x] Input (joypad) — P1/JOYP con selección de grupo e interrupción
- [ ] APU (audio) — se puede posponer
- [x] Bindings nativos Android (JNI) — `android/gbcore`, compilado y
      verificado cross-compilando para arm64-v8a con el NDK; falta iOS
      (Obj-C++) y el proyecto Gradle/app real
- [ ] App React Native (carga de ROM, render de frame, controles)

## Estructura

```
core/gb/          núcleo de Game Boy en C++ puro (sin dependencias de plataforma)
  include/        headers públicos
  src/            implementación
  tests/          tests unitarios (CTest)
app/              app React Native (se añade cuando el core tenga CPU+PPU básicos)
docs/             notas de arquitectura, mapas de memoria, opcodes, referencias
```

## Requisitos legales importantes

- Esta app **nunca** debe incluir BIOS, firmware o ROMs de Nintendo. El
  usuario debe volcarlos legalmente desde su propio hardware.
- No se distribuyen ROMs ni se facilita su descarga desde la app.

## Compilar y correr los tests del core

```bash
cmake -S core/gb -B core/gb/build
cmake --build core/gb/build
ctest --test-dir core/gb/build --output-on-failure
```

## Probar el pipeline completo sin una ROM comercial

`core/gb/tools/gen_test_rom.cpp` genera una ROM mínima escrita a mano en
código máquina de Game Boy (sin depender de ningún juego con copyright)
que dibuja un patrón de franjas verticales usando el renderer de
background real. `dump_frame` la corre a través de `GameBoy` hasta el
primer VBlank y vuelca el framebuffer a un BMP:

```bash
./core/gb/build/gen_test_rom test_rom.gb
./core/gb/build/dump_frame test_rom.gb frame.bmp
```

Si el pipeline (CPU + Bus + VRAM/OAM + PPU) funciona, `frame.bmp` muestra
20 franjas de 8px alternando blanco/negro cubriendo toda la pantalla.


## Licencia

multiemu es software libre bajo la [GNU GPL v3 o posterior](LICENSE). Los emuladores que incluye conservan sus propias licencias; ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
