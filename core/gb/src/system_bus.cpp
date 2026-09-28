#include "gb/system_bus.h"

namespace gb {

u8 SystemBus::read(u16 address) {
    if (address < 0x8000) return cartridge_->readRom(address);
    if (address < 0xA000) return ppu_.readVram(address);
    if (address < 0xC000) return cartridge_->readRam(address);
    if (address < 0xFE00) return wramAt(address);  // WRAM, then its echo
    if (address < 0xFEA0) return ppu_.readOam(address);
    if (address < 0xFF00) return 0xFF;  // unusable range
    if (address == 0xFF00) return joypad_.readRegister();
    if (address == 0xFF01) return serial_.readSb();
    if (address == 0xFF02) return serial_.readSc();
    if (address == 0xFF04) return timer_.readDiv();
    if (address == 0xFF05) return timer_.tima;
    if (address == 0xFF06) return timer_.tma;
    if (address == 0xFF07) return timer_.tac;
    if (address == 0xFF0F) return if_;
    if (address >= 0xFF10 && address <= 0xFF3F) return apu_.readRegister(address);
    if (address >= 0xFF40 && address <= 0xFF4B) return ppu_.readRegister(address);
    if (address == 0xFF4F || (address >= 0xFF68 && address <= 0xFF6B)) return ppu_.readRegister(address);
    if (cgb_) {
        if (address == 0xFF4D) return u8(0x7E | (doubleSpeed_ ? 0x80 : 0) | (speedSwitchArmed_ ? 0x01 : 0));
        // Bit 7 clear while an HBlank DMA is running; the rest is blocks
        // left minus one, so a finished (or never started) one reads 0xFF.
        if (address == 0xFF55) return u8((hdmaActive_ ? 0x00 : 0x80) | ((hdmaBlocksLeft_ - 1) & 0x7F));
        if (address == 0xFF70) return u8(0xF8 | wramBank_);
    }
    if (address < 0xFF80) return 0xFF;  // unmapped I/O
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
    } else if (address < 0xFE00) {
        wramAt(address) = value;  // WRAM, then its echo
    } else if (address < 0xFEA0) {
        ppu_.writeOam(address, value);
    } else if (address < 0xFF00) {
        // unusable range, ignored
    } else if (address == 0xFF00) {
        joypad_.writeRegister(value);
    } else if (address == 0xFF01) {
        serial_.writeSb(value);
    } else if (address == 0xFF02) {
        serial_.writeSc(value);
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
    } else if (address == 0xFF4F || (address >= 0xFF68 && address <= 0xFF6B)) {
        ppu_.writeRegister(address, value);  // CGB-only; the PPU ignores them on a DMG
    } else if (cgb_ && address == 0xFF4D) {
        speedSwitchArmed_ = value & 0x01;
    } else if (cgb_ && address == 0xFF51) {
        hdmaSource_ = u16((hdmaSource_ & 0x00FF) | (value << 8));
    } else if (cgb_ && address == 0xFF52) {
        hdmaSource_ = u16((hdmaSource_ & 0xFF00) | (value & 0xF0));
    } else if (cgb_ && address == 0xFF53) {
        hdmaDest_ = u16((hdmaDest_ & 0x00FF) | ((value & 0x1F) << 8));
    } else if (cgb_ && address == 0xFF54) {
        hdmaDest_ = u16((hdmaDest_ & 0x1F00) | (value & 0xF0));
    } else if (cgb_ && address == 0xFF55) {
        writeHdma5(value);
    } else if (cgb_ && address == 0xFF70) {
        wramBank_ = (value & 0x07) ? (value & 0x07) : 1;
    } else if (address < 0xFF80) {
        // unmapped I/O, ignored
    } else if (address < 0xFFFF) {
        hram_[address - 0xFF80] = value;
    } else {
        ie_ = value;
    }
}

void SystemBus::stop() {
    // STOP always resets DIV. On a CGB with KEY1 armed it is also the
    // speed switch; real hardware then sits still for ~2050 m-cycles,
    // which nothing relies on closely enough to model.
    timer_.resetDiv();
    if (cgb_ && speedSwitchArmed_) {
        doubleSpeed_ = !doubleSpeed_;
        speedSwitchArmed_ = false;
    }
}

void SystemBus::writeHdma5(u8 value) {
    // Writing bit 7 clear while an HBlank DMA runs cancels it rather than
    // starting a general one.
    if (hdmaActive_ && !(value & 0x80)) {
        hdmaActive_ = false;
        return;
    }
    hdmaBlocksLeft_ = (value & 0x7F) + 1;
    if (value & 0x80) {
        hdmaActive_ = true;
        // Started inside HBlank (or with the LCD off), the first block
        // goes right away instead of waiting for the next HBlank.
        if ((ppu_.readRegister(0xFF41) & 0x03) == 0) hdmaCopyBlock();
    } else {
        // General purpose: all at once. ponytail: instant, where the CPU
        // really stalls 8 m-cycles a block; model it if a game times it.
        hdmaActive_ = true;
        while (hdmaActive_) hdmaCopyBlock();
    }
}

void SystemBus::hdmaCopyBlock() {
    for (int i = 0; i < 0x10; i++) {
        ppu_.writeVram(u16(0x8000 | ((hdmaDest_ + i) & 0x1FFF)), read(u16(hdmaSource_ + i)));
    }
    hdmaSource_ = u16(hdmaSource_ + 0x10);
    hdmaDest_ = u16((hdmaDest_ + 0x10) & 0x1FFF);
    if (--hdmaBlocksLeft_ == 0) hdmaActive_ = false;
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
