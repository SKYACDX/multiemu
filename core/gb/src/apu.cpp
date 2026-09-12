#include "gb/apu.h"

#include <algorithm>
#include <cstring>

namespace gb {
namespace {

constexpr int kCpuClockHz = 4194304;

// The frame sequencer runs at 512Hz, which drives length counters,
// envelopes and the sweep.
constexpr int kFrameSequencerPeriod = kCpuClockHz / 512;

// Bit patterns for NRx1's four duty settings: 12.5%, 25%, 50%, 75%.
constexpr u8 kDutyTable[4][8] = {
    {0, 0, 0, 0, 0, 0, 0, 1},
    {1, 0, 0, 0, 0, 0, 0, 1},
    {1, 0, 0, 0, 0, 1, 1, 1},
    {0, 1, 1, 1, 1, 1, 1, 0},
};

// NR43's divisor code. Code 0 means half a step, not zero.
constexpr int kNoiseDivisors[8] = {8, 16, 32, 48, 64, 80, 96, 112};

}  // namespace

// ---- Square ------------------------------------------------------------

void Apu::Square::trigger() {
    enabled = dacEnabled;
    if (lengthCounter == 0) lengthCounter = 64;
    timer = (2048 - frequency) * 4;
    envelopeTimer = envelopePeriod;
    volume = envelopeInitial;

    sweepShadow = frequency;
    sweepTimer = sweepPace != 0 ? sweepPace : 8;
    sweepActive = sweepPace != 0 || sweepStep != 0;
    // A trigger with a sweep that shifts recalculates immediately, and the
    // channel dies right there if that overflows -- which is how a few
    // sound effects cut themselves off on purpose.
    if (sweepStep != 0 && nextSweepFrequency() > 2047) enabled = false;
}

void Apu::Square::tick(int tCycles) {
    if (!enabled) return;
    timer -= tCycles;
    while (timer <= 0) {
        timer += (2048 - frequency) * 4;
        dutyStep = (dutyStep + 1) & 7;
    }
}

void Apu::Square::clockLength() {
    if (!lengthEnabled || lengthCounter == 0) return;
    if (--lengthCounter == 0) enabled = false;
}

void Apu::Square::clockEnvelope() {
    if (envelopePeriod == 0) return;
    if (--envelopeTimer > 0) return;

    envelopeTimer = envelopePeriod;
    if (envelopeAdd && volume < 15) {
        volume++;
    } else if (!envelopeAdd && volume > 0) {
        volume--;
    }
}

u16 Apu::Square::nextSweepFrequency() {
    const u16 delta = sweepShadow >> sweepStep;
    return sweepNegate ? static_cast<u16>(sweepShadow - delta) : static_cast<u16>(sweepShadow + delta);
}

void Apu::Square::clockSweep() {
    if (!sweepActive) return;
    if (--sweepTimer > 0) return;

    sweepTimer = sweepPace != 0 ? sweepPace : 8;
    if (sweepPace == 0) return;

    const u16 next = nextSweepFrequency();
    if (next > 2047) {
        enabled = false;
        return;
    }
    if (sweepStep == 0) return;

    sweepShadow = next;
    frequency = next;
    // Hardware runs the calculation a second time purely to check for
    // overflow; the result is discarded.
    if (nextSweepFrequency() > 2047) enabled = false;
}

u8 Apu::Square::output() const {
    if (!enabled || !dacEnabled) return 0;
    return kDutyTable[duty][dutyStep] ? volume : 0;
}

// ---- Wave --------------------------------------------------------------

void Apu::Wave::trigger() {
    enabled = dacEnabled;
    if (lengthCounter == 0) lengthCounter = 256;
    timer = (2048 - frequency) * 2;
    position = 0;
}

void Apu::Wave::tick(int tCycles) {
    if (!enabled) return;
    timer -= tCycles;
    while (timer <= 0) {
        timer += (2048 - frequency) * 2;
        position = (position + 1) & 31;
    }
}

void Apu::Wave::clockLength() {
    if (!lengthEnabled || lengthCounter == 0) return;
    if (--lengthCounter == 0) enabled = false;
}

u8 Apu::Wave::output() const {
    if (!enabled || !dacEnabled || volumeShift == 0) return 0;
    // Two 4-bit samples per byte, high nibble first.
    const u8 byte = ram[position >> 1];
    const u8 sample = (position & 1) ? (byte & 0x0F) : (byte >> 4);
    return sample >> (volumeShift - 1);
}

// ---- Noise -------------------------------------------------------------

void Apu::Noise::trigger() {
    enabled = dacEnabled;
    if (lengthCounter == 0) lengthCounter = 64;
    timer = kNoiseDivisors[divisorCode] << clockShift;
    envelopeTimer = envelopePeriod;
    volume = envelopeInitial;
    lfsr = 0x7FFF;
}

void Apu::Noise::tick(int tCycles) {
    if (!enabled) return;
    timer -= tCycles;
    while (timer <= 0) {
        timer += kNoiseDivisors[divisorCode] << clockShift;
        // XOR the bottom two bits back in at the top; in short mode it also
        // lands at bit 6, which shortens the sequence to 127 steps and is
        // what gives the "tonal" noise setting its pitch.
        const u16 feedback = (lfsr ^ (lfsr >> 1)) & 1;
        lfsr >>= 1;
        lfsr |= feedback << 14;
        if (shortMode) {
            lfsr &= ~(1 << 6);
            lfsr |= feedback << 6;
        }
    }
}

void Apu::Noise::clockLength() {
    if (!lengthEnabled || lengthCounter == 0) return;
    if (--lengthCounter == 0) enabled = false;
}

void Apu::Noise::clockEnvelope() {
    if (envelopePeriod == 0) return;
    if (--envelopeTimer > 0) return;

    envelopeTimer = envelopePeriod;
    if (envelopeAdd && volume < 15) {
        volume++;
    } else if (!envelopeAdd && volume > 0) {
        volume--;
    }
}

u8 Apu::Noise::output() const {
    if (!enabled || !dacEnabled) return 0;
    // Output follows the INVERSE of the low bit.
    return (lfsr & 1) ? 0 : volume;
}

// ---- Apu ---------------------------------------------------------------

void Apu::tick(int tCycles) {
    // Advanced in slices no longer than the gap to the next output sample,
    // so every sample is taken with the channels in the state they are
    // actually in at that moment. Advancing the whole step first and
    // sampling afterwards would give a caller who ticks a frame at a time
    // several hundred identical samples -- a flat tone, or silence,
    // depending on where the duty cycle happened to land.
    //
    // Real callers hand over one instruction's worth at a time, so this
    // almost always runs exactly once.
    while (tCycles > 0) {
        const long long untilNextSample = kCpuClockHz - sampleAccumulator_;
        const int step = static_cast<int>(
            std::min<long long>(tCycles, (untilNextSample + kSampleRate - 1) / kSampleRate));

        if (powered_) {
            square1_.tick(step);
            square2_.tick(step);
            wave_.tick(step);
            noise_.tick(step);

            frameSequencerTimer_ += step;
            while (frameSequencerTimer_ >= kFrameSequencerPeriod) {
                frameSequencerTimer_ -= kFrameSequencerPeriod;
                clockFrameSequencer();
            }
        }

        // Even with the APU off the clock keeps running, so silence takes up
        // its proper amount of time instead of the queue stalling.
        sampleAccumulator_ += static_cast<long long>(step) * kSampleRate;
        if (sampleAccumulator_ >= kCpuClockHz) {
            sampleAccumulator_ -= kCpuClockHz;
            pushSample();
        }

        tCycles -= step;
    }
}

void Apu::clockFrameSequencer() {
    // Length on the even steps, sweep on 2 and 6, envelope on 7.
    if ((frameSequencerStep_ & 1) == 0) {
        square1_.clockLength();
        square2_.clockLength();
        wave_.clockLength();
        noise_.clockLength();
    }
    if (frameSequencerStep_ == 2 || frameSequencerStep_ == 6) {
        square1_.clockSweep();
    }
    if (frameSequencerStep_ == 7) {
        square1_.clockEnvelope();
        square2_.clockEnvelope();
        noise_.clockEnvelope();
    }
    frameSequencerStep_ = (frameSequencerStep_ + 1) & 7;
}

void Apu::pushSample() {
    int left = 0;
    int right = 0;

    if (powered_) {
        const u8 outputs[4] = {square1_.output(), square2_.output(), wave_.output(), noise_.output()};
        for (int channel = 0; channel < 4; channel++) {
            // NR51: low nibble is the right side, high nibble the left.
            if (panning_ & (1 << channel)) right += outputs[channel];
            if (panning_ & (0x10 << channel)) left += outputs[channel];
        }
        // Each side sums four channels of 0-15, then a master volume of
        // 0-7 which hardware treats as a multiplier of 1-8.
        left *= (leftVolume_ + 1);
        right *= (rightVolume_ + 1);
    }

    // 4 channels * 15 * 8 = 480 is full scale; scaled to leave headroom
    // rather than clipping on a loud chord.
    constexpr int kScale = 32767 / (4 * 15 * 8);

    if (queueSize_ >= kQueueFrames) {
        // Nobody is draining. Drop the oldest frame rather than grow.
        std::memmove(queue_.data(), queue_.data() + 2, (kQueueFrames - 1) * 2 * sizeof(i16));
        queueSize_--;
    }
    queue_[queueSize_ * 2] = static_cast<i16>(left * kScale);
    queue_[queueSize_ * 2 + 1] = static_cast<i16>(right * kScale);
    queueSize_++;
}

int Apu::readSamples(i16* out, int maxFrames) {
    const int frames = std::min(maxFrames, queueSize_);
    if (frames <= 0) return 0;

    std::memcpy(out, queue_.data(), frames * 2 * sizeof(i16));
    const int remaining = queueSize_ - frames;
    if (remaining > 0) std::memmove(queue_.data(), queue_.data() + frames * 2, remaining * 2 * sizeof(i16));
    queueSize_ = remaining;
    return frames;
}

// Reads return 1 in every bit the CPU cannot actually see -- length
// counters and the raw frequency are write-only on real hardware, and games
// do read these back, so handing them zeroes would be wrong.
u8 Apu::readRegister(u16 address) const {
    if (address >= 0xFF30 && address <= 0xFF3F) return wave_.ram[address - 0xFF30];

    switch (address) {
        case 0xFF10:
            return 0x80 | (square1_.sweepPace << 4) | (square1_.sweepNegate ? 0x08 : 0) |
                   square1_.sweepStep;
        case 0xFF11:
            return 0x3F | (square1_.duty << 6);
        case 0xFF12:
            return (square1_.envelopeInitial << 4) | (square1_.envelopeAdd ? 0x08 : 0) |
                   square1_.envelopePeriod;
        case 0xFF14:
            return 0xBF | (square1_.lengthEnabled ? 0x40 : 0);
        case 0xFF16:
            return 0x3F | (square2_.duty << 6);
        case 0xFF17:
            return (square2_.envelopeInitial << 4) | (square2_.envelopeAdd ? 0x08 : 0) |
                   square2_.envelopePeriod;
        case 0xFF19:
            return 0xBF | (square2_.lengthEnabled ? 0x40 : 0);
        case 0xFF1A:
            return 0x7F | (wave_.dacEnabled ? 0x80 : 0);
        case 0xFF1C:
            return 0x9F | (wave_.volumeShift << 5);
        case 0xFF1E:
            return 0xBF | (wave_.lengthEnabled ? 0x40 : 0);
        case 0xFF21:
            return (noise_.envelopeInitial << 4) | (noise_.envelopeAdd ? 0x08 : 0) |
                   noise_.envelopePeriod;
        case 0xFF22:
            return (noise_.clockShift << 4) | (noise_.shortMode ? 0x08 : 0) | noise_.divisorCode;
        case 0xFF23:
            return 0xBF | (noise_.lengthEnabled ? 0x40 : 0);
        case 0xFF24:
            return (leftVolume_ << 4) | rightVolume_;
        case 0xFF25:
            return panning_;
        case 0xFF26:
            // Bits 0-3 report which channels are still running, which is how
            // a game waits for a sound effect to finish.
            return 0x70 | (powered_ ? 0x80 : 0) | (square1_.enabled ? 0x01 : 0) |
                   (square2_.enabled ? 0x02 : 0) | (wave_.enabled ? 0x04 : 0) |
                   (noise_.enabled ? 0x08 : 0);
        default:
            return 0xFF;
    }
}

void Apu::writeRegister(u16 address, u8 value) {
    // Wave RAM stays writable with the APU off; everything else is frozen,
    // which is what makes NR52 the only way back on.
    if (address >= 0xFF30 && address <= 0xFF3F) {
        wave_.ram[address - 0xFF30] = value;
        return;
    }
    if (!powered_ && address != 0xFF26) return;

    switch (address) {
        case 0xFF10:
            square1_.sweepPace = (value >> 4) & 0x07;
            square1_.sweepNegate = (value & 0x08) != 0;
            square1_.sweepStep = value & 0x07;
            break;
        case 0xFF11:
            square1_.duty = (value >> 6) & 0x03;
            square1_.lengthCounter = 64 - (value & 0x3F);
            break;
        case 0xFF12:
            square1_.envelopeInitial = (value >> 4) & 0x0F;
            square1_.envelopeAdd = (value & 0x08) != 0;
            square1_.envelopePeriod = value & 0x07;
            // The DAC is powered by the top five bits: all zero and the
            // channel goes silent immediately, without waiting for a length
            // counter.
            square1_.dacEnabled = (value & 0xF8) != 0;
            if (!square1_.dacEnabled) square1_.enabled = false;
            break;
        case 0xFF13:
            square1_.frequency = (square1_.frequency & 0x0700) | value;
            break;
        case 0xFF14:
            square1_.frequency = (square1_.frequency & 0x00FF) | ((value & 0x07) << 8);
            square1_.lengthEnabled = (value & 0x40) != 0;
            if (value & 0x80) square1_.trigger();
            break;

        case 0xFF16:
            square2_.duty = (value >> 6) & 0x03;
            square2_.lengthCounter = 64 - (value & 0x3F);
            break;
        case 0xFF17:
            square2_.envelopeInitial = (value >> 4) & 0x0F;
            square2_.envelopeAdd = (value & 0x08) != 0;
            square2_.envelopePeriod = value & 0x07;
            square2_.dacEnabled = (value & 0xF8) != 0;
            if (!square2_.dacEnabled) square2_.enabled = false;
            break;
        case 0xFF18:
            square2_.frequency = (square2_.frequency & 0x0700) | value;
            break;
        case 0xFF19:
            square2_.frequency = (square2_.frequency & 0x00FF) | ((value & 0x07) << 8);
            square2_.lengthEnabled = (value & 0x40) != 0;
            if (value & 0x80) square2_.trigger();
            break;

        case 0xFF1A:
            wave_.dacEnabled = (value & 0x80) != 0;
            if (!wave_.dacEnabled) wave_.enabled = false;
            break;
        case 0xFF1B:
            // The wave channel's length counter is 256 steps, not 64.
            wave_.lengthCounter = 256 - value;
            break;
        case 0xFF1C:
            wave_.volumeShift = (value >> 5) & 0x03;
            break;
        case 0xFF1D:
            wave_.frequency = (wave_.frequency & 0x0700) | value;
            break;
        case 0xFF1E:
            wave_.frequency = (wave_.frequency & 0x00FF) | ((value & 0x07) << 8);
            wave_.lengthEnabled = (value & 0x40) != 0;
            if (value & 0x80) wave_.trigger();
            break;

        case 0xFF20:
            noise_.lengthCounter = 64 - (value & 0x3F);
            break;
        case 0xFF21:
            noise_.envelopeInitial = (value >> 4) & 0x0F;
            noise_.envelopeAdd = (value & 0x08) != 0;
            noise_.envelopePeriod = value & 0x07;
            noise_.dacEnabled = (value & 0xF8) != 0;
            if (!noise_.dacEnabled) noise_.enabled = false;
            break;
        case 0xFF22:
            noise_.clockShift = (value >> 4) & 0x0F;
            noise_.shortMode = (value & 0x08) != 0;
            noise_.divisorCode = value & 0x07;
            break;
        case 0xFF23:
            noise_.lengthEnabled = (value & 0x40) != 0;
            if (value & 0x80) noise_.trigger();
            break;

        case 0xFF24:
            leftVolume_ = (value >> 4) & 0x07;
            rightVolume_ = value & 0x07;
            break;
        case 0xFF25:
            panning_ = value;
            break;
        case 0xFF26: {
            const bool nowOn = (value & 0x80) != 0;
            if (!nowOn && powered_) {
                // Powering off clears every register, which games rely on to
                // start from a known state.
                square1_ = Square{};
                square2_ = Square{};
                const auto savedRam = wave_.ram;  // wave RAM survives
                wave_ = Wave{};
                wave_.ram = savedRam;
                noise_ = Noise{};
                leftVolume_ = 0;
                rightVolume_ = 0;
                panning_ = 0;
                frameSequencerStep_ = 0;
            }
            powered_ = nowOn;
            break;
        }
        default:
            break;
    }
}

}  // namespace gb
