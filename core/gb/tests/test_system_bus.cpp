#include <cstdio>
#include <functional>
#include <vector>

#include "gb/cartridge.h"
#include "gb/system_bus.h"

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

gb::SystemBus makeBus() {
    std::vector<gb::u8> rom(0x8000, 0x00);  // 32KiB ROM ONLY
    rom[0x147] = 0x00;
    return gb::SystemBus(gb::loadCartridge(std::move(rom)));
}

TEST_CASE(rom_range_delegates_to_cartridge) {
    std::vector<gb::u8> rom(0x8000, 0x00);
    rom[0x147] = 0x00;
    rom[0x0000] = 0xAB;
    gb::SystemBus bus(gb::loadCartridge(std::move(rom)));
    CHECK(bus.read(0x0000) == 0xAB);
    return true;
}

TEST_CASE(wram_read_write_roundtrip) {
    auto bus = makeBus();
    bus.write(0xC000, 0x12);
    bus.write(0xDFFF, 0x34);
    CHECK(bus.read(0xC000) == 0x12);
    CHECK(bus.read(0xDFFF) == 0x34);
    return true;
}

TEST_CASE(echo_ram_mirrors_wram) {
    auto bus = makeBus();
    bus.write(0xC005, 0x99);
    CHECK(bus.read(0xE005) == 0x99);
    bus.write(0xE010, 0x77);
    CHECK(bus.read(0xC010) == 0x77);
    return true;
}

TEST_CASE(hram_read_write_roundtrip) {
    auto bus = makeBus();
    bus.write(0xFF80, 0x01);
    bus.write(0xFFFE, 0x02);
    CHECK(bus.read(0xFF80) == 0x01);
    CHECK(bus.read(0xFFFE) == 0x02);
    return true;
}

TEST_CASE(interrupt_enable_register_roundtrip) {
    auto bus = makeBus();
    bus.write(0xFFFF, 0x1F);
    CHECK(bus.read(0xFFFF) == 0x1F);
    CHECK(bus.interruptEnable() == 0x1F);
    return true;
}

TEST_CASE(interrupt_flag_register_masks_to_5_bits) {
    auto bus = makeBus();
    bus.write(0xFF0F, 0xFF);
    CHECK(bus.read(0xFF0F) == 0x1F);
    CHECK(bus.interruptFlag() == 0x1F);
    return true;
}

// --- Game Boy Color mode ---

gb::SystemBus makeCgbBus() {
    std::vector<gb::u8> rom(0x8000, 0x00);
    rom[0x143] = 0xC0;  // CGB only
    return gb::SystemBus(gb::loadCartridge(std::move(rom)));
}

TEST_CASE(header_flag_selects_cgb_mode) {
    CHECK(!makeBus().cgbMode());
    CHECK(makeCgbBus().cgbMode());
    return true;
}

TEST_CASE(cgb_registers_are_absent_on_dmg) {
    auto bus = makeBus();
    bus.write(0xFF70, 0x03);
    bus.write(0xD000, 0x11);
    bus.write(0xFF70, 0x05);
    CHECK(bus.read(0xD000) == 0x11);  // no WRAM banking on a DMG
    CHECK(bus.read(0xFF4D) == 0xFF);
    CHECK(bus.read(0xFF70) == 0xFF);
    return true;
}

TEST_CASE(svbk_switches_upper_wram_and_bank_0_means_1) {
    auto bus = makeCgbBus();
    bus.write(0xC000, 0xAA);
    bus.write(0xFF70, 0x02);
    bus.write(0xD000, 0x22);
    bus.write(0xFF70, 0x03);
    bus.write(0xD000, 0x33);
    CHECK(bus.read(0xC000) == 0xAA);  // bank 0 is fixed
    bus.write(0xFF70, 0x02);
    CHECK(bus.read(0xD000) == 0x22);
    CHECK(bus.read(0xF000) == 0x22);  // echo follows the bank
    bus.write(0xFF70, 0x00);
    bus.write(0xD000, 0x11);
    bus.write(0xFF70, 0x01);
    CHECK(bus.read(0xD000) == 0x11);
    return true;
}

TEST_CASE(vbk_selects_vram_bank) {
    auto bus = makeCgbBus();
    bus.write(0x8000, 0x10);
    bus.write(0xFF4F, 0x01);
    bus.write(0x8000, 0x20);
    CHECK(bus.read(0xFF4F) == 0xFF);
    CHECK(bus.read(0x8000) == 0x20);
    bus.write(0xFF4F, 0x00);
    CHECK(bus.read(0x8000) == 0x10);
    return true;
}

