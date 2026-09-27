#pragma once
#include "gb/types.h"

namespace gb {

// The link cable port: SB (0xFF01), the byte being shifted out and in, and
// SC (0xFF02) -- bit 7 starts a transfer and stays set while it runs, bit 0
// says this side drives the clock.
//
// Two ports joined with connect() behave like two consoles on a cable: when
// the side driving the clock finishes its byte, the two bytes swap and both
// sides get the serial interrupt. With nothing connected, the side driving
// the clock reads back 0xFF, exactly what a real Game Boy does with no
// cable in, and a side waiting for someone else's clock waits forever --
// which is how games notice nobody is there.
//
// Whole bytes, not bit by bit: no game looks at SB halfway through a
// transfer, and swapping at a single moment keeps the two consoles coupled
// at one point in time. For that moment to mean the same thing on both
// sides, whoever drives two linked consoles has to keep them within a few
// cycles of each other -- stepping whichever is behind, one instruction at
// a time.
class Serial {
   public:
    // DMG internal clock: 8192 Hz, eight bits -> 4096 t-cycles per byte.
    static constexpr int kTransferCycles = 4096;

    u8 readSb() const { return sb_; }
    u8 readSc() const { return sc_ | 0x7E; }  // the unused bits read as 1
    void writeSb(u8 value) { sb_ = value; }
    void writeSc(u8 value);

    // Advances a running transfer by tCycles (4x the m-cycles Cpu::step()
    // returns). Sets bit 3 of *ifReg when a transfer finishes, requesting
    // the Serial interrupt.
    void tick(int tCycles, u8& ifReg);

    // Plugs a cable in between this port and another; nullptr pulls it out.
    // Connects both ends, so it only needs calling on one of them.
    void connect(Serial* peer);

   private:
    bool transferring() const { return sc_ & 0x80; }
    bool drivesClock() const { return sc_ & 0x01; }

    u8 sb_ = 0;
    u8 sc_ = 0;
    int cyclesLeft_ = 0;
    Serial* peer_ = nullptr;
    // Set by the other end when it finished a byte for us. Raised into IF
    // on our own next tick, because only our own tick has our IF register.
    bool interruptPending_ = false;
};

}  // namespace gb
