#pragma once
#include <array>

#include "gb/types.h"

namespace gb {

constexpr int kScreenWidth = 160;
constexpr int kScreenHeight = 144;

// Picture Processing Unit. Owns VRAM/OAM directly (unlike the CPU, which
// only ever sees memory through Bus) because SystemBus routes
// 0x8000-0x9FFF and 0xFE00-0xFE9F here, and the PPU's own registers
// (0xFF40-0xFF4B) are cheaper to model as named fields than to round-trip
// through a generic memory interface.
//
// Timing model: whole-scanline rendering at the mode3->mode0 boundary,
// not cycle-accurate pixel-by-pixel PPU emulation. This produces correct
// output for the vast majority of commercial ROMs (anything that doesn't
// do mid-scanline raster tricks like changing SCX mid-line), and is far
// simpler to get right. Revisit only if a specific game needs it.
class Ppu {
   public:
    // Palette index (0-3) per pixel, row-major, already palette-applied
    // (i.e. these are shades, not raw tile color IDs).
    using Framebuffer = std::array<u8, kScreenWidth * kScreenHeight>;

    // Advances by tCycles t-cycles, updating LY/STAT/mode and rendering
    // completed scanlines. Sets bit 0 (VBlank) and/or bit 1 (STAT) of
    // *ifReg as those interrupts trigger. Returns true exactly once per
    // frame, the instant VBlank starts, so the caller knows framebuffer()
    // holds a complete frame.
    bool tick(int tCycles, u8& ifReg);

    const Framebuffer& framebuffer() const { return framebuffer_; }

    u8 readVram(u16 address) const { return vram_[address & 0x1FFF]; }
    void writeVram(u16 address, u8 value) { vram_[address & 0x1FFF] = value; }
    u8 readOam(u16 address) const { return oam_[address & 0xFF]; }
    void writeOam(u16 address, u8 value) { oam_[address & 0xFF] = value; }

    // Routes 0xFF40-0xFF4B (except 0xFF46/DMA, which SystemBus handles
    // itself since it needs full-bus read access OAM DMA can't get from
    // inside the Ppu).
    u8 readRegister(u16 address) const;
    void writeRegister(u16 address, u8 value);

   private:
    void renderScanline();
    void renderBackgroundAndWindow(std::array<u8, kScreenWidth>& colorIds);
    void renderSprites(std::array<u8, kScreenWidth>& colorIds);
    void setMode(int mode, u8& ifReg);
    void checkLycCoincidence(u8& ifReg);

    std::array<u8, 0x2000> vram_{};
    std::array<u8, 0xA0> oam_{};
    Framebuffer framebuffer_{};

    int modeClock_ = 0;
    // Cycles run with the LCD off, towards the next blank frame.
    int offClock_ = 0;
    int mode_ = 2;
    int windowLine_ = 0;  // internal line counter for the window layer

    u8 lcdc_ = 0x91;
    // Only bits 2 (coincidence) and 3-6 (STAT interrupt sources) live
    // here; the mode bits (0-1) are never stored -- they're always
    // derived from mode_ in readRegister() so the two can't disagree.
    u8 stat_ = 0;
    u8 scy_ = 0, scx_ = 0;
    u8 ly_ = 0, lyc_ = 0;
    u8 bgp_ = 0xFC, obp0_ = 0xFF, obp1_ = 0xFF;
    u8 wy_ = 0, wx_ = 0;
};

}  // namespace gb
