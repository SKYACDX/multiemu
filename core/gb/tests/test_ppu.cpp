#include <cstdio>
#include <functional>
#include <vector>

#include "gb/ppu.h"

namespace {

struct TestCase {
    const char* name;
    std::function<bool()> fn;
};

std::vector<TestCase>& registry() {
    static std::vector<TestCase> r;
    return r;
}

struct Registrar {
    Registrar(const char* name, std::function<bool()> fn) {
        registry().push_back({name, std::move(fn)});
    }
};

#define TEST_CASE(name)                                    \
    static bool name();                                    \
    static Registrar registrar_##name(#name, name);         \
    static bool name()

#define CHECK(cond)                                                     \
    do {                                                                \
        if (!(cond)) {                                                  \
            std::printf("  CHECK failed: %s (line %d)\n", #cond, __LINE__); \
            return false;                                               \
        }                                                                \
    } while (0)

int currentMode(gb::Ppu& ppu) { return ppu.readRegister(0xFF41) & 0x03; }

// Advances through exactly one scanline's OAM-search + pixel-transfer
// phases, which is when renderScanline() fires for the current LY. Stops
// short of the HBlank->next-line transition so callers can inspect the
// freshly rendered line before LY changes.
void renderOneLine(gb::Ppu& ppu, gb::u8& ifReg) {
    ppu.tick(80, ifReg);
    ppu.tick(172, ifReg);
}

TEST_CASE(mode_progresses_oam_transfer_hblank_then_next_line) {
    gb::Ppu ppu;
    gb::u8 ifReg = 0;
    CHECK(currentMode(ppu) == 2);
    ppu.tick(80, ifReg);
    CHECK(currentMode(ppu) == 3);
    ppu.tick(172, ifReg);
    CHECK(currentMode(ppu) == 0);
    ppu.tick(204, ifReg);
    CHECK(currentMode(ppu) == 2);
    CHECK(ppu.readRegister(0xFF44) == 1);  // LY advanced
    return true;
}

TEST_CASE(vblank_starts_at_line_144_and_reports_frame_ready) {
    gb::Ppu ppu;
    gb::u8 ifReg = 0;
    bool frameReady = false;
    for (int line = 0; line < 144 && !frameReady; line++) {
        ppu.tick(80, ifReg);
        ppu.tick(172, ifReg);
        frameReady = ppu.tick(204, ifReg);
    }
    CHECK(frameReady);
    CHECK(ppu.readRegister(0xFF44) == 144);
    CHECK((ifReg & 0x01) != 0);  // VBlank interrupt requested
    CHECK(currentMode(ppu) == 1);
    return true;
}

TEST_CASE(lyc_coincidence_sets_stat_flag_and_can_interrupt) {
    gb::Ppu ppu;
    gb::u8 ifReg = 0;
    ppu.writeRegister(0xFF45, 2);     // LYC = 2
    ppu.writeRegister(0xFF41, 0x40);  // enable LYC=LY STAT interrupt
    for (int line = 0; line < 2; line++) {
        ppu.tick(80, ifReg);
        ppu.tick(172, ifReg);
        ppu.tick(204, ifReg);
    }
    CHECK(ppu.readRegister(0xFF44) == 2);
    CHECK((ppu.readRegister(0xFF41) & 0x04) != 0);  // coincidence flag set
    CHECK((ifReg & 0x02) != 0);                     // STAT interrupt requested
    return true;
}

TEST_CASE(background_tile_renders_through_palette) {
    gb::Ppu ppu;
    gb::u8 ifReg = 0;
    // Default LCDC (0x91) = LCD on, BG+window on, unsigned tile data at
    // 0x8000, BG map at 0x9800. VRAM/map both start zeroed, so every map
    // entry already points at tile 0 -- just fill tile 0 with color ID 3.
    for (int row = 0; row < 8; row++) {
        ppu.writeVram(0x8000 + row * 2, 0xFF);
        ppu.writeVram(0x8000 + row * 2 + 1, 0xFF);
    }
    // Default BGP (0xFC) maps color ID 3 -> shade 3.
    renderOneLine(ppu, ifReg);
    CHECK(ppu.framebuffer()[0] == 3);
    CHECK(ppu.framebuffer()[159] == 3);
    return true;
}

TEST_CASE(sprite_pixel_overrides_background_except_where_transparent) {
    gb::Ppu ppu;
    gb::u8 ifReg = 0;
    // Background: tile 0 filled with color ID 3 -> shade 3 (default BGP).
    for (int row = 0; row < 8; row++) {
        ppu.writeVram(0x8000 + row * 2, 0xFF);
        ppu.writeVram(0x8000 + row * 2 + 1, 0xFF);
    }
    // Default LCDC has OBJ display disabled (bit 1); games turn it on
    // themselves, so the test must too.
    ppu.writeRegister(0xFF40, ppu.readRegister(0xFF40) | 0x02);
    // OBP0 remapped so sprite color ID 1 -> shade 0, distinguishable from
    // the background's shade 3.
    ppu.writeRegister(0xFF48, 0x02);
    // Sprite at screen (0,0): OAM Y/X are offset by 16/8 on real hardware.
    ppu.writeOam(0xFE00, 16);
    ppu.writeOam(0xFE01, 8);
    ppu.writeOam(0xFE02, 1);  // tile 1
    ppu.writeOam(0xFE03, 0);  // no flip, OBP0, priority above BG
    // Tile 1 row 0: pixel 0 = color ID 1 (opaque), pixel 1 = color ID 0 (transparent).
    ppu.writeVram(0x8010, 0x80);
    ppu.writeVram(0x8011, 0x00);

    renderOneLine(ppu, ifReg);
    CHECK(ppu.framebuffer()[0] == 0);  // sprite pixel wins
    CHECK(ppu.framebuffer()[1] == 3);  // transparent sprite pixel -> background shows through
    return true;
}

TEST_CASE(lcd_off_still_reports_a_blank_frame_every_70224_cycles) {
    gb::Ppu ppu;
    gb::u8 ifReg = 0;
    ppu.writeRegister(0xFF40, 0x11);  // LCD off, BG on
    int frames = 0;
    for (int cycles = 0; cycles < 70224 * 3; cycles += 4) {
        if (ppu.tick(4, ifReg)) frames++;
    }
    CHECK(frames == 3);
    for (gb::u8 shade : ppu.framebuffer()) CHECK(shade == 0);
    return true;
}

}  // namespace

int main() {
    int failed = 0;
    for (auto& tc : registry()) {
        bool ok = tc.fn();
        std::printf("[%s] %s\n", ok ? "PASS" : "FAIL", tc.name);
        if (!ok) failed++;
    }
    std::printf("%zu tests, %d failed\n", registry().size(), failed);
    return failed == 0 ? 0 : 1;
}
