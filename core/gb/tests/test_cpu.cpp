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

TEST_CASE(cb_bit_sets_zero_only_when_the_bit_is_clear) {
    FlatBus bus;
    bus.load(0x0100, {0x3E, 0x80,   // LD A,0x80
                       0x37,         // SCF -- BIT must leave C alone
                       0xCB, 0x7F,   // BIT 7,A -> set, so Z clear
                       0xCB, 0x77}); // BIT 6,A -> clear, so Z set
    gb::Cpu cpu(bus);
    cpu.step();
    cpu.step();
    CHECK(cpu.step() == 2);
    CHECK(!cpu.flagZ());
    CHECK(cpu.flagH());
    CHECK(!cpu.flagN());
    CHECK(cpu.flagC());
    cpu.step();
    CHECK(cpu.flagZ());
    return true;
}

TEST_CASE(cb_swap_and_srl) {
    FlatBus bus;
    bus.load(0x0100, {0x06, 0xF1,   // LD B,0xF1
                       0xCB, 0x30,   // SWAP B -> 0x1F
                       0xCB, 0x38}); // SRL B -> 0x0F, C from bit 0
    gb::Cpu cpu(bus);
    cpu.step();
    cpu.step();
    CHECK(cpu.b() == 0x1F);
    CHECK(!cpu.flagC());
    CHECK(!cpu.flagZ());
    cpu.step();
    CHECK(cpu.b() == 0x0F);
    CHECK(cpu.flagC());
    return true;
}

TEST_CASE(cb_rl_and_rr_go_through_the_carry) {
    FlatBus bus;
    bus.load(0x0100, {0x0E, 0x80,   // LD C,0x80
                       0x37,         // SCF
                       0xCB, 0x11,   // RL C: 0x80 -> 0x01 (old carry in), C=1
                       0xCB, 0x19}); // RR C: 0x01 -> 0x80 (carry in), C=1
    gb::Cpu cpu(bus);
    cpu.step();
    cpu.step();
    cpu.step();
    CHECK(cpu.c() == 0x01);
    CHECK(cpu.flagC());
    cpu.step();
    CHECK(cpu.c() == 0x80);
    CHECK(cpu.flagC());
    return true;
}

TEST_CASE(cb_rlc_rrc_sla_sra) {
    FlatBus bus;
    bus.load(0x0100, {0x16, 0x81,   // LD D,0x81
                       0xCB, 0x02,   // RLC D -> 0x03, C=1
                       0xCB, 0x0A,   // RRC D -> 0x81, C=1
                       0xCB, 0x22,   // SLA D -> 0x02, C=1
                       0x1E, 0x82,   // LD E,0x82
                       0xCB, 0x2B}); // SRA E -> 0xC1, C=0
    gb::Cpu cpu(bus);
    cpu.step();
    cpu.step();
    CHECK(cpu.d() == 0x03);
    CHECK(cpu.flagC());
    cpu.step();
    CHECK(cpu.d() == 0x81);
    CHECK(cpu.flagC());
    cpu.step();
    CHECK(cpu.d() == 0x02);
    CHECK(cpu.flagC());
    cpu.step();
    cpu.step();
    CHECK(cpu.e() == 0xC1);
    CHECK(!cpu.flagC());
    return true;
}

TEST_CASE(cb_zero_result_sets_z_unlike_rlca) {
    FlatBus bus;
    bus.load(0x0100, {0x3E, 0x80,   // LD A,0x80
                       0xCB, 0x27}); // SLA A -> 0x00: Z and C
    gb::Cpu cpu(bus);
    cpu.step();
    cpu.step();
    CHECK(cpu.a() == 0x00);
    CHECK(cpu.flagZ());
    CHECK(cpu.flagC());
    return true;
}

TEST_CASE(cb_on_hl_memory_and_its_timing) {
    FlatBus bus;
    bus.load(0xC000, {0x10});
    bus.load(0x0100, {0x21, 0x00, 0xC0,  // LD HL,0xC000
                       0xCB, 0xC6,        // SET 0,(HL) -> 0x11
                       0xCB, 0x96,        // RES 2,(HL) -> no change (bit clear)
                       0xCB, 0xA6,        // RES 4,(HL) -> 0x01
                       0xCB, 0x46});      // BIT 0,(HL)
    gb::Cpu cpu(bus);
    cpu.step();
    CHECK(cpu.step() == 4);
    CHECK(bus.read(0xC000) == 0x11);
    cpu.step();
    CHECK(bus.read(0xC000) == 0x11);
    cpu.step();
    CHECK(bus.read(0xC000) == 0x01);
    CHECK(cpu.step() == 3);
    CHECK(!cpu.flagZ());
    return true;
}

