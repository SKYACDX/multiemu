#pragma once
#include <array>
#include <memory>

#include "gb/bus.h"
#include "gb/cartridge.h"

namespace gb {

// The real memory bus: routes each address range to the component that
// owns it (see docs/memory_map.md). VRAM/OAM/IO/timer are not implemented
// yet (no Ppu/Timer wired in), so those ranges are stubbed -- reads return
// 0xFF and writes are dropped -- until those components exist.
class SystemBus : public Bus {
   public:
    explicit SystemBus(std::unique_ptr<Cartridge> cartridge) : cartridge_(std::move(cartridge)) {}

    u8 read(u16 address) override;
    void write(u16 address, u8 value) override;

    u8 interruptEnable() const { return ie_; }
    u8 interruptFlag() const { return if_; }

   private:
    std::unique_ptr<Cartridge> cartridge_;
    std::array<u8, 0x2000> wram_{};  // 0xC000-0xDFFF (DMG: no bank switching)
    std::array<u8, 0x7F> hram_{};    // 0xFF80-0xFFFE
    u8 ie_ = 0;                      // 0xFFFF
    u8 if_ = 0;                      // 0xFF0F, part of the I/O block but
                                      // modeled explicitly since interrupt
                                      // dispatch will need it before the
                                      // rest of I/O exists.
};

}  // namespace gb
