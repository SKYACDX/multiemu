#include <cstdio>
#include <functional>
#include <vector>

#include "gb/apu.h"

namespace {

struct TestCase {
    const char* name;
    std::function<bool()> fn;
};

std::vector<TestCase>& registry() {
    static std::vector<TestCase> r;
    return r;
}

struct Registrar {
    Registrar(const char* name, std::function<bool()> fn) {
        registry().push_back({name, std::move(fn)});
    }
};

#define TEST_CASE(name)                                    \
    static bool name();                                    \
    static Registrar registrar_##name(#name, name);         \
    static bool name()

#define CHECK(cond)                                                     \
    do {                                                                \
        if (!(cond)) {                                                  \
            std::printf("  CHECK failed: %s (line %d)\n", #cond, __LINE__); \
            return false;                                               \
        }                                                                \
    } while (0)

constexpr int kCpuClockHz = 4194304;

// Turns the APU on and sets both master volumes to maximum with every
// channel routed to both sides, which is the state most of these start from.
void powerOn(gb::Apu& apu) {
    apu.writeRegister(0xFF26, 0x80);  // NR52: power
    apu.writeRegister(0xFF24, 0x77);  // NR50: full volume both sides
    apu.writeRegister(0xFF25, 0xFF);  // NR51: everything to both sides
}

// Runs one square-wave note and reports the loudest sample produced.
int peakAfter(gb::Apu& apu, int tCycles) {
    std::vector<gb::i16> buffer(gb::Apu::kSampleRate * 2);
    int peak = 0;
    apu.tick(tCycles);
    const int frames = apu.readSamples(buffer.data(), gb::Apu::kSampleRate);
    for (int i = 0; i < frames * 2; i++) {
        const int magnitude = buffer[i] < 0 ? -buffer[i] : buffer[i];
        if (magnitude > peak) peak = magnitude;
    }
    return peak;
}

TEST_CASE(produces_samples_at_the_declared_rate) {
    gb::Apu apu;
    powerOn(apu);

    // One emulated frame, which is how often a platform layer drains this.
    std::vector<gb::i16> buffer(gb::Apu::kSampleRate * 2);
    apu.tick(kCpuClockHz / 60);

    const int frames = apu.readSamples(buffer.data(), gb::Apu::kSampleRate);
    const int expected = gb::Apu::kSampleRate / 60;
    CHECK(frames > expected - 4 && frames < expected + 4);
    return true;
}

TEST_CASE(silent_until_a_channel_is_triggered) {
    gb::Apu apu;
    powerOn(apu);
    CHECK(peakAfter(apu, kCpuClockHz / 60) == 0);
    return true;
}

TEST_CASE(square_channel_makes_sound_once_triggered) {
    gb::Apu apu;
    powerOn(apu);

    apu.writeRegister(0xFF11, 0x80);  // NR11: 50% duty, length 0
    apu.writeRegister(0xFF12, 0xF0);  // NR12: full volume, no envelope
    apu.writeRegister(0xFF13, 0x00);  // NR13/14: frequency, then trigger
    apu.writeRegister(0xFF14, 0x87);

    CHECK(peakAfter(apu, kCpuClockHz / 60) > 0);
    return true;
}

TEST_CASE(zero_volume_envelope_disables_the_dac) {
    gb::Apu apu;
    powerOn(apu);

    // NR12's top five bits feed the DAC. All zero means the channel cannot
    // make a sound at all, even though it was triggered.
    apu.writeRegister(0xFF11, 0x80);
    apu.writeRegister(0xFF12, 0x00);
    apu.writeRegister(0xFF14, 0x87);

    CHECK((apu.readRegister(0xFF26) & 0x01) == 0);
    CHECK(peakAfter(apu, kCpuClockHz / 60) == 0);
    return true;
}

TEST_CASE(length_counter_stops_the_channel) {
    gb::Apu apu;
    powerOn(apu);

    // Length 63 of 64 steps, clocked at 256Hz, so it expires in ~4ms.
    apu.writeRegister(0xFF11, 0xBF);
    apu.writeRegister(0xFF12, 0xF0);
    apu.writeRegister(0xFF14, 0xC7);  // trigger with length enabled

    CHECK((apu.readRegister(0xFF26) & 0x01) != 0);
    apu.tick(kCpuClockHz / 60);  // one frame is plenty
    CHECK((apu.readRegister(0xFF26) & 0x01) == 0);
    return true;
}

TEST_CASE(panning_routes_channels_to_one_side) {
    gb::Apu apu;
    powerOn(apu);
    apu.writeRegister(0xFF25, 0x10);  // NR51: channel 1 to the left only

    apu.writeRegister(0xFF11, 0x80);
    apu.writeRegister(0xFF12, 0xF0);
    apu.writeRegister(0xFF14, 0x87);

    std::vector<gb::i16> buffer(gb::Apu::kSampleRate * 2);
    apu.tick(kCpuClockHz / 60);
    const int frames = apu.readSamples(buffer.data(), gb::Apu::kSampleRate);

    int leftPeak = 0;
    int rightPeak = 0;
    for (int i = 0; i < frames; i++) {
        const int left = buffer[i * 2] < 0 ? -buffer[i * 2] : buffer[i * 2];
        const int right = buffer[i * 2 + 1] < 0 ? -buffer[i * 2 + 1] : buffer[i * 2 + 1];
        if (left > leftPeak) leftPeak = left;
        if (right > rightPeak) rightPeak = right;
    }
    CHECK(leftPeak > 0);
    CHECK(rightPeak == 0);
    return true;
}

TEST_CASE(powering_off_clears_registers_but_keeps_wave_ram) {
    gb::Apu apu;
    powerOn(apu);
    apu.writeRegister(0xFF30, 0xAB);  // wave RAM
    apu.writeRegister(0xFF25, 0xFF);  // NR51

    apu.writeRegister(0xFF26, 0x00);  // power off

    CHECK(apu.readRegister(0xFF25) == 0x00);
    CHECK(apu.readRegister(0xFF30) == 0xAB);
    // Writes are ignored while off, except to NR52 and wave RAM.
    apu.writeRegister(0xFF25, 0xFF);
    CHECK(apu.readRegister(0xFF25) == 0x00);
    return true;
}

TEST_CASE(unreadable_bits_read_back_as_ones) {
    gb::Apu apu;
    powerOn(apu);
    // NR13 is write-only, and NR14 only exposes its length-enable bit.
    CHECK(apu.readRegister(0xFF13) == 0xFF);
    apu.writeRegister(0xFF14, 0x40);
    CHECK(apu.readRegister(0xFF14) == 0xFF);
    apu.writeRegister(0xFF14, 0x00);
    CHECK(apu.readRegister(0xFF14) == 0xBF);
    return true;
}

TEST_CASE(noise_channel_makes_sound) {
    gb::Apu apu;
    powerOn(apu);

    apu.writeRegister(0xFF21, 0xF0);  // NR42: full volume, no envelope
    apu.writeRegister(0xFF22, 0x00);  // NR43: fastest clock
    apu.writeRegister(0xFF23, 0x80);  // NR44: trigger

    CHECK(peakAfter(apu, kCpuClockHz / 60) > 0);
    return true;
}

TEST_CASE(wave_channel_plays_its_ram) {
    gb::Apu apu;
    powerOn(apu);

    for (gb::u16 address = 0xFF30; address <= 0xFF3F; address++) {
        apu.writeRegister(address, 0xF0);  // alternating max/min nibbles
    }
    apu.writeRegister(0xFF1A, 0x80);  // NR30: DAC on
    apu.writeRegister(0xFF1C, 0x20);  // NR32: full volume
    apu.writeRegister(0xFF1D, 0x00);
    apu.writeRegister(0xFF1E, 0x87);  // trigger

    CHECK(peakAfter(apu, kCpuClockHz / 60) > 0);
    return true;
}

}  // namespace

int main() {
    int failed = 0;
    for (auto& tc : registry()) {
        bool ok = tc.fn();
        std::printf("[%s] %s\n", ok ? "PASS" : "FAIL", tc.name);
        if (!ok) failed++;
    }
    std::printf("%zu tests, %d failed\n", registry().size(), failed);
    return failed == 0 ? 0 : 1;
}
