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
    // In Game Boy Color mode the shades are only an approximation (by
    // brightness) kept for frontends that don't know about colour yet;
    // colorFramebuffer() holds the real picture.
    using Framebuffer = std::array<u8, kScreenWidth * kScreenHeight>;
    // RGB555 per pixel, the CGB's own format: red in bits 0-4, green in
    // 5-9, blue in 10-14. Only written in Game Boy Color mode.
    using ColorFramebuffer = std::array<u16, kScreenWidth * kScreenHeight>;

    // Game Boy Color mode: VRAM banks, colour palettes, BG attributes.
    // Chosen once, before anything runs, from the cartridge header.
    void setCgbMode(bool cgb) { cgb_ = cgb; }

    // Advances by tCycles t-cycles, updating LY/STAT/mode and rendering
    // completed scanlines. Sets bit 0 (VBlank) and/or bit 1 (STAT) of
    // *ifReg as those interrupts trigger. Returns true exactly once per
    // frame, the instant VBlank starts, so the caller knows framebuffer()
    // holds a complete frame.
    bool tick(int tCycles, u8& ifReg);

    const Framebuffer& framebuffer() const { return framebuffer_; }
    const ColorFramebuffer& colorFramebuffer() const { return colorFramebuffer_; }

    // True once each time the PPU enters HBlank on a visible line, then
    // false until the next one -- what drives the CGB's HBlank DMA.
    bool takeHBlank() {
        bool started = hblankStarted_;
        hblankStarted_ = false;
        return started;
    }

    // Through the bank VBK (0xFF4F) selects; only ever 1 in CGB mode.
    u8 readVram(u16 address) const { return vram_[vramBank_ * 0x2000 + (address & 0x1FFF)]; }
    void writeVram(u16 address, u8 value) { vram_[vramBank_ * 0x2000 + (address & 0x1FFF)] = value; }
    u8 readOam(u16 address) const { return oam_[address & 0xFF]; }
    void writeOam(u16 address, u8 value) { oam_[address & 0xFF] = value; }

    // Routes 0xFF40-0xFF4B, plus the CGB's 0xFF4F and 0xFF68-0xFF6B (except 0xFF46/DMA, which SystemBus handles
    // itself since it needs full-bus read access OAM DMA can't get from
    // inside the Ppu).
    u8 readRegister(u16 address) const;
    void writeRegister(u16 address, u8 value);

   private:
    void renderScanline();
    void renderBackgroundAndWindow(std::array<u8, kScreenWidth>& colorIds, std::array<bool, kScreenWidth>& bgPriority);
    void renderSprites(const std::array<u8, kScreenWidth>& colorIds, const std::array<bool, kScreenWidth>& bgPriority);
    void putColor(int x, const std::array<u8, 64>& paletteRam, int palette, u8 colorId);
    void setMode(int mode, u8& ifReg);
    void checkLycCoincidence(u8& ifReg);

    // Two 8KiB banks; DMG mode only ever uses the first.
    std::array<u8, 0x4000> vram_{};
    std::array<u8, 0xA0> oam_{};
    Framebuffer framebuffer_{};
    ColorFramebuffer colorFramebuffer_{};

    bool cgb_ = false;
    bool hblankStarted_ = false;
    int vramBank_ = 0;  // VBK
    // 8 palettes x 4 colours x 2 bytes (RGB555, little-endian), reached
    // through BCPS/BCPD and OCPS/OCPD. White until a game writes them.
    std::array<u8, 64> bgPaletteRam_ = filledWhite();
    std::array<u8, 64> objPaletteRam_ = filledWhite();
    u8 bcps_ = 0, ocps_ = 0;  // index in bits 0-5, auto-increment in bit 7

    static std::array<u8, 64> filledWhite() {
        std::array<u8, 64> ram;
        ram.fill(0xFF);
        return ram;
    }

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
