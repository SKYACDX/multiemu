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
    auto rom = makeRom(2, 0x05, 0x00);  // MBC2 -- not implemented yet
    auto cart = gb::loadCartridge(rom);
    CHECK(cart == nullptr);
    return true;
}

// ---- MBC5 ----

TEST_CASE(mbc5_nine_bit_rom_bank_and_bank_zero_is_allowed) {
    auto rom = makeRom(0x102, 0x19, 0x00);  // 258 banks: needs the ninth bit
    // makeRom stamps banks with a single byte, so 0x101 would read like
    // bank 1; give it a mark of its own.
    rom[0x101 * 0x4000 + 1] = 0xAB;
    auto cart = gb::loadCartridge(rom);
    CHECK(cart != nullptr);
    CHECK(cart->readRom(0x4000) == 1);  // bank 1 at power-on
    cart->writeRom(0x2000, 0x00);
    CHECK(cart->readRom(0x4000) == 0);  // unlike MBC1/3, 0 means 0
    cart->writeRom(0x2000, 0x01);
    cart->writeRom(0x3000, 0x01);       // bank 0x101
    CHECK(cart->readRom(0x4001) == 0xAB);
    CHECK(cart->readRom(0x0000) == 0);  // bank 0 stays fixed below
    return true;
}

TEST_CASE(mbc5_ram_banks_and_battery) {
    auto rom = makeRom(2, 0x1B, 0x03);  // MBC5+RAM+BATTERY, 32KiB = 4 banks
    auto cart = gb::loadCartridge(rom);
    CHECK(cart->hasBattery());
    CHECK(cart->readRam(0xA000) == 0xFF);  // disabled
    cart->writeRom(0x0000, 0x0A);
    cart->writeRom(0x4000, 0x02);
    cart->writeRam(0xA000, 0x42);
    cart->writeRom(0x4000, 0x00);
    CHECK(cart->readRam(0xA000) != 0x42);
    cart->writeRom(0x4000, 0x02);
    CHECK(cart->readRam(0xA000) == 0x42);
    CHECK(cart->ram()[2 * 0x2000] == 0x42);
    return true;
}

// ---- MBC3 ----

TEST_CASE(mbc3_rom_bank_zero_reads_as_one_and_ram_banks) {
    auto rom = makeRom(8, 0x13, 0x03);  // MBC3+RAM+BATTERY
    auto cart = gb::loadCartridge(rom);
    CHECK(cart != nullptr);
    CHECK(cart->hasBattery());
    cart->writeRom(0x2000, 0x00);
    CHECK(cart->readRom(0x4000) == 1);
    cart->writeRom(0x2000, 0x05);
    CHECK(cart->readRom(0x4000) == 5);
    cart->writeRom(0x0000, 0x0A);
    cart->writeRom(0x4000, 0x01);
    cart->writeRam(0xA001, 0x77);
    CHECK(cart->ram()[0x2000 + 1] == 0x77);
    CHECK(cart->ram().size() == 32 * 1024);  // no clock, nothing appended
    return true;
}

std::int64_t g_fakeNow = 1000000;
std::int64_t fakeClock() { return g_fakeNow; }

// Latches, then reads the five clock registers S M H DL DH.
void readClock(gb::Cartridge& cart, gb::u8 out[5]) {
    cart.writeRom(0x6000, 0x00);
    cart.writeRom(0x6000, 0x01);
    for (int i = 0; i < 5; i++) {
        cart.writeRom(0x4000, gb::u8(0x08 + i));
        out[i] = cart.readRam(0xA000);
    }
}

