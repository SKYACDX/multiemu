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
