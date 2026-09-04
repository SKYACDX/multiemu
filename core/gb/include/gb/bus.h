#pragma once
#include "gb/types.h"

namespace gb {

// Abstract memory bus. The real implementation (WRAM/VRAM/I/O/cartridge
// mapper) lives elsewhere; the CPU only ever talks to this interface so it
// can be unit-tested against a flat-RAM fake.
class Bus {
   public:
    virtual ~Bus() = default;
    virtual u8 read(u16 address) = 0;
    virtual void write(u16 address, u8 value) = 0;
};

}  // namespace gb
