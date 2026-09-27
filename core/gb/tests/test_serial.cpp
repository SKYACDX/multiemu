#include <cstdio>
#include <functional>
#include <vector>

#include "gb/serial.h"
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

constexpr gb::u8 kSerialInterrupt = 0x08;

TEST_CASE(no_cable_internal_clock_reads_ff_after_a_full_byte) {
    gb::Serial serial;
    gb::u8 ifReg = 0;
    serial.writeSb(0x42);
    serial.writeSc(0x81);
    serial.tick(gb::Serial::kTransferCycles - 4, ifReg);
    CHECK(ifReg == 0);
    CHECK(serial.readSc() & 0x80);  // still running
    serial.tick(4, ifReg);
    CHECK(ifReg == kSerialInterrupt);
    CHECK(serial.readSb() == 0xFF);
    CHECK(!(serial.readSc() & 0x80));
    return true;
}

TEST_CASE(no_cable_external_clock_waits_forever) {
    gb::Serial serial;
    gb::u8 ifReg = 0;
    serial.writeSb(0x42);
    serial.writeSc(0x80);
    serial.tick(gb::Serial::kTransferCycles * 100, ifReg);
    CHECK(ifReg == 0);
    CHECK(serial.readSb() == 0x42);
    CHECK(serial.readSc() & 0x80);
    return true;
}

TEST_CASE(unused_sc_bits_read_as_one) {
    gb::Serial serial;
    CHECK(serial.readSc() == 0x7E);
    serial.writeSc(0x81);
    CHECK(serial.readSc() == 0xFF);
    return true;
}

TEST_CASE(linked_bytes_swap_and_both_sides_are_interrupted) {
    gb::Serial master, slave;
    master.connect(&slave);
    gb::u8 masterIf = 0, slaveIf = 0;

    slave.writeSb(0x22);
    slave.writeSc(0x80);  // waiting on the other side's clock
    master.writeSb(0x11);
    master.writeSc(0x81);

    master.tick(gb::Serial::kTransferCycles, masterIf);
    CHECK(masterIf == kSerialInterrupt);
    CHECK(master.readSb() == 0x22);
    CHECK(slave.readSb() == 0x11);
    CHECK(!(slave.readSc() & 0x80));

    // The slave's interrupt lands on its own next tick, whatever its length.
    CHECK(slaveIf == 0);
    slave.tick(4, slaveIf);
    CHECK(slaveIf == kSerialInterrupt);
    return true;
}

TEST_CASE(linked_but_not_listening_reads_ff_and_leaves_the_other_alone) {
    gb::Serial master, idle;
    master.connect(&idle);
    gb::u8 masterIf = 0, idleIf = 0;
    idle.writeSb(0x22);  // no transfer started on this side
    master.writeSb(0x11);
    master.writeSc(0x81);
    master.tick(gb::Serial::kTransferCycles, masterIf);
    idle.tick(4, idleIf);
    CHECK(master.readSb() == 0xFF);
    CHECK(idle.readSb() == 0x22);
    CHECK(idleIf == 0);
    return true;
}

TEST_CASE(both_driving_the_clock_both_read_ff) {
    // Neither shifts to the other's clock. Pokemon's link handshake relies
    // on this to settle who leads: both retry until one side waits.
    gb::Serial a, b;
    a.connect(&b);
    gb::u8 aIf = 0, bIf = 0;
    a.writeSb(0x01);
    a.writeSc(0x81);
    b.writeSb(0x01);
    b.writeSc(0x81);
    a.tick(gb::Serial::kTransferCycles, aIf);
    b.tick(gb::Serial::kTransferCycles, bIf);
    CHECK(a.readSb() == 0xFF);
    CHECK(b.readSb() == 0xFF);
    return true;
}

TEST_CASE(disconnecting_either_end_unplugs_both) {
    gb::Serial a, b;
    a.connect(&b);
    b.connect(nullptr);
    gb::u8 aIf = 0;
    b.writeSb(0x22);
    b.writeSc(0x80);
    a.writeSc(0x81);
    a.tick(gb::Serial::kTransferCycles, aIf);
    CHECK(a.readSb() == 0xFF);
    return true;
}

TEST_CASE(bus_maps_ff01_ff02_and_ticks_the_port) {
    std::vector<gb::u8> rom(0x8000, 0x00);
    gb::SystemBus bus(gb::loadCartridge(std::move(rom)));
    bus.write(0xFF01, 0x5A);
    CHECK(bus.read(0xFF01) == 0x5A);
    bus.write(0xFF02, 0x81);
    CHECK(bus.read(0xFF02) == 0xFF);
    for (int i = 0; i < gb::Serial::kTransferCycles; i += 4) bus.tick(4);
    CHECK(bus.read(0xFF01) == 0xFF);
    CHECK(bus.interruptFlag() & kSerialInterrupt);
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
