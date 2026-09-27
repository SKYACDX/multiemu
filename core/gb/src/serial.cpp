#include "gb/serial.h"

namespace gb {

void Serial::writeSc(u8 value) {
    sc_ = value & 0x81;
    if (transferring() && drivesClock()) cyclesLeft_ = kTransferCycles;
}

void Serial::tick(int tCycles, u8& ifReg) {
    if (interruptPending_) {
        interruptPending_ = false;
        ifReg |= 0x08;
    }
    if (!transferring() || !drivesClock()) return;

    cyclesLeft_ -= tCycles;
    if (cyclesLeft_ > 0) return;

    // The byte is done. The other side's comes in and ours goes out -- but
    // only if there is another side and it is waiting on our clock. One
    // that is not listening, or is driving its own clock at the same time,
    // is not shifting to our clock, and all we see is the idle line: 0xFF.
    // That is also how Pokemon's Cable Club works out which console leads:
    // both keep trying until one finds the other waiting.
    u8 received = 0xFF;
    if (peer_ && peer_->transferring() && !peer_->drivesClock()) {
        received = peer_->sb_;
        peer_->sb_ = sb_;
        peer_->sc_ &= 0x7F;
        peer_->interruptPending_ = true;
    }
    sb_ = received;
    sc_ &= 0x7F;
    ifReg |= 0x08;
}

void Serial::connect(Serial* peer) {
    if (peer_) peer_->peer_ = nullptr;
    peer_ = peer;
    if (peer_) {
        if (peer_->peer_) peer_->peer_->peer_ = nullptr;
        peer_->peer_ = this;
    }
}

}  // namespace gb
