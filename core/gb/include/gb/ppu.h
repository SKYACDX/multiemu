#pragma once
#include <array>

#include "gb/types.h"

namespace gb {

constexpr int kScreenWidth = 160;
constexpr int kScreenHeight = 144;

// Picture Processing Unit. Owns VRAM/OAM directly (unlike the CPU, which
// only ever sees memory through Bus) because the real system Bus needs to
// route 0x8000-0x9FFF and 0xFE00-0xFE9F here, and the PPU's internal
// registers (0xFF40-0xFF4B) are cheaper to model as plain fields than to
// round-trip through a generic memory interface.
//
// TODO: this is a placeholder shape, not an implementation. The real
// design question to settle first is timing granularity: a simple
// "render whole scanline when mode 3 ends" model (looked up once per
// gb::Cpu::step() based on cycles elapsed) is enough for correct output
// on the vast majority of commercial ROMs, and is far simpler to get
// right than cycle-accurate PPU emulation. Only revisit that if a
// specific game turns out to need mid-scanline raster tricks.
class Ppu {
   public:
    using Framebuffer = std::array<u8, kScreenWidth * kScreenHeight>;  // palette indices 0-3

    // Advances the PPU by the given number of t-cycles (as consumed by the
    // CPU instruction that just executed) and updates LY/STAT/mode
    // accordingly. Returns true exactly once per frame, when VBlank
    // starts, so the caller knows a full Framebuffer is ready to present.
    bool tick(int tCycles);

    const Framebuffer& framebuffer() const { return framebuffer_; }

    u8 readVram(u16 address) const { return vram_[address & 0x1FFF]; }
    void writeVram(u16 address, u8 value) { vram_[address & 0x1FFF] = value; }
    u8 readOam(u16 address) const { return oam_[address & 0xFF]; }
    void writeOam(u16 address, u8 value) { oam_[address & 0xFF] = value; }

    // I/O registers 0xFF40-0xFF4B (LCDC, STAT, SCY, SCX, LY, LYC, palettes,
    // WY, WX). TODO: expose as named fields once the register semantics
    // are implemented; a raw byte array is a placeholder only.
    std::array<u8, 12> registers{};

   private:
    std::array<u8, 0x2000> vram_{};
    std::array<u8, 0xA0> oam_{};
    Framebuffer framebuffer_{};
    int modeClock_ = 0;
    int mode_ = 2;
    int line_ = 0;
};

}  // namespace gb
