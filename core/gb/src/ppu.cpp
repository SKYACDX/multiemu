#include "gb/ppu.h"

#include <algorithm>

namespace gb {

namespace {
constexpr int kOamSearchCycles = 80;
constexpr int kPixelTransferCycles = 172;
constexpr int kHBlankCycles = 204;
constexpr int kLineCycles = kOamSearchCycles + kPixelTransferCycles + kHBlankCycles;  // 456
constexpr int kVBlankStartLine = 144;
constexpr int kLastLine = 153;

u8 applyPalette(u8 palette, u8 colorId) { return (palette >> (colorId * 2)) & 0x03; }
}  // namespace

u8 Ppu::readRegister(u16 address) const {
    switch (address) {
        case 0xFF40: return lcdc_;
        case 0xFF41: return 0x80 | stat_ | u8(mode_);  // bit 7 unused (reads 1); mode bits derived from mode_
        case 0xFF42: return scy_;
        case 0xFF43: return scx_;
        case 0xFF44: return ly_;
        case 0xFF45: return lyc_;
        case 0xFF47: return bgp_;
        case 0xFF48: return obp0_;
        case 0xFF49: return obp1_;
        case 0xFF4A: return wy_;
        case 0xFF4B: return wx_;
        default: break;
    }
    if (!cgb_) return 0xFF;
    switch (address) {
        case 0xFF4F: return 0xFE | u8(vramBank_);
        case 0xFF68: return 0x40 | bcps_;
        case 0xFF69: return bgPaletteRam_[bcps_ & 0x3F];
        case 0xFF6A: return 0x40 | ocps_;
        case 0xFF6B: return objPaletteRam_[ocps_ & 0x3F];
        default: return 0xFF;
    }
}

void Ppu::writeRegister(u16 address, u8 value) {
    switch (address) {
        case 0xFF40: lcdc_ = value; break;
        case 0xFF41: stat_ = (stat_ & 0x07) | (value & 0xF8); break;  // mode+coincidence bits are read-only
        case 0xFF42: scy_ = value; break;
        case 0xFF43: scx_ = value; break;
        case 0xFF44: break;  // LY is read-only from the CPU's perspective
        case 0xFF45: lyc_ = value; break;
        case 0xFF47: bgp_ = value; break;
        case 0xFF48: obp0_ = value; break;
        case 0xFF49: obp1_ = value; break;
        case 0xFF4A: wy_ = value; break;
        case 0xFF4B: wx_ = value; break;
        default: break;
    }
    if (!cgb_) return;
    // Writing the data register advances the index when bit 7 of the
    // index register asks for it, so a game can stream a whole palette.
    auto writePalette = [](std::array<u8, 64>& ram, u8& index, u8 v) {
        ram[index & 0x3F] = v;
        if (index & 0x80) index = 0x80 | ((index + 1) & 0x3F);
    };
    switch (address) {
        case 0xFF4F: vramBank_ = value & 0x01; break;
        case 0xFF68: bcps_ = value & 0xBF; break;
        case 0xFF69: writePalette(bgPaletteRam_, bcps_, value); break;
        case 0xFF6A: ocps_ = value & 0xBF; break;
        case 0xFF6B: writePalette(objPaletteRam_, ocps_, value); break;
        default: break;
    }
}

void Ppu::checkLycCoincidence(u8& ifReg) {
    bool coincide = ly_ == lyc_;
    if (coincide)
        stat_ |= 0x04;
    else
        stat_ &= ~u8(0x04);
    if (coincide && (stat_ & 0x40)) ifReg |= 0x02;
}

void Ppu::setMode(int mode, u8& ifReg) {
    mode_ = mode;
    bool trigger = (mode == 0 && (stat_ & 0x08)) || (mode == 1 && (stat_ & 0x10)) ||
                   (mode == 2 && (stat_ & 0x20));
    if (trigger) ifReg |= 0x02;
}

bool Ppu::tick(int tCycles, u8& ifReg) {
    if (!(lcdc_ & 0x80)) {
        // LCD disabled: hold in a blank, reset state until re-enabled.
        modeClock_ = 0;
        ly_ = 0;
        windowLine_ = 0;
        mode_ = 0;
        stat_ &= 0xFC;

        // Time still passes with the screen off, and frontends count frames
        // to know how much of it has: runUntilFrame returns on one, and the
        // desktop link cable waits for one from each console. So a frame
        // still comes out every 154 lines' worth of cycles -- blank, which is
        // what a DMG shows with the LCD off. Without it, a game that keeps
        // the screen off for a while stalls the frontend for that long, and
        // one that never turns it back on hangs it.
        offClock_ += tCycles;
        if (offClock_ < kLineCycles * 154) return false;
        offClock_ -= kLineCycles * 154;
        framebuffer_.fill(0);
        colorFramebuffer_.fill(0x7FFF);
        return true;
    }
    offClock_ = 0;

    bool frameReady = false;
    modeClock_ += tCycles;

    switch (mode_) {
        case 2:  // OAM search
            if (modeClock_ >= kOamSearchCycles) {
                modeClock_ -= kOamSearchCycles;
                setMode(3, ifReg);
            }
            break;
        case 3:  // pixel transfer
            if (modeClock_ >= kPixelTransferCycles) {
                modeClock_ -= kPixelTransferCycles;
                renderScanline();
                setMode(0, ifReg);
                hblankStarted_ = true;
            }
            break;
        case 0:  // HBlank
            if (modeClock_ >= kHBlankCycles) {
                modeClock_ -= kHBlankCycles;
                ly_++;
                checkLycCoincidence(ifReg);
                if (ly_ == kVBlankStartLine) {
                    setMode(1, ifReg);
                    ifReg |= 0x01;  // VBlank interrupt
                    frameReady = true;
                } else {
                    setMode(2, ifReg);
                }
            }
            break;
        case 1:  // VBlank
            if (modeClock_ >= kLineCycles) {
                modeClock_ -= kLineCycles;
                ly_++;
                if (ly_ > kLastLine) {
                    ly_ = 0;
                    windowLine_ = 0;
                    setMode(2, ifReg);
                }
                checkLycCoincidence(ifReg);
            }
            break;
    }
    return frameReady;
}

void Ppu::renderScanline() {
    std::array<u8, kScreenWidth> bgColorId{};
    std::array<bool, kScreenWidth> bgPriority{};
    renderBackgroundAndWindow(bgColorId, bgPriority);
    renderSprites(bgColorId, bgPriority);
}

// Writes one CGB pixel on the current line: the real colour, plus a shade
// by brightness into the DMG framebuffer for frontends that only read that.
void Ppu::putColor(int x, const std::array<u8, 64>& paletteRam, int palette, u8 colorId) {
    int offset = palette * 8 + colorId * 2;
    u16 color = u16(paletteRam[offset] | (paletteRam[offset + 1] << 8)) & 0x7FFF;
    std::size_t i = std::size_t(ly_) * kScreenWidth + x;
    colorFramebuffer_[i] = color;
    int luma = ((color & 0x1F) * 3 + ((color >> 5) & 0x1F) * 6 + ((color >> 10) & 0x1F)) / 10;  // 0-31
    framebuffer_[i] = u8(3 - luma / 8);
}

void Ppu::renderBackgroundAndWindow(std::array<u8, kScreenWidth>& bgColorId, std::array<bool, kScreenWidth>& bgPriority) {
    int y = ly_;
    // On a CGB in colour mode, LCDC bit 0 no longer blanks the background:
    // it only takes away the background's priority over sprites.
    bool bgAndWindowEnabled = cgb_ || (lcdc_ & 0x01);
    bool windowEnabled = bgAndWindowEnabled && (lcdc_ & 0x20) && wy_ <= y;
    u16 bgTileMapBase = (lcdc_ & 0x08) ? 0x9C00 : 0x9800;
    u16 winTileMapBase = (lcdc_ & 0x40) ? 0x9C00 : 0x9800;
    bool unsignedTileData = lcdc_ & 0x10;
    bool usedWindowThisLine = false;

    // CGB attributes live in VRAM bank 1 at the same address as the tile
    // index: bits 0-2 palette, 3 tile bank, 5 x-flip, 6 y-flip, 7 priority.
    // Always 0 in DMG mode, where bank 1 doesn't exist.
    auto tileColorAt = [&](u16 tileMapBase, int x, int py, u8& attr) -> u8 {
        int mapOffset = tileMapBase - 0x8000 + (py / 8) * 32 + (x / 8);
        u8 tileIndex = vram_[mapOffset];
        attr = cgb_ ? vram_[0x2000 + mapOffset] : 0;
        int tileData = unsignedTileData ? tileIndex * 16 : 0x1000 + i8(tileIndex) * 16;
        if (attr & 0x08) tileData += 0x2000;
        int rowInTile = (attr & 0x40) ? 7 - py % 8 : py % 8;
        u8 byte1 = vram_[tileData + rowInTile * 2];
        u8 byte2 = vram_[tileData + rowInTile * 2 + 1];
        int bit = (attr & 0x20) ? x % 8 : 7 - x % 8;
        u8 lo = (byte1 >> bit) & 1;
        u8 hi = (byte2 >> bit) & 1;
        return u8((hi << 1) | lo);
    };

    for (int x = 0; x < kScreenWidth; x++) {
        u8 colorId = 0;
        u8 attr = 0;
        if (bgAndWindowEnabled) {
            if (windowEnabled && x + 7 >= wx_) {
                usedWindowThisLine = true;
                colorId = tileColorAt(winTileMapBase, x - (int(wx_) - 7), windowLine_, attr);
            } else {
                colorId = tileColorAt(bgTileMapBase, (scx_ + x) & 0xFF, (scy_ + y) & 0xFF, attr);
            }
        }
        bgColorId[x] = colorId;
        bgPriority[x] = attr & 0x80;
        if (cgb_)
            putColor(x, bgPaletteRam_, attr & 0x07, colorId);
        else
            framebuffer_[std::size_t(y) * kScreenWidth + x] = applyPalette(bgp_, colorId);
    }

    if (usedWindowThisLine) windowLine_++;
}

void Ppu::renderSprites(const std::array<u8, kScreenWidth>& bgColorId, const std::array<bool, kScreenWidth>& bgPriority) {
    if (!(lcdc_ & 0x02)) return;

    struct Candidate {
        int oamIndex, x, y;
        u8 tile, attr;
    };
    std::array<Candidate, 10> candidates{};
    int count = 0;

    int spriteHeight = (lcdc_ & 0x04) ? 16 : 8;
    int y = ly_;
    for (int i = 0; i < 40 && count < 10; i++) {
        int base = i * 4;
        int spriteY = int(oam_[base]) - 16;
        if (y < spriteY || y >= spriteY + spriteHeight) continue;
        int spriteX = int(oam_[base + 1]) - 8;
        candidates[count++] = {i, spriteX, spriteY, oam_[base + 2], oam_[base + 3]};
    }

    // DMG priority: lower X wins; ties broken by lower OAM index. CGB:
    // OAM index alone. Sort so the highest-priority sprite is drawn LAST
    // (overwriting the rest).
    bool cgb = cgb_;
    std::sort(candidates.begin(), candidates.begin() + count, [cgb](const Candidate& a, const Candidate& b) {
        if (!cgb && a.x != b.x) return a.x > b.x;
        return a.oamIndex > b.oamIndex;
    });

    // CGB: with LCDC bit 0 clear, sprites always win over the background.
    bool bgCanWin = !cgb_ || (lcdc_ & 0x01);

    for (int c = 0; c < count; c++) {
        const Candidate& sprite = candidates[c];
        bool yFlip = sprite.attr & 0x40;
        bool xFlip = sprite.attr & 0x20;
        bool behindBg = sprite.attr & 0x80;
        u8 palette = (sprite.attr & 0x10) ? obp1_ : obp0_;

        int rowInSprite = y - sprite.y;
        if (yFlip) rowInSprite = spriteHeight - 1 - rowInSprite;
        u8 tileIndex = sprite.tile;
        if (spriteHeight == 16) tileIndex &= 0xFE;
        int tileData = tileIndex * 16 + rowInSprite * 2;
        if (cgb_ && (sprite.attr & 0x08)) tileData += 0x2000;  // CGB: tile from VRAM bank 1
        u8 byte1 = vram_[tileData];
        u8 byte2 = vram_[tileData + 1];

        for (int px = 0; px < 8; px++) {
            int bit = xFlip ? px : (7 - px);
            u8 lo = (byte1 >> bit) & 1;
            u8 hi = (byte2 >> bit) & 1;
            u8 colorId = u8((hi << 1) | lo);
            if (colorId == 0) continue;  // transparent

            int screenX = sprite.x + px;
            if (screenX < 0 || screenX >= kScreenWidth) continue;
            if (bgCanWin && bgColorId[screenX] != 0 && (behindBg || bgPriority[screenX])) continue;

            if (cgb_)
                putColor(screenX, objPaletteRam_, sprite.attr & 0x07, colorId);
            else
                framebuffer_[std::size_t(y) * kScreenWidth + screenX] = applyPalette(palette, colorId);
        }
    }
}

}  // namespace gb
