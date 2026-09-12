#include "gb/system_bus.h"

namespace gb {

u8 SystemBus::read(u16 address) {
    if (address < 0x8000) return cartridge_->readRom(address);
    if (address < 0xA000) return ppu_.readVram(address);
    if (address < 0xC000) return cartridge_->readRam(address);
    if (address < 0xE000) return wram_[address - 0xC000];
    if (address < 0xFE00) return wram_[address - 0xE000];  // echo of WRAM
    if (address < 0xFEA0) return ppu_.readOam(address);
    if (address < 0xFF00) return 0xFF;  // unusable range
    if (address == 0xFF00) return joypad_.readRegister();
    if (address == 0xFF04) return timer_.readDiv();
    if (address == 0xFF05) return timer_.tima;
    if (address == 0xFF06) return timer_.tma;
    if (address == 0xFF07) return timer_.tac;
    if (address == 0xFF0F) return if_;
    if (address >= 0xFF10 && address <= 0xFF3F) return apu_.readRegister(address);
    if (address >= 0xFF40 && address <= 0xFF4B) return ppu_.readRegister(address);
    if (address < 0xFF80) return 0xFF;  // TODO: serial registers
    if (address < 0xFFFF) return hram_[address - 0xFF80];
    return ie_;  // 0xFFFF
}

void SystemBus::write(u16 address, u8 value) {
    if (address < 0x8000) {
        cartridge_->writeRom(address, value);
    } else if (address < 0xA000) {
        ppu_.writeVram(address, value);
    } else if (address < 0xC000) {
        cartridge_->writeRam(address, value);
    } else if (address < 0xE000) {
        wram_[address - 0xC000] = value;
    } else if (address < 0xFE00) {
        wram_[address - 0xE000] = value;  // echo of WRAM
    } else if (address < 0xFEA0) {
        ppu_.writeOam(address, value);
    } else if (address < 0xFF00) {
        // unusable range, ignored
    } else if (address == 0xFF00) {
        joypad_.writeRegister(value);
    } else if (address == 0xFF04) {
        timer_.resetDiv();  // any write to DIV resets it to 0
    } else if (address == 0xFF05) {
        timer_.tima = value;
    } else if (address == 0xFF06) {
        timer_.tma = value;
    } else if (address == 0xFF07) {
        timer_.tac = value & 0x07;
    } else if (address == 0xFF0F) {
        if_ = value & 0x1F;
    } else if (address >= 0xFF10 && address <= 0xFF3F) {
        apu_.writeRegister(address, value);
    } else if (address == 0xFF46) {
        dmaTransfer(value);
    } else if (address >= 0xFF40 && address <= 0xFF4B) {
        ppu_.writeRegister(address, value);
    } else if (address < 0xFF80) {
        // TODO: serial registers
    } else if (address < 0xFFFF) {
        hram_[address - 0xFF80] = value;
    } else {
        ie_ = value;
    }
}

void SystemBus::dmaTransfer(u8 value) {
    // OAM DMA: copies 160 bytes from (value << 8) into OAM. Real hardware
    // takes 160 m-cycles and blocks the CPU from accessing most memory
    // during the transfer; this does it instantly, which is wrong for the
    // handful of games that time against it but fine for the rest.
    u16 source = u16(value) << 8;
    for (u16 i = 0; i < 0xA0; i++) {
        ppu_.writeOam(0xFE00 + i, read(source + i));
    }
}

}  // namespace gb
