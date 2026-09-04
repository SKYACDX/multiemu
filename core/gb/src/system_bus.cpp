#include "gb/system_bus.h"

namespace gb {

u8 SystemBus::read(u16 address) {
    if (address < 0x8000) return cartridge_->readRom(address);
    if (address < 0xA000) return 0xFF;  // TODO: VRAM (needs Ppu)
    if (address < 0xC000) return cartridge_->readRam(address);
    if (address < 0xE000) return wram_[address - 0xC000];
    if (address < 0xFE00) return wram_[address - 0xE000];  // echo of WRAM
    if (address < 0xFEA0) return 0xFF;                     // TODO: OAM (needs Ppu)
    if (address < 0xFF00) return 0xFF;                     // unusable range
    if (address == 0xFF0F) return if_;
    if (address < 0xFF80) return 0xFF;  // TODO: I/O registers (PPU/timer/joypad/APU)
    if (address < 0xFFFF) return hram_[address - 0xFF80];
    return ie_;  // 0xFFFF
}

void SystemBus::write(u16 address, u8 value) {
    if (address < 0x8000) {
        cartridge_->writeRom(address, value);
    } else if (address < 0xA000) {
        // TODO: VRAM
    } else if (address < 0xC000) {
        cartridge_->writeRam(address, value);
    } else if (address < 0xE000) {
        wram_[address - 0xC000] = value;
    } else if (address < 0xFE00) {
        wram_[address - 0xE000] = value;  // echo of WRAM
    } else if (address < 0xFEA0) {
        // TODO: OAM
    } else if (address < 0xFF00) {
        // unusable range, ignored
    } else if (address == 0xFF0F) {
        if_ = value & 0x1F;
    } else if (address < 0xFF80) {
        // TODO: I/O registers
    } else if (address < 0xFFFF) {
        hram_[address - 0xFF80] = value;
    } else {
        ie_ = value;
    }
}

}  // namespace gb
