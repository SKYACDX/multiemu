#pragma once
#include "gb/cpu.h"
#include "gb/system_bus.h"

namespace gb {

// Owns the CPU and the real memory bus, and keeps them running in lockstep:
// every m-cycle the CPU spends executing also has to be spent by the timer
// (and, once it exists, the PPU/APU). This is the class the platform layer
// (native Android/iOS bindings, or a native test harness) is expected to
// drive frame-by-frame.
class GameBoy {
   public:
    explicit GameBoy(std::unique_ptr<Cartridge> cartridge)
        : bus_(std::move(cartridge)), cpu_(bus_) {}

    // Runs exactly one CPU step (an instruction, or interrupt dispatch)
    // and advances every other bus-owned device by the same number of
    // t-cycles. Returns the number of m-cycles elapsed.
    int step() {
        int mCycles = cpu_.step();
        bus_.tick(mCycles * 4);
        return mCycles;
    }

    const Cpu& cpu() const { return cpu_; }
    SystemBus& bus() { return bus_; }

   private:
    SystemBus bus_;
    Cpu cpu_;
};

}  // namespace gb
