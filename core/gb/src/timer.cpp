#include "gb/timer.h"

namespace gb {

int Timer::thresholdForClockSelect(u8 select) {
    switch (select & 0x03) {
        case 0: return 1024;  // 4096 Hz
        case 1: return 16;    // 262144 Hz
        case 2: return 64;    // 65536 Hz
        default: return 256;  // 16384 Hz
    }
}

void Timer::tick(int tCycles, u8& ifReg) {
    divSubCycles_ += tCycles;
    while (divSubCycles_ >= 256) {
        divSubCycles_ -= 256;
        div_++;
    }

    if (!(tac & 0x04)) return;  // timer disabled

    timaSubCycles_ += tCycles;
    int threshold = thresholdForClockSelect(tac);
    while (timaSubCycles_ >= threshold) {
        timaSubCycles_ -= threshold;
        if (tima == 0xFF) {
            tima = tma;
            ifReg |= 0x04;  // Timer interrupt (bit 2)
        } else {
            tima++;
        }
    }
}

}  // namespace gb
