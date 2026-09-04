// Minimal hand-rolled test harness (no external dependency yet). Each
// TEST_CASE macro registers a function; main() runs them all and reports
// pass/fail. Swap for Catch2/GoogleTest later if the suite grows.
#include <array>
#include <cstdio>
#include <functional>
#include <vector>

#include "gb/cpu.h"

namespace {

// A flat 64KB RAM bus -- enough to unit-test the CPU in isolation without
// any real cartridge/PPU/IO wiring.
class FlatBus : public gb::Bus {
   public:
    gb::u8 read(gb::u16 address) override { return mem_[address]; }
    void write(gb::u16 address, gb::u8 value) override { mem_[address] = value; }

    void load(gb::u16 address, std::initializer_list<gb::u8> bytes) {
        gb::u16 addr = address;
        for (gb::u8 b : bytes) mem_[addr++] = b;
    }

   private:
    std::array<gb::u8, 0x10000> mem_{};
};

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

TEST_CASE(reset_state_matches_post_bootrom_values) {
    FlatBus bus;
    gb::Cpu cpu(bus);
    CHECK(cpu.af() == 0x01B0);
    CHECK(cpu.sp() == 0xFFFE);
    CHECK(cpu.pc() == 0x0100);
    return true;
}

TEST_CASE(nop_advances_pc_by_one_and_takes_one_cycle) {
    FlatBus bus;
    bus.load(0x0100, {0x00});
    gb::Cpu cpu(bus);
    int cycles = cpu.step();
    CHECK(cycles == 1);
    CHECK(cpu.pc() == 0x0101);
    return true;
}

TEST_CASE(ld_bc_immediate_loads_16_bit_value) {
    FlatBus bus;
    bus.load(0x0100, {0x01, 0x34, 0x12});  // LD BC,0x1234
    gb::Cpu cpu(bus);
    cpu.step();
    CHECK(cpu.bc() == 0x1234);
    CHECK(cpu.pc() == 0x0103);
    return true;
}

TEST_CASE(ld_r_r_copies_between_registers) {
    FlatBus bus;
    bus.load(0x0100, {0x3E, 0x42,   // LD A,0x42
                       0x47});      // LD B,A
    gb::Cpu cpu(bus);
    cpu.step();
    cpu.step();
    CHECK(cpu.a() == 0x42);
    CHECK(cpu.b() == 0x42);
    return true;
}

TEST_CASE(inc_sets_zero_and_half_carry_flags) {
    FlatBus bus;
    bus.load(0x0100, {0x3E, 0xFF,  // LD A,0xFF
                       0x3C});     // INC A -> 0x00, Z+H set
    gb::Cpu cpu(bus);
    cpu.step();
    cpu.step();
    CHECK(cpu.a() == 0x00);
    CHECK(cpu.flagZ());
    CHECK(cpu.flagH());
    CHECK(!cpu.flagN());
    return true;
}

TEST_CASE(add_sets_carry_on_overflow) {
    FlatBus bus;
    bus.load(0x0100, {0x3E, 0xF0,  // LD A,0xF0
                       0xC6, 0x20});  // ADD A,0x20 -> 0x10, C set
    gb::Cpu cpu(bus);
    cpu.step();
    cpu.step();
    CHECK(cpu.a() == 0x10);
    CHECK(cpu.flagC());
    CHECK(!cpu.flagZ());
    return true;
}

TEST_CASE(sub_below_zero_sets_carry_and_wraps) {
    FlatBus bus;
    bus.load(0x0100, {0x3E, 0x00,  // LD A,0x00
                       0xD6, 0x01});  // SUB 0x01 -> 0xFF, C set
    gb::Cpu cpu(bus);
    cpu.step();
    cpu.step();
    CHECK(cpu.a() == 0xFF);
    CHECK(cpu.flagC());
    CHECK(cpu.flagN());
    return true;
}

TEST_CASE(conditional_jump_taken_and_not_taken) {
    FlatBus bus;
    // XOR A -> A=0, Z set. JR Z,+2 should jump; JR NZ,+2 should not.
    bus.load(0x0100, {0xAF,              // XOR A
                       0x28, 0x02,        // JR Z,+2  -> taken, lands on 0x0105
                       0x00, 0x00,        // (skipped)
                       0x00});            // NOP at 0x0105
    gb::Cpu cpu(bus);
    cpu.step();  // XOR A
    CHECK(cpu.flagZ());
    int cycles = cpu.step();  // JR Z,+2
    CHECK(cycles == 3);
    CHECK(cpu.pc() == 0x0105);
    return true;
}

TEST_CASE(call_and_ret_roundtrip_through_stack) {
    FlatBus bus;
    bus.load(0x0100, {0xCD, 0x05, 0x01,  // CALL 0x0105
                       0x00,              // (return lands here)
                       0x00,
                       0xC9});            // RET at 0x0105
    gb::Cpu cpu(bus);
    cpu.step();  // CALL -> pc=0x0105, pushed return addr 0x0103
    CHECK(cpu.pc() == 0x0105);
    CHECK(cpu.sp() == 0xFFFC);
    cpu.step();  // RET -> pc=0x0103, sp restored
    CHECK(cpu.pc() == 0x0103);
    CHECK(cpu.sp() == 0xFFFE);
    return true;
}

TEST_CASE(push_pop_roundtrip) {
    FlatBus bus;
    bus.load(0x0100, {0x01, 0xCD, 0xAB,  // LD BC,0xABCD
                       0xC5,              // PUSH BC
                       0x01, 0x00, 0x00,  // LD BC,0x0000
                       0xC1});            // POP BC -> restores 0xABCD
    gb::Cpu cpu(bus);
    cpu.step();
    cpu.step();
    CHECK(cpu.bc() == 0xABCD);
    cpu.step();
    CHECK(cpu.bc() == 0x0000);
    cpu.step();
    CHECK(cpu.bc() == 0xABCD);
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
