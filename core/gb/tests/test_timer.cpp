#include <cstdio>
#include <functional>
#include <vector>

#include "gb/timer.h"

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

TEST_CASE(div_increments_every_256_t_cycles_regardless_of_tac) {
    gb::Timer timer;
    gb::u8 ifReg = 0;
    timer.tick(255, ifReg);
    CHECK(timer.readDiv() == 0);
    timer.tick(1, ifReg);
    CHECK(timer.readDiv() == 1);
    return true;
}

TEST_CASE(div_resets_to_zero_on_write) {
    gb::Timer timer;
    gb::u8 ifReg = 0;
    timer.tick(1000, ifReg);
    CHECK(timer.readDiv() != 0);
    timer.resetDiv();
    CHECK(timer.readDiv() == 0);
    return true;
}

TEST_CASE(tima_does_not_advance_when_timer_disabled) {
    gb::Timer timer;
    gb::u8 ifReg = 0;
    timer.tac = 0x00;  // bit 2 clear = disabled, even though a rate is selected
    timer.tick(10000, ifReg);
    CHECK(timer.tima == 0);
    CHECK(ifReg == 0);
    return true;
}

TEST_CASE(tima_overflow_reloads_tma_and_requests_interrupt) {
    gb::Timer timer;
    gb::u8 ifReg = 0;
    timer.tac = 0x05;  // enabled, fastest rate (every 16 t-cycles)
    timer.tma = 0x10;
    timer.tima = 0xFF;
    timer.tick(16, ifReg);  // exactly one tick: 0xFF -> overflow
    CHECK(timer.tima == 0x10);
    CHECK((ifReg & 0x04) != 0);
    return true;
}

TEST_CASE(tima_increments_at_selected_rate) {
    gb::Timer timer;
    gb::u8 ifReg = 0;
    timer.tac = 0x06;  // enabled, rate = every 64 t-cycles
    timer.tick(64 * 3, ifReg);
    CHECK(timer.tima == 3);
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