TEST_CASE(stop_with_key1_armed_switches_speed) {
    auto bus = makeCgbBus();
    bus.stop();
    CHECK(!bus.doubleSpeed());  // not armed: STOP alone does nothing
    bus.write(0xFF4D, 0x01);
    CHECK(bus.read(0xFF4D) == 0x7F);
    bus.stop();
    CHECK(bus.doubleSpeed());
    CHECK(bus.read(0xFF4D) == 0xFE);  // speed bit set, arm bit cleared
    return true;
}

TEST_CASE(double_speed_halves_ppu_time_but_not_timer) {
    auto bus = makeCgbBus();
    bus.write(0xFF4D, 0x01);
    bus.stop();
    bus.write(0xFF40, 0x91);
    // A full frame of PPU time at double speed takes twice the CPU cycles.
    int ticks = 0;
    while (!bus.tick(4)) ticks += 4;
    int firstFrame = ticks;
    ticks = 0;
    while (!bus.tick(4)) ticks += 4;
    CHECK(ticks + 4 == 70224 * 2);
    CHECK(firstFrame > 0);
    // DIV counts CPU cycles: 256 of them per increment, speed or not.
    bus.write(0xFF04, 0);
    for (int i = 0; i < 64; i++) bus.tick(4);
    CHECK(bus.read(0xFF04) == 1);
    return true;
}

TEST_CASE(general_hdma_copies_into_vram_at_once) {
    auto bus = makeCgbBus();
    for (int i = 0; i < 0x20; i++) bus.write(gb::u16(0xC100 + i), gb::u8(i + 1));
    bus.write(0xFF51, 0xC1);
    bus.write(0xFF52, 0x00);
    bus.write(0xFF53, 0x08);  // VRAM offset 0x0800 -> 0x8800
    bus.write(0xFF54, 0x00);
    bus.write(0xFF55, 0x01);  // 2 blocks, general purpose
    CHECK(bus.read(0x8800) == 1);
    CHECK(bus.read(0x881F) == 0x20);
    CHECK(bus.read(0xFF55) == 0xFF);  // done
    return true;
}

TEST_CASE(hblank_hdma_copies_one_block_per_hblank) {
    auto bus = makeCgbBus();
    for (int i = 0; i < 0x20; i++) bus.write(gb::u16(0xC100 + i), 0x5A);
    bus.write(0xFF40, 0x91);  // LCD on, in OAM search (mode 2)
    bus.write(0xFF51, 0xC1);
    bus.write(0xFF52, 0x00);
    bus.write(0xFF53, 0x00);
    bus.write(0xFF54, 0x00);
    bus.write(0xFF55, 0x81);  // 2 blocks, HBlank mode
    CHECK(bus.read(0x8000) == 0x00);  // nothing until the first HBlank
    CHECK(bus.read(0xFF55) == 0x01);  // active, 2 blocks left
    for (int i = 0; i < (80 + 172) / 4; i++) bus.tick(4);
    CHECK(bus.read(0x800F) == 0x5A);
    CHECK(bus.read(0x8010) == 0x00);
    CHECK(bus.read(0xFF55) == 0x00);  // active, 1 left
    for (int i = 0; i < 456 / 4; i++) bus.tick(4);
    CHECK(bus.read(0x801F) == 0x5A);
    CHECK(bus.read(0xFF55) == 0xFF);
    return true;
}

TEST_CASE(cgb_background_uses_palette_ram_and_bank1_attributes) {
    auto bus = makeCgbBus();
    // Tile 0 row 0: all pixels colour 1. Tile 0 in VRAM bank 1: colour 2.
    bus.write(0x8000, 0xFF);
    bus.write(0x8001, 0x00);
    bus.write(0xFF4F, 0x01);
    bus.write(0x8000, 0x00);
    bus.write(0x8001, 0xFF);
    // Map entry (0,1) -> attributes: palette 3, tile from bank 1.
    bus.write(0x9801, 0x0B);
    bus.write(0xFF4F, 0x00);
    // Palette 0 colour 1 = pure red; palette 3 colour 2 = pure blue.
    bus.write(0xFF68, 0x80 | 2);
    bus.write(0xFF69, 0x1F);
    bus.write(0xFF69, 0x00);
    bus.write(0xFF68, 0x80 | (3 * 8 + 4));
    bus.write(0xFF69, 0x00);
    bus.write(0xFF69, 0x7C);
    CHECK(bus.read(0xFF68) == (0x80 | 0x40 | (3 * 8 + 6)));  // auto-incremented
    bus.write(0xFF40, 0x91);
    for (int i = 0; i < (80 + 172) / 4; i++) bus.tick(4);
    const auto& picture = bus.ppu().colorFramebuffer();
    CHECK(picture[0] == 0x001F);
    CHECK(picture[8] == 0x7C00);
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
