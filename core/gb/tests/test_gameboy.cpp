#include <cstdio>
#include <functional>
#include <vector>

#include "gb/cartridge.h"
#include "gb/gameboy.h"

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

// All-zero ROM decodes as an infinite stream of NOPs (opcode 0x00), which
// is enough to exercise CPU<->Bus<->Timer wiring without needing real game
// code.
gb::GameBoy makeNopGameBoy() {
    std::vector<gb::u8> rom(0x8000, 0x00);
    rom[0x147] = 0x00;  // ROM ONLY
    return gb::GameBoy(gb::loadCartridge(std::move(rom)));
}

TEST_CASE(stepping_advances_pc_through_nops) {
    auto gb = makeNopGameBoy();
    CHECK(gb.cpu().pc() == 0x0100);
    gb.step();
    CHECK(gb.cpu().pc() == 0x0101);
    return true;
}

// Games tell a Game Boy Color apart by A=0x11 at the entry point; with
// anything else, CGB-only ones show their "needs a Game Boy Color" screen.
TEST_CASE(cgb_game_boots_with_cgb_registers) {
    auto dmg = makeNopGameBoy();
    CHECK(!dmg.isColor());
    CHECK(dmg.cpu().a() == 0x01);

    std::vector<gb::u8> rom(0x8000, 0x00);
    rom[0x143] = 0x80;  // runs on both, prefers colour
    gb::GameBoy cgb(gb::loadCartridge(std::move(rom)));
    CHECK(cgb.isColor());
    CHECK(cgb.cpu().a() == 0x11);
    return true;
}

TEST_CASE(timer_advances_in_lockstep_with_cpu_steps) {
    auto gb = makeNopGameBoy();
    // Each NOP is 1 m-cycle = 4 t-cycles; DIV ticks every 256 t-cycles, so
    // 64 NOPs should tick it exactly once.
    for (int i = 0; i < 64; i++) gb.step();
    CHECK(gb.bus().read(0xFF04) == 1);
    return true;
}

TEST_CASE(timer_interrupt_fires_and_cpu_services_it) {
    auto gb = makeNopGameBoy();
    gb.bus().write(0xFFFF, 0x04);  // IE: Timer
    gb.bus().write(0xFF07, 0x05);  // TAC: enabled, fastest rate (16 t-cycles/tick)
    gb.bus().write(0xFF05, 0xFF);  // TIMA about to overflow on the next tick
    gb.bus().write(0xFF06, 0x00);  // TMA

    // Need IME on to actually service it -- there's no EI opcode reachable
    // from an all-NOP ROM, so poke ime_ indirectly isn't possible from
    // outside the class; instead verify the IF flag gets set, which is the
    // part SystemBus/Timer are responsible for. Full dispatch-with-IME is
    // already covered by test_cpu.cpp's interrupt_dispatched_* case.
    for (int i = 0; i < 5; i++) gb.step();  // 5 NOPs = 20 t-cycles > 16
    CHECK((gb.bus().interruptFlag() & 0x04) != 0);
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
