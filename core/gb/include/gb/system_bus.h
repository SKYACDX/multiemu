#pragma once
#include <array>
#include <memory>

#include "gb/bus.h"
#include "gb/cartridge.h"
#include "gb/joypad.h"
#include "gb/ppu.h"
#include "gb/timer.h"

namespace gb {

// The real memory bus: routes each address range to the component that
// owns it (see docs/memory_map.md). APU/serial I/O is not implemented
// yet, so that range is stubbed -- reads return 0xFF and writes are
// dropped -- until those components exist.
class SystemBus : public Bus {
   public:
    explicit SystemBus(std::unique_ptr<Cartridge> cartridge) : cartridge_(std::move(cartridge)) {}

    u8 read(u16 address) override;
    void write(u16 address, u8 value) override;

    // Advances every bus-owned device that runs independently of
    // instruction fetch (timer, PPU) by tCycles. Callers drive this with
    // 4x the m-cycles gb::Cpu::step() returns. Returns true exactly once
    // per frame, when the PPU enters VBlank (a full frame is ready).
    bool tick(int tCycles) {
        bool frameReady = ppu_.tick(tCycles, if_);
        timer_.tick(tCycles, if_);
        return frameReady;
    }

    // Platform layer entry point: report a button's current physical
    // state. Safe to call at any time, including mid-frame.
    void setButtonPressed(Button button, bool pressed) { joypad_.setPressed(button, pressed, if_); }

    const Ppu& ppu() const { return ppu_; }
    u8 interruptEnable() const { return ie_; }
    u8 interruptFlag() const { return if_; }
    Cartridge& cartridge() { return *cartridge_; }

   private:
    void dmaTransfer(u8 value);

    std::unique_ptr<Cartridge> cartridge_;
    std::array<u8, 0x2000> wram_{};  // 0xC000-0xDFFF (DMG: no bank switching)
    std::array<u8, 0x7F> hram_{};    // 0xFF80-0xFFFE
    Ppu ppu_;                        // 0x8000-0x9FFF, 0xFE00-0xFE9F, 0xFF40-0xFF4B
    Timer timer_;                    // 0xFF04-0xFF07
    Joypad joypad_;                  // 0xFF00
    u8 ie_ = 0;                      // 0xFFFF
    u8 if_ = 0;                      // 0xFF0F, part of the I/O block but
                                      // modeled explicitly since interrupt
                                      // dispatch will need it before the
                                      // rest of I/O exists.
};

}  // namespace gb
