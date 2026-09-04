# Mapa de memoria del Game Boy (DMG/GBC)

Referencia rápida para implementar el `Bus` real (aún pendiente). Fuente:
comportamiento documentado de hardware conocido públicamente (Pan Docs).

| Rango | Tamaño | Descripción |
|---|---|---|
| 0x0000-0x3FFF | 16 KiB | ROM banco 0 (fijo) |
| 0x4000-0x7FFF | 16 KiB | ROM banco N (conmutable vía mapper) |
| 0x8000-0x9FFF | 8 KiB | VRAM (tiles + tile maps) |
| 0xA000-0xBFFF | 8 KiB | RAM externa del cartucho (si tiene, vía mapper) |
| 0xC000-0xCFFF | 4 KiB | WRAM banco 0 |
| 0xD000-0xDFFF | 4 KiB | WRAM banco 1 (en GBC, conmutable 1-7) |
| 0xE000-0xFDFF | - | Echo RAM (espejo de 0xC000-0xDDFF, no usar) |
| 0xFE00-0xFE9F | 160 B | OAM (atributos de sprites) |
| 0xFEA0-0xFEFF | - | No usable |
| 0xFF00-0xFF7F | 128 B | Registros de I/O (joypad, timer, sonido, LCD, etc.) |
| 0xFF80-0xFFFE | 127 B | HRAM (zero-page rápida) |
| 0xFFFF | 1 B | Registro IE (interrupt enable) |

## Próximo paso de implementación

1. `Cartridge`: lee el header (0x0100-0x014F), detecta el tipo de mapper
   (byte 0x0147) y el tamaño de ROM/RAM.
2. `Mbc` (interfaz): `ROM only`, `MBC1`, `MBC3` (con RTC), `MBC5` — cubren
   la gran mayoría de la librería comercial de GB/GBC.
3. `Bus` real: implementa `Bus::read/write` delegando a WRAM/VRAM/OAM/IO/
   HRAM/cartucho según el rango de arriba, y conecta con el registro IE
   para las interrupciones que el CPU aún no dispara.