TEST_CASE(mbc3_clock_runs_on_real_time_and_latches) {
    gb::setClockSource(fakeClock);
    g_fakeNow = 1000000;
    auto cart = gb::loadCartridge(makeRom(2, 0x10, 0x03));  // MBC3+TIMER+RAM+BATTERY
    cart->writeRom(0x0000, 0x0A);
    g_fakeNow += 2 * 86400 + 3 * 3600 + 4 * 60 + 5;
    gb::u8 regs[5];
    readClock(*cart, regs);
    CHECK(regs[0] == 5);
    CHECK(regs[1] == 4);
    CHECK(regs[2] == 3);
    CHECK(regs[3] == 2);
    CHECK(regs[4] == 0);
    // Latched: time moving on changes nothing until the next latch.
    g_fakeNow += 10;
    cart->writeRom(0x4000, 0x08);
    CHECK(cart->readRam(0xA000) == 5);
    gb::setClockSource(nullptr);
    return true;
}

TEST_CASE(mbc3_clock_halts_and_can_be_set) {
    gb::setClockSource(fakeClock);
    g_fakeNow = 5000;
    auto cart = gb::loadCartridge(makeRom(2, 0x10, 0x03));
    cart->writeRom(0x0000, 0x0A);
    // Halt, set 23:59:50 on day 300, resume -- what a game's clock setup does.
    cart->writeRom(0x4000, 0x0C);
    cart->writeRam(0xA000, 0x40);
    cart->writeRom(0x4000, 0x08);
    cart->writeRam(0xA000, 50);
    cart->writeRom(0x4000, 0x09);
    cart->writeRam(0xA000, 59);
    cart->writeRom(0x4000, 0x0A);
    cart->writeRam(0xA000, 23);
    cart->writeRom(0x4000, 0x0B);
    cart->writeRam(0xA000, 300 & 0xFF);
    cart->writeRom(0x4000, 0x0C);
    cart->writeRam(0xA000, 0x40 | (300 >> 8));
    g_fakeNow += 1000;  // halted: none of this counts
    cart->writeRom(0x4000, 0x0C);
    cart->writeRam(0xA000, 300 >> 8);  // resume
    g_fakeNow += 15;
    gb::u8 regs[5];
    readClock(*cart, regs);
    CHECK(regs[0] == 5);
    CHECK(regs[1] == 0);
    CHECK(regs[2] == 0);
    CHECK((regs[3] | ((regs[4] & 1) << 8)) == 301);
    CHECK(!(regs[4] & 0x40));
    gb::setClockSource(nullptr);
    return true;
}

TEST_CASE(mbc3_day_counter_overflow_sets_the_carry) {
    gb::setClockSource(fakeClock);
    g_fakeNow = 0;
    auto cart = gb::loadCartridge(makeRom(2, 0x0F, 0x00));  // MBC3+TIMER+BATTERY
    cart->writeRom(0x0000, 0x0A);
    g_fakeNow += 513LL * 86400;
    gb::u8 regs[5];
    readClock(*cart, regs);
    CHECK(regs[4] & 0x80);
    CHECK(regs[3] == 1);  // day 513 wraps to 1
    gb::setClockSource(nullptr);
    return true;
}

TEST_CASE(mbc3_save_carries_the_clock_across_sessions) {
    gb::setClockSource(fakeClock);
    g_fakeNow = 100000;
    auto cart = gb::loadCartridge(makeRom(2, 0x10, 0x02));  // 8KiB RAM + clock
    cart->writeRom(0x0000, 0x0A);
    cart->writeRam(0xA000, 0x99);
    g_fakeNow += 3600;  // one hour played
    const std::vector<gb::u8> save = cart->ram();
    CHECK(save.size() == 8 * 1024 + 48);
    // The same bytes again a second later: nothing to write back.
    g_fakeNow += 1;
    CHECK(cart->ram() == save);

    // A day later, a fresh session loads it: 1 hour + 1 day + 1 second.
    g_fakeNow += 86400;
    auto again = gb::loadCartridge(makeRom(2, 0x10, 0x02));
    again->loadRam(save);
    again->writeRom(0x0000, 0x0A);
    CHECK(again->readRam(0xA000) == 0x99);
    gb::u8 regs[5];
    readClock(*again, regs);
    CHECK(regs[2] == 1);
    CHECK(regs[3] == 1);
    CHECK(regs[0] == 1);
    gb::setClockSource(nullptr);
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
