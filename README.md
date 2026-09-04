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
- [ ] APU (audio) — se puede posponer
- [ ] Input (joypad)
- [ ] Bindings nativos Android (JNI) + iOS (Obj-C++)
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
