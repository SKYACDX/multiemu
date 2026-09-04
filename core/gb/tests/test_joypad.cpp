#include <cstdio>
#include <functional>
#include <vector>

#include "gb/joypad.h"

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

TEST_CASE(unselected_group_reads_all_ones) {
    gb::Joypad joypad;
    gb::u8 ifReg = 0;
    joypad.setPressed(gb::Button::A, true, ifReg);
    joypad.setPressed(gb::Button::Right, true, ifReg);
    // Neither group selected (default selectBits_ = 0x30): low nibble
    // must read as all 1s regardless of what's pressed.
    CHECK((joypad.readRegister() & 0x0F) == 0x0F);
    return true;
}

TEST_CASE(direction_group_reflects_pressed_state_when_selected) {
    gb::Joypad joypad;
    gb::u8 ifReg = 0;
    joypad.writeRegister(0x20);  // select direction group (bit4=0), buttons unselected
    joypad.setPressed(gb::Button::Right, true, ifReg);
    joypad.setPressed(gb::Button::Down, true, ifReg);
    gb::u8 reg = joypad.readRegister();
    CHECK((reg & 0x01) == 0);  // Right pressed -> bit 0 low
    CHECK((reg & 0x08) == 0);  // Down pressed -> bit 3 low
    CHECK((reg & 0x02) != 0);  // Left not pressed -> bit 1 high
    CHECK((reg & 0x04) != 0);  // Up not pressed -> bit 2 high
    return true;
}

TEST_CASE(button_group_reflects_pressed_state_when_selected) {
    gb::Joypad joypad;
    gb::u8 ifReg = 0;
    joypad.writeRegister(0x10);  // select button group (bit5=0), directions unselected
    joypad.setPressed(gb::Button::A, true, ifReg);
    joypad.setPressed(gb::Button::Start, true, ifReg);
    gb::u8 reg = joypad.readRegister();
    CHECK((reg & 0x01) == 0);  // A pressed -> bit 0 low
    CHECK((reg & 0x08) == 0);  // Start pressed -> bit 3 low
    CHECK((reg & 0x02) != 0);  // B not pressed
    return true;
}

TEST_CASE(same_bit_position_used_by_both_groups_stays_independent) {
    gb::Joypad joypad;
    gb::u8 ifReg = 0;
    // Right and A share bit 0. Pressing A must not affect the direction
    // group's reading of bit 0, and vice versa.
    joypad.setPressed(gb::Button::A, true, ifReg);
    joypad.writeRegister(0x20);  // select directions only
    CHECK((joypad.readRegister() & 0x01) != 0);  // Right not pressed, A's press irrelevant here
    joypad.writeRegister(0x10);  // select buttons only
    CHECK((joypad.readRegister() & 0x01) == 0);  // A pressed, reflected now
    return true;
}

TEST_CASE(press_while_group_selected_requests_interrupt) {
    gb::Joypad joypad;
    gb::u8 ifReg = 0;
    joypad.writeRegister(0x20);  // directions selected
    joypad.setPressed(gb::Button::Up, true, ifReg);
    CHECK((ifReg & 0x10) != 0);
    return true;
}

TEST_CASE(press_while_group_not_selected_does_not_request_interrupt) {
    gb::Joypad joypad;
    gb::u8 ifReg = 0;
    joypad.writeRegister(0x20);  // directions selected, buttons NOT selected
    joypad.setPressed(gb::Button::A, true, ifReg);
    CHECK(ifReg == 0);
    return true;
}

TEST_CASE(holding_button_does_not_re_request_interrupt) {
    gb::Joypad joypad;
    gb::u8 ifReg = 0;
    joypad.writeRegister(0x20);
    joypad.setPressed(gb::Button::Up, true, ifReg);
    ifReg = 0;  // simulate the CPU having serviced and cleared it
    joypad.setPressed(gb::Button::Up, true, ifReg);  // still held, not a new press
    CHECK(ifReg == 0);
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
