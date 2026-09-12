#pragma once
#include <array>

#include "gb/types.h"

namespace gb {

// The sound hardware: two square channels, one wave channel and one noise
// channel (0xFF10-0xFF3F, plus wave RAM at 0xFF30-0xFF3F).
//
// Timing model, in the same spirit as Timer and Ppu: channel timers and the
// frame sequencer are counted in t-cycles rather than reproduced gate by
// gate. Two deliberate simplifications follow from that:
//
//  - The frame sequencer runs free at 512Hz instead of being clocked off a
//    bit of the internal DIV counter. Real hardware resets its phase when
//    DIV is written, which a handful of games use to nudge envelope timing;
//    nothing here reproduces that.
//  - Output is resampled by picking the channels' current level at each
//    output sample instead of averaging everything in between, so very
//    high-frequency content aliases rather than filtering away.
//
// Both are audible only in material written to exploit them. Revisit if a
// specific game needs it -- the same call Ppu's scanline renderer makes.
class Apu {
   public:
    // Output is produced at this rate, in interleaved stereo, which is what
    // every platform layer in this project wants (see the Android and
    // desktop bindings). The Game Boy itself has no notion of a sample
    // rate: it drives a DAC continuously.
    static constexpr int kSampleRate = 48000;

    // Advances by tCycles (t-cycles, i.e. 4x the m-cycles Cpu::step()
    // returns), generating output samples as it goes.
    void tick(int tCycles);

    u8 readRegister(u16 address) const;
    void writeRegister(u16 address, u8 value);

    // Stereo frames ready to be read. One frame is two samples.
    int samplesAvailable() const { return queueSize_; }

    // Copies up to maxFrames stereo frames into out (which must hold
    // maxFrames*2 samples) and drops them from the queue. Returns the number
    // of frames actually written.
    int readSamples(i16* out, int maxFrames);

   private:
    // One of the two square-wave channels. Channel 1 is the only one with a
    // frequency sweep; for channel 2 the sweep fields simply stay zero.
    struct Square {
        bool enabled = false;
        bool dacEnabled = false;

        u8 duty = 0;         // NRx1 bits 6-7, index into the duty table
        int dutyStep = 0;    // which eighth of the waveform is playing
        int timer = 0;       // t-cycles until the next duty step
        u16 frequency = 0;   // NRx3 + NRx4 bits 0-2

        int lengthCounter = 0;
        bool lengthEnabled = false;

        u8 volume = 0;
        u8 envelopeInitial = 0;
        bool envelopeAdd = false;
        u8 envelopePeriod = 0;
        int envelopeTimer = 0;

        // Channel 1 only (NR10).
        u8 sweepPace = 0;
        bool sweepNegate = false;
        u8 sweepStep = 0;
        int sweepTimer = 0;
        u16 sweepShadow = 0;
        bool sweepActive = false;

        void trigger();
        void tick(int tCycles);
        void clockLength();
        void clockEnvelope();
        void clockSweep();
        u16 nextSweepFrequency();
        u8 output() const;
    };

    struct Wave {
        bool enabled = false;
        bool dacEnabled = false;

        int position = 0;  // which of the 32 nibbles is playing
        int timer = 0;
        u16 frequency = 0;
        u8 volumeShift = 0;  // NR32: 0 = mute, then 100%, 50%, 25%

        int lengthCounter = 0;
        bool lengthEnabled = false;

        std::array<u8, 16> ram{};  // 0xFF30-0xFF3F, two 4-bit samples each

        void trigger();
        void tick(int tCycles);
        void clockLength();
        u8 output() const;
    };

    struct Noise {
        bool enabled = false;
        bool dacEnabled = false;

        u16 lfsr = 0x7FFF;
        bool shortMode = false;  // NR43 bit 3: 7-bit instead of 15-bit
        u8 clockShift = 0;
        u8 divisorCode = 0;
        int timer = 0;

        int lengthCounter = 0;
        bool lengthEnabled = false;

        u8 volume = 0;
        u8 envelopeInitial = 0;
        bool envelopeAdd = false;
        u8 envelopePeriod = 0;
        int envelopeTimer = 0;

        void trigger();
        void tick(int tCycles);
        void clockLength();
        void clockEnvelope();
        u8 output() const;
    };

    void clockFrameSequencer();
    void pushSample();

    Square square1_;
    Square square2_;
    Wave wave_;
    Noise noise_;

    bool powered_ = false;  // NR52 bit 7
    u8 leftVolume_ = 0;     // NR50 bits 4-6
    u8 rightVolume_ = 0;    // NR50 bits 0-2
    u8 panning_ = 0;        // NR51

    int frameSequencerTimer_ = 0;
    int frameSequencerStep_ = 0;

    // Fixed-point accumulator for the pull down from the CPU clock to
    // kSampleRate: one output sample every kCpuClockHz / kSampleRate
    // t-cycles, which is not a whole number.
    //
    // 64-bit because the step is tCycles * kSampleRate. Real callers pass
    // one instruction's worth at a time and would never come close, but a
    // caller that advances a whole second in one go overflows 32 bits and
    // silently stops producing audio.
    long long sampleAccumulator_ = 0;

    // Big enough for well over a frame's worth of audio, so a caller that
    // drains once per frame never loses any. Older samples are dropped if
    // nobody reads (a headless run, say), which is better than growing
    // without bound.
    static constexpr int kQueueFrames = 4096;
    std::array<i16, kQueueFrames * 2> queue_{};
    int queueSize_ = 0;
};

}  // namespace gb
