#pragma once
#include <memory>
#include <vector>

#include "gb/types.h"

namespace gb {

// A loaded ROM plus its mapper (MBC) state. Implements Bus-style
// read/write for the two address ranges a cartridge owns:
//   0x0000-0x7FFF  ROM (bank 0 fixed + switchable bank)
//   0xA000-0xBFFF  external RAM (if present, battery-backed or not)
//
// This is an interface, not yet Bus itself, because the real system Bus
// also owns WRAM/VRAM/IO/HRAM and only delegates these two ranges here.
class Cartridge {
   public:
    virtual ~Cartridge() = default;

    virtual u8 readRom(u16 address) = 0;
    virtual void writeRom(u16 address, u8 value) = 0;  // MBC control writes
    virtual u8 readRam(u16 address) = 0;
    virtual void writeRam(u16 address, u8 value) = 0;

    // For save files: battery-backed cartridges expose their RAM so it can
    // be persisted to/from disk by the platform layer.
    virtual bool hasBattery() const = 0;
    virtual const std::vector<u8>& ram() const = 0;
    virtual void loadRam(const std::vector<u8>& data) = 0;
};

// Parses the cartridge header (0x0100-0x014F) and constructs the right MBC
// implementation. Returns nullptr if the ROM is too short to contain a
// header or declares a mapper type we don't support yet.
//
// TODO: implement alongside RomOnlyCartridge, Mbc1Cartridge, Mbc3Cartridge
// (with RTC), Mbc5Cartridge in cartridge.cpp. Header layout reference:
// byte 0x0147 = cartridge type, 0x0148 = ROM size, 0x0149 = RAM size.
std::unique_ptr<Cartridge> loadCartridge(std::vector<u8> romData);

}  // namespace gb
