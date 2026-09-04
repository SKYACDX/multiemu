#include "gb/joypad.h"

namespace gb {

void Joypad::setPressed(Button button, bool pressed, u8& ifReg) {
    bool* field = nullptr;
    bool inDirectionGroup = false;
    switch (button) {
        case Button::Right: field = &right_; inDirectionGroup = true; break;
        case Button::Left: field = &left_; inDirectionGroup = true; break;
        case Button::Up: field = &up_; inDirectionGroup = true; break;
        case Button::Down: field = &down_; inDirectionGroup = true; break;
        case Button::A: field = &a_; break;
        case Button::B: field = &b_; break;
        case Button::Select: field = &select_; break;
        case Button::Start: field = &start_; break;
    }

    bool wasPressed = *field;
    *field = pressed;

    bool groupSelected = inDirectionGroup ? directionsSelected() : buttonsSelected();
    if (pressed && !wasPressed && groupSelected) ifReg |= 0x10;
}

u8 Joypad::readRegister() const {
    u8 lowNibble = 0x0F;
    if (directionsSelected()) {
        if (right_) lowNibble &= ~u8(0x01);
        if (left_) lowNibble &= ~u8(0x02);
        if (up_) lowNibble &= ~u8(0x04);
        if (down_) lowNibble &= ~u8(0x08);
    }
    if (buttonsSelected()) {
        if (a_) lowNibble &= ~u8(0x01);
        if (b_) lowNibble &= ~u8(0x02);
        if (select_) lowNibble &= ~u8(0x04);
        if (start_) lowNibble &= ~u8(0x08);
    }
    return 0xC0 | (selectBits_ & 0x30) | lowNibble;
}

}  // namespace gb
