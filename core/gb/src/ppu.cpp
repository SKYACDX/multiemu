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
        return false;
    }

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
    renderBackgroundAndWindow(bgColorId);
    renderSprites(bgColorId);
}

void Ppu::renderBackgroundAndWindow(std::array<u8, kScreenWidth>& bgColorId) {
    int y = ly_;
    bool bgAndWindowEnabled = lcdc_ & 0x01;
    bool windowEnabled = bgAndWindowEnabled && (lcdc_ & 0x20) && wy_ <= y;
    u16 bgTileMapBase = (lcdc_ & 0x08) ? 0x9C00 : 0x9800;
    u16 winTileMapBase = (lcdc_ & 0x40) ? 0x9C00 : 0x9800;
    bool unsignedTileData = lcdc_ & 0x10;
    bool usedWindowThisLine = false;

    auto tileColorAt = [&](u16 tileMapBase, int x, int py) -> u8 {
        int tileCol = x / 8;
        int tileRow = py / 8;
        u16 mapAddr = tileMapBase + u16(tileRow) * 32 + u16(tileCol);
        u8 tileIndex = vram_[mapAddr - 0x8000];
        u16 tileDataAddr = unsignedTileData ? u16(0x8000 + u16(tileIndex) * 16)
                                             : u16(0x9000 + i8(tileIndex) * 16);
        int rowInTile = py % 8;
        u8 byte1 = vram_[tileDataAddr + rowInTile * 2 - 0x8000];
        u8 byte2 = vram_[tileDataAddr + rowInTile * 2 + 1 - 0x8000];
        int bit = 7 - (x % 8);
        u8 lo = (byte1 >> bit) & 1;
        u8 hi = (byte2 >> bit) & 1;
        return u8((hi << 1) | lo);
    };

    for (int x = 0; x < kScreenWidth; x++) {
        u8 colorId = 0;
        if (bgAndWindowEnabled) {
            if (windowEnabled && x + 7 >= wx_) {
                usedWindowThisLine = true;
                colorId = tileColorAt(winTileMapBase, x - (int(wx_) - 7), windowLine_);
            } else {
                colorId = tileColorAt(bgTileMapBase, (scx_ + x) & 0xFF, (scy_ + y) & 0xFF);
            }
        }
        bgColorId[x] = colorId;
        framebuffer_[std::size_t(y) * kScreenWidth + x] = applyPalette(bgp_, colorId);
    }

    if (usedWindowThisLine) windowLine_++;
}

void Ppu::renderSprites(std::array<u8, kScreenWidth>& bgColorId) {
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

    // DMG priority: lower X wins; ties broken by lower OAM index. Sort so
    // the highest-priority sprite is drawn LAST (overwriting the rest).
    std::sort(candidates.begin(), candidates.begin() + count, [](const Candidate& a, const Candidate& b) {
        if (a.x != b.x) return a.x > b.x;
        return a.oamIndex > b.oamIndex;
    });

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
        u16 tileDataAddr = u16(0x8000 + u16(tileIndex) * 16 + u16(rowInSprite) * 2);
        u8 byte1 = vram_[tileDataAddr - 0x8000];
        u8 byte2 = vram_[tileDataAddr + 1 - 0x8000];

        for (int px = 0; px < 8; px++) {
            int bit = xFlip ? px : (7 - px);
            u8 lo = (byte1 >> bit) & 1;
            u8 hi = (byte2 >> bit) & 1;
            u8 colorId = u8((hi << 1) | lo);
            if (colorId == 0) continue;  // transparent

            int screenX = sprite.x + px;
            if (screenX < 0 || screenX >= kScreenWidth) continue;
            if (behindBg && bgColorId[screenX] != 0) continue;

            framebuffer_[std::size_t(y) * kScreenWidth + screenX] = applyPalette(palette, colorId);
        }
    }
}

}  // namespace gb
