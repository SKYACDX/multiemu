#pragma once
#include "gb/types.h"

namespace gb {

// DIV/TIMA/TMA/TAC (0xFF04-0xFF07). Not cycle-accurate (real hardware
// detects falling edges on a bit of the internal 16-bit DIV counter,
// which produces subtly different behavior when TAC or DIV is written
// mid-count) -- this is the simpler threshold-counting model, accurate
// enough for the vast majority of games that don't rely on that quirk.
class Timer {
   public:
    // Advances by tCycles (t-cycles, i.e. 4x the m-cycles Cpu::step()
    // returns). Sets bit 2 of *ifReg when TIMA overflows, requesting the
    // Timer interrupt.
    void tick(int tCycles, u8& ifReg);

    u8 readDiv() const { return div_; }
    void resetDiv() {
        div_ = 0;
        divSubCycles_ = 0;
    }

    u8 tima = 0;
    u8 tma = 0;
    u8 tac = 0;

   private:
    static int thresholdForClockSelect(u8 select);

    u8 div_ = 0;
    int divSubCycles_ = 0;
    int timaSubCycles_ = 0;
};

}  // namespace gb
