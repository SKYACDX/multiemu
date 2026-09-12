#pragma once
#include "gb/cpu.h"
#include "gb/system_bus.h"

namespace gb {

// Owns the CPU and the real memory bus, and keeps them running in lockstep:
// every m-cycle the CPU spends executing also has to be spent by the timer
// and PPU. This is the class the platform layer (native Android/iOS
// bindings, or a native test harness) is expected to drive frame-by-frame.
class GameBoy {
   public:
    explicit GameBoy(std::unique_ptr<Cartridge> cartridge)
        : bus_(std::move(cartridge)), cpu_(bus_) {}

    // Runs exactly one CPU step (an instruction, or interrupt dispatch)
    // and advances every other bus-owned device by the same number of
    // t-cycles. Returns the number of m-cycles elapsed. If the PPU
    // completed a frame during this step, frameReady() will report true
    // until the next call to step().
    int step() {
        int mCycles = cpu_.step();
        frameReady_ = bus_.tick(mCycles * 4);
        return mCycles;
    }

    // Runs steps until a full frame has been rendered (frameReady()
    // becomes true), then returns. Convenience for callers that just want
    // "give me the next frame" rather than driving step() by hand.
    void runUntilFrame() {
        do {
            step();
        } while (!frameReady_);
    }

    bool frameReady() const { return frameReady_; }
    const Ppu::Framebuffer& framebuffer() const { return bus_.ppu().framebuffer(); }

    // Platform layer entry point: report a button's current physical
    // state (from touch controls, a gamepad, etc). Safe to call between
    // step() calls at any time.
    void setButtonPressed(Button button, bool pressed) { bus_.setButtonPressed(button, pressed); }

    // Platform layer entry point for sound: drains whatever the APU has
    // produced since the last call, as interleaved stereo at
    // Apu::kSampleRate.
    int readAudio(i16* out, int maxFrames) { return bus_.apu().readSamples(out, maxFrames); }

    const Cpu& cpu() const { return cpu_; }
    SystemBus& bus() { return bus_; }

   private:
    SystemBus bus_;
    Cpu cpu_;
    bool frameReady_ = false;
};

}  // namespace gb
