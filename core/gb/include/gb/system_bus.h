#pragma once
#include <array>
#include <memory>

#include "gb/apu.h"
#include "gb/bus.h"
#include "gb/cartridge.h"
#include "gb/joypad.h"
#include "gb/ppu.h"
#include "gb/serial.h"
#include "gb/timer.h"

namespace gb {

// The real memory bus: routes each address range to the component that
// owns it (see docs/memory_map.md).
class SystemBus : public Bus {
   public:
    // Header byte 0x0143 bit 7 marks a game that knows the Game Boy Color
    // (0x80 runs on both, 0xC0 only on a CGB). Those run in colour mode;
    // everything else stays a DMG.
    explicit SystemBus(std::unique_ptr<Cartridge> cartridge)
        : cartridge_(std::move(cartridge)), cgb_(cartridge_->readRom(0x0143) & 0x80) {
        ppu_.setCgbMode(cgb_);
    }

    u8 read(u16 address) override;
    void write(u16 address, u8 value) override;
    void stop() override;

    bool cgbMode() const { return cgb_; }
    bool doubleSpeed() const { return doubleSpeed_; }

    // Advances every bus-owned device that runs independently of
    // instruction fetch (timer, PPU) by tCycles. Callers drive this with
    // 4x the m-cycles gb::Cpu::step() returns. Returns true exactly once
    // per frame, when the PPU enters VBlank (a full frame is ready).
    //
    // In the CGB's double speed mode tCycles are CPU cycles at twice the
    // clock: the timer and serial port run off the CPU clock and keep up,
    // while the PPU and APU stay at the normal rate and see half as many.
    bool tick(int tCycles) {
        int videoCycles = doubleSpeed_ ? tCycles / 2 : tCycles;
        bool frameReady = ppu_.tick(videoCycles, if_);
        if (ppu_.takeHBlank() && hdmaActive_) hdmaCopyBlock();
        timer_.tick(tCycles, if_);
        serial_.tick(tCycles, if_);
        apu_.tick(videoCycles);
        return frameReady;
    }

    // Platform layer entry point: report a button's current physical
    // state. Safe to call at any time, including mid-frame.
    void setButtonPressed(Button button, bool pressed) { joypad_.setPressed(button, pressed, if_); }

    const Ppu& ppu() const { return ppu_; }
    Apu& apu() { return apu_; }
    // The link cable port. Two consoles are linked by connecting theirs.
    Serial& serial() { return serial_; }
    u8 interruptEnable() const { return ie_; }
    u8 interruptFlag() const { return if_; }
    Cartridge& cartridge() { return *cartridge_; }

   private:
    void dmaTransfer(u8 value);
    void writeHdma5(u8 value);
    void hdmaCopyBlock();
    // 0xC000-0xDFFF and its echo. The upper 4KiB is the bank SVBK picks
    // on a CGB, always bank 1 on a DMG.
    u8& wramAt(u16 address) {
        u16 offset = address & 0x1FFF;
        return offset < 0x1000 ? wram_[offset] : wram_[wramBank_ * 0x1000 + offset - 0x1000];
    }

    std::unique_ptr<Cartridge> cartridge_;
    bool cgb_;
    std::array<u8, 0x8000> wram_{};  // 8 banks of 4KiB; a DMG only has 0 and 1
    int wramBank_ = 1;               // SVBK (0xFF70)
    bool doubleSpeed_ = false;       // KEY1 (0xFF4D) bit 7
    bool speedSwitchArmed_ = false;  // KEY1 bit 0: the next STOP switches speed
    // VRAM DMA (0xFF51-0xFF55): source, destination (offset into VRAM),
    // and 16-byte blocks still to copy. HBlank mode copies one per HBlank.
    u16 hdmaSource_ = 0, hdmaDest_ = 0;
    int hdmaBlocksLeft_ = 0;
    bool hdmaActive_ = false;
    std::array<u8, 0x7F> hram_{};    // 0xFF80-0xFFFE
    Ppu ppu_;                        // 0x8000-0x9FFF, 0xFE00-0xFE9F, 0xFF40-0xFF4B
    Serial serial_;                  // 0xFF01-0xFF02
    Timer timer_;                    // 0xFF04-0xFF07
    Apu apu_;                        // 0xFF10-0xFF3F
    Joypad joypad_;                  // 0xFF00
    u8 ie_ = 0;                      // 0xFFFF
    u8 if_ = 0;                      // 0xFF0F, part of the I/O block but
                                      // modeled explicitly since interrupt
                                      // dispatch will need it before the
                                      // rest of I/O exists.
};

}  // namespace gb