TEST_CASE(cb_res_and_set_leave_flags_alone) {
    FlatBus bus;
    bus.load(0x0100, {0x37,         // SCF: N=0 H=0 C=1, Z kept from boot
                       0xCB, 0xFF,   // SET 7,A
                       0xCB, 0x87}); // RES 0,A
    gb::Cpu cpu(bus);
    cpu.step();
    const gb::u8 flags = cpu.f();
    cpu.step();
    cpu.step();
    CHECK(cpu.f() == flags);
    return true;
}

TEST_CASE(daa_after_addition) {
    FlatBus bus;
    bus.load(0x0100, {0x3E, 0x45,   // LD A,0x45
                       0xC6, 0x38,   // ADD A,0x38 -> 0x7D
                       0x27,         // DAA -> 0x83 (45 + 38 = 83)
                       0x3E, 0x99,   // LD A,0x99
                       0xC6, 0x01,   // ADD A,0x01 -> 0x9A
                       0x27});       // DAA -> 0x00, carry out (99 + 1 = 100)
    gb::Cpu cpu(bus);
    cpu.step();
    cpu.step();
    cpu.step();
    CHECK(cpu.a() == 0x83);
    CHECK(!cpu.flagC());
    cpu.step();
    cpu.step();
    cpu.step();
    CHECK(cpu.a() == 0x00);
    CHECK(cpu.flagZ());
    CHECK(cpu.flagC());
    CHECK(!cpu.flagH());
    return true;
}

TEST_CASE(daa_after_subtraction) {
    FlatBus bus;
    bus.load(0x0100, {0x3E, 0x10,   // LD A,0x10
                       0xD6, 0x01,   // SUB 0x01 -> 0x0F, H set
                       0x27,         // DAA -> 0x09 (10 - 1 = 9)
                       0x3E, 0x00,   // LD A,0x00
                       0xD6, 0x01,   // SUB 0x01 -> 0xFF, H and C set
                       0x27});       // DAA -> 0x99, borrow kept (0 - 1 = 99)
    gb::Cpu cpu(bus);
    cpu.step();
    cpu.step();
    cpu.step();
    CHECK(cpu.a() == 0x09);
    CHECK(cpu.flagN());
    cpu.step();
    cpu.step();
    cpu.step();
    CHECK(cpu.a() == 0x99);
    CHECK(cpu.flagC());
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

TEST_CASE(interrupt_dispatched_when_ime_set_and_pending) {
    FlatBus bus;
    bus.load(0x0100, {0xFB,   // EI
                       0x00,  // NOP (EI's effect is immediate in this model)
                       0x00});
    bus.write(0xFFFF, 0x01);  // IE: VBlank enabled
    bus.write(0xFF0F, 0x01);  // IF: VBlank pending
    gb::Cpu cpu(bus);

    cpu.step();  // EI
    CHECK(cpu.interruptsEnabled());
    int cycles = cpu.step();  // should dispatch the interrupt instead of running the NOP
    CHECK(cycles == 5);
    CHECK(cpu.pc() == 0x0040);
    CHECK(!cpu.interruptsEnabled());
    CHECK((bus.read(0xFF0F) & 0x01) == 0);  // IF bit cleared
    CHECK(cpu.sp() == 0xFFFC);              // return address was pushed
    return true;
}

TEST_CASE(halt_wakes_without_dispatch_when_ime_disabled) {
    FlatBus bus;
    bus.load(0x0100, {0xF3,   // DI
                       0x76,  // HALT
                       0x00});
    gb::Cpu cpu(bus);
    cpu.step();  // DI
    cpu.step();  // HALT
    CHECK(cpu.halted());

    bus.write(0xFFFF, 0x01);  // IE: VBlank enabled
    bus.write(0xFF0F, 0x01);  // IF: VBlank pending, but IME is off

    cpu.step();  // should wake from HALT without servicing the interrupt
    CHECK(!cpu.halted());
    CHECK(cpu.pc() == 0x0103);  // fell through to the NOP after HALT, not to 0x0040
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
