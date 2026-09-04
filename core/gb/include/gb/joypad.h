#pragma once
#include "gb/types.h"

namespace gb {

enum class Button { Right, Left, Up, Down, A, B, Select, Start };

// P1/JOYP (0xFF00). The register is active-low and multiplexed: the CPU
// selects which group of four buttons it wants to read (directions or
// A/B/Select/Start) via bits 4-5, and reads the pressed state back in
// bits 0-3 of the same byte. Both groups share the same four bit
// positions, so "Right" and "A" both live in bit 0, "Left" and "B" in bit
// 1, and so on.
class Joypad {
   public:
    // Requests the Joypad interrupt (IF bit 4) on a release->press
    // transition of a button in the currently selected group -- matches
    // real hardware, which fires on that edge for the active group only.
    void setPressed(Button button, bool pressed, u8& ifReg);

    u8 readRegister() const;
    void writeRegister(u8 value) { selectBits_ = value & 0x30; }

   private:
    bool directionsSelected() const { return !(selectBits_ & 0x10); }
    bool buttonsSelected() const { return !(selectBits_ & 0x20); }

    bool right_ = false, left_ = false, up_ = false, down_ = false;
    bool a_ = false, b_ = false, select_ = false, start_ = false;
    u8 selectBits_ = 0x30;  // both groups unselected by default
};

}  // namespace gb
