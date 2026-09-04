#include <cstdio>
#include <cstring>
#include <functional>
#include <vector>

#include "gb/cartridge.h"

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

// Builds a minimal-but-valid header so loadCartridge() accepts the ROM.
// romBanks * 16KiB total size; type/ramCode as requested.
std::vector<gb::u8> makeRom(std::size_t romBanks, gb::u8 type, gb::u8 ramCode) {
    std::vector<gb::u8> rom(romBanks * 0x4000, 0x00);
    rom[0x147] = type;
    rom[0x148] = 0;  // size code is only used by real hardware/boot logo checks; loadCartridge derives bank count from the vector itself
    rom[0x149] = ramCode;
    // Stamp each bank's first byte with its own index so bank-switching
    // tests can tell which bank is currently mapped in.
    for (std::size_t b = 0; b < romBanks; b++) rom[b * 0x4000] = gb::u8(b);
    return rom;
}

TEST_CASE(rom_only_reads_flat_rom_and_ignores_writes) {
    auto rom = makeRom(2, 0x00, 0x00);
    auto cart = gb::loadCartridge(rom);
    CHECK(cart != nullptr);
    CHECK(cart->readRom(0x0000) == 0);      // bank 0 stamp
    CHECK(cart->readRom(0x4000) == 1);      // bank 1 stamp, fixed (no mapper)
    cart->writeRom(0x2000, 0xFF);           // no mapper registers -- must be a no-op
    CHECK(cart->readRom(0x4000) == 1);
    CHECK(cart->readRam(0xA000) == 0xFF);   // no RAM at all
    return true;
}

TEST_CASE(mbc1_switches_rom_banks_via_0x2000_writes) {
    auto rom = makeRom(4, 0x01, 0x00);  // MBC1, no RAM, 4 banks of 16KiB
    auto cart = gb::loadCartridge(rom);
    CHECK(cart != nullptr);
    CHECK(cart->readRom(0x0000) == 0);   // bank 0 always fixed
    CHECK(cart->readRom(0x4000) == 1);   // register defaults such that bank 1 is visible
    cart->writeRom(0x2000, 2);
    CHECK(cart->readRom(0x4000) == 2);
    cart->writeRom(0x2000, 3);
    CHECK(cart->readRom(0x4000) == 3);
    return true;
}

TEST_CASE(mbc1_bank_register_zero_reads_as_one) {
    auto rom = makeRom(4, 0x01, 0x00);
    auto cart = gb::loadCartridge(rom);
    cart->writeRom(0x2000, 0);  // hardware quirk: writing 0 behaves like 1
    CHECK(cart->readRom(0x4000) == 1);
    return true;
}

TEST_CASE(mbc1_ram_requires_enable_write) {
    auto rom = makeRom(2, 0x03, 0x02);  // MBC1+RAM+BATTERY, 8KiB RAM
    auto cart = gb::loadCartridge(rom);
    CHECK(cart != nullptr);
    CHECK(cart->hasBattery());

    CHECK(cart->readRam(0xA000) == 0xFF);  // disabled by default
    cart->writeRam(0xA000, 0x42);          // dropped, RAM disabled
    CHECK(cart->readRam(0xA000) == 0xFF);

    cart->writeRom(0x0000, 0x0A);  // enable RAM
    cart->writeRam(0xA000, 0x42);
    CHECK(cart->readRam(0xA000) == 0x42);

    cart->writeRom(0x0000, 0x00);  // disable again
    CHECK(cart->readRam(0xA000) == 0xFF);
    return true;
}

TEST_CASE(unsupported_mapper_type_returns_null) {
    auto rom = makeRom(2, 0x1B, 0x00);  // MBC5+RAM+BATTERY -- not implemented yet
    auto cart = gb::loadCartridge(rom);
    CHECK(cart == nullptr);
    return true;
}

TEST_CASE(too_short_rom_returns_null) {
    std::vector<gb::u8> rom(0x100, 0);  // shorter than the header itself
    CHECK(gb::loadCartridge(rom) == nullptr);
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
