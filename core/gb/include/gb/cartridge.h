#pragma once
#include <cstdint>
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
    // be persisted to/from disk by the platform layer. A cartridge with a
    // real-time clock (MBC3+TIMER) appends the clock's state, in the
    // 48-byte layout BGB and VBA-M use, so a save carries its time with it
    // and can move between emulators.
    virtual bool hasBattery() const = 0;
    virtual const std::vector<u8>& ram() const = 0;
    virtual void loadRam(const std::vector<u8>& data) = 0;
};

// Parses the cartridge header (0x0100-0x014F) and constructs the right MBC
// implementation: ROM only, MBC1, MBC3 (with or without its clock) or MBC5.
// Returns nullptr if the ROM is too short to contain a header or declares
// a mapper type we don't support yet (MBC2, and the rarer ones).
// Header layout: 0x0147 = cartridge type, 0x0148 = ROM size, 0x0149 = RAM
// size.
std::unique_ptr<Cartridge> loadCartridge(std::vector<u8> romData);

// Where an MBC3's clock reads the time from: seconds since the Unix epoch.
// The wall clock by default, which is what a real cartridge's battery-kept
// clock amounts to. Tests swap in their own.
using ClockSource = std::int64_t (*)();
void setClockSource(ClockSource source);

}  // namespace gb
