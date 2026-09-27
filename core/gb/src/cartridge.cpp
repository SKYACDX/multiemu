#include "gb/cartridge.h"

#include <algorithm>
#include <ctime>

namespace gb {

namespace {

constexpr u16 kRomBankSize = 0x4000;
constexpr u16 kRamBankSize = 0x2000;

std::int64_t wallClock() { return static_cast<std::int64_t>(std::time(nullptr)); }
ClockSource g_clock = wallClock;

// No mapper at all: a single fixed 32 KiB ROM, no external RAM. Covers the
// handful of very early/simple titles (e.g. Tetris).
class RomOnlyCartridge : public Cartridge {
   public:
    explicit RomOnlyCartridge(std::vector<u8> rom) : rom_(std::move(rom)) {}

    u8 readRom(u16 address) override {
        return address < rom_.size() ? rom_[address] : 0xFF;
    }
    void writeRom(u16, u8) override {}  // no mapper registers to write to
    u8 readRam(u16) override { return 0xFF; }
    void writeRam(u16, u8) override {}

    bool hasBattery() const override { return false; }
    const std::vector<u8>& ram() const override { return ram_; }
    void loadRam(const std::vector<u8>&) override {}

   private:
    std::vector<u8> rom_;
    std::vector<u8> ram_;  // always empty
};

// MBC1: 5-bit ROM bank register + 2-bit secondary register whose meaning
// (extra ROM bank bits vs. RAM bank) depends on the banking mode. Covers a
// large fraction of the commercial GB/GBC library.
class Mbc1Cartridge : public Cartridge {
   public:
    Mbc1Cartridge(std::vector<u8> rom, std::size_t ramBytes, bool hasBattery)
        : rom_(std::move(rom)),
          ram_(ramBytes, 0xFF),
          hasBattery_(hasBattery),
          romBankCount_(static_cast<u32>(rom_.size() / kRomBankSize)),
          ramBankCount_(static_cast<u32>(ramBytes / kRamBankSize)) {}

    u8 readRom(u16 address) override {
        u32 bank = 0;
        if (address < 0x4000) {
            // In "RAM banking mode" (mode=1) with a large enough ROM, the
            // secondary 2-bit register also selects which bank is visible
            // at 0x0000-0x3FFF; otherwise it's always bank 0.
            if (mode_ && romBankCount_ > 0) bank = (u32(bank2_) << 5) % romBankCount_;
        } else {
            u32 lowBits = romBankLow_ == 0 ? 1 : romBankLow_;  // hardware quirk: 0 reads as 1
            bank = (u32(bank2_) << 5) | lowBits;
            if (romBankCount_ > 0) bank %= romBankCount_;
            address -= 0x4000;
        }
        std::size_t offset = std::size_t(bank) * kRomBankSize + address;
        return offset < rom_.size() ? rom_[offset] : 0xFF;
    }

    void writeRom(u16 address, u8 value) override {
        if (address <= 0x1FFF) {
            ramEnabled_ = (value & 0x0F) == 0x0A;
        } else if (address <= 0x3FFF) {
            romBankLow_ = value & 0x1F;
        } else if (address <= 0x5FFF) {
            bank2_ = value & 0x03;
        } else if (address <= 0x7FFF) {
            mode_ = (value & 0x01) != 0;
        }
    }

    u8 readRam(u16 address) override {
        if (!ramEnabled_ || ram_.empty()) return 0xFF;
        std::size_t offset = ramOffset(address);
        return offset < ram_.size() ? ram_[offset] : 0xFF;
    }

    void writeRam(u16 address, u8 value) override {
        if (!ramEnabled_ || ram_.empty()) return;
        std::size_t offset = ramOffset(address);
        if (offset < ram_.size()) ram_[offset] = value;
    }

    bool hasBattery() const override { return hasBattery_; }
    const std::vector<u8>& ram() const override { return ram_; }
    void loadRam(const std::vector<u8>& data) override {
        if (data.size() == ram_.size()) ram_ = data;
    }

   private:
    std::size_t ramOffset(u16 address) const {
        u32 bank = mode_ ? bank2_ : 0;
        if (ramBankCount_ > 0) bank %= ramBankCount_;
        return std::size_t(bank) * kRamBankSize + (address - 0xA000);
    }

    std::vector<u8> rom_;
    std::vector<u8> ram_;
    bool hasBattery_;
    u32 romBankCount_;
    u32 ramBankCount_;

    bool ramEnabled_ = false;
    u8 romBankLow_ = 1;
    u8 bank2_ = 0;
    bool mode_ = false;
};

// MBC3: up to 128 ROM banks, 4 RAM banks, and on the +TIMER variants a
// real-time clock -- the one Pokemon Gold and Silver keep day and night with.
//
// The clock is kept as a count of seconds that was true at a given moment
// (base_ at baseTime_), and only ever turned into seconds, minutes, hours
// and days when the game looks. So it keeps running with the emulator
// closed, like the battery-backed original, and the save it produces only
// changes when the game actually sets the clock, not every second.
class Mbc3Cartridge : public Cartridge {
   public:
    Mbc3Cartridge(std::vector<u8> rom, std::size_t ramBytes, bool hasBattery, bool hasClock)
        : rom_(std::move(rom)),
          ram_(ramBytes, 0xFF),
          hasBattery_(hasBattery),
          hasClock_(hasClock),
          romBankCount_(static_cast<u32>(rom_.size() / kRomBankSize)),
          ramBankCount_(static_cast<u32>(ramBytes / kRamBankSize)),
          baseTime_(g_clock()) {}

    u8 readRom(u16 address) override {
        std::size_t offset = address;
        if (address >= 0x4000) {
            u32 bank = romBankCount_ > 0 ? romBank_ % romBankCount_ : 0;
            offset = std::size_t(bank) * kRomBankSize + (address - 0x4000);
        }
        return offset < rom_.size() ? rom_[offset] : 0xFF;
    }

    void writeRom(u16 address, u8 value) override {
        if (address <= 0x1FFF) {
            enabled_ = (value & 0x0F) == 0x0A;  // RAM and clock together
        } else if (address <= 0x3FFF) {
            romBank_ = value & 0x7F;
            if (romBank_ == 0) romBank_ = 1;
        } else if (address <= 0x5FFF) {
            select_ = value;  // 0-3: a RAM bank; 0x08-0x0C: a clock register
        } else if (hasClock_) {
            // Writing 0 then 1 copies the running clock into the registers
            // the game reads, so it sees one consistent time.
            if (latchArmed_ && value == 0x01) latch();
            latchArmed_ = value == 0x00;
        }
    }

    u8 readRam(u16 address) override {
        if (!enabled_) return 0xFF;
        if (select_ <= 0x03) {
            std::size_t offset = ramOffset(address);
            return offset < ram_.size() ? ram_[offset] : 0xFF;
        }
        if (hasClock_ && select_ >= 0x08 && select_ <= 0x0C) return latched_[select_ - 0x08];
        return 0xFF;
    }

    void writeRam(u16 address, u8 value) override {
        if (!enabled_) return;
        if (select_ <= 0x03) {
            std::size_t offset = ramOffset(address);
            if (offset < ram_.size()) ram_[offset] = value;
        } else if (hasClock_ && select_ >= 0x08 && select_ <= 0x0C) {
            setClockRegister(select_ - 0x08, value);
        }
    }

    bool hasBattery() const override { return hasBattery_; }

    const std::vector<u8>& ram() const override {
        if (!hasClock_) return ram_;
        // RAM, then the clock as BGB and VBA-M store it: the five registers
        // as they stood at the timestamp, the five latched ones, each as a
        // little-endian u32, then the timestamp as a little-endian u64.
        image_ = ram_;
        u8 current[5];
        registersFor(base_, current);
        for (u8 value : current) appendLittleEndian(image_, value, 4);
        for (u8 value : latched_) appendLittleEndian(image_, value, 4);
        appendLittleEndian(image_, static_cast<std::uint64_t>(baseTime_), 8);
        return image_;
    }

    void loadRam(const std::vector<u8>& data) override {
        if (data.size() < ram_.size()) return;
        std::copy(data.begin(), data.begin() + ram_.size(), ram_.begin());
        // 48 bytes of clock with a 64-bit timestamp, or 44 with the older
        // 32-bit one. Anything else: no clock saved, keep the fresh one.
        const std::size_t extra = data.size() - ram_.size();
        if (!hasClock_ || (extra != 48 && extra != 44)) return;
        const u8* clock = data.data() + ram_.size();
        u8 current[5];
        for (int i = 0; i < 5; i++) {
            current[i] = clock[i * 4];
            latched_[i] = clock[20 + i * 4];
        }
        std::uint64_t timestamp = 0;
        for (std::size_t i = 0; i < extra - 40; i++) timestamp |= std::uint64_t(clock[40 + i]) << (8 * i);
        halted_ = current[4] & 0x40;
        carry_ = current[4] & 0x80;
        base_ = secondsFor(current);
        baseTime_ = static_cast<std::int64_t>(timestamp);
    }

   private:
    static void appendLittleEndian(std::vector<u8>& out, std::uint64_t value, int bytes) {
        for (int i = 0; i < bytes; i++) out.push_back(u8(value >> (8 * i)));
    }

    std::size_t ramOffset(u16 address) const {
        u32 bank = ramBankCount_ > 0 ? select_ % ramBankCount_ : 0;
        return std::size_t(bank) * kRamBankSize + (address - 0xA000);
    }

    // The clock's own count, now. Stands still while halted.
    std::int64_t now() const {
        if (halted_) return base_;
        return base_ + std::max<std::int64_t>(0, g_clock() - baseTime_);
    }

    // Seconds -> S, M, H, DL, DH. The day counter is nine bits; past 511
    // it wraps and sets the carry, which stays set until the game clears it.
    void registersFor(std::int64_t seconds, u8 out[5]) const {
        const std::int64_t days = seconds / 86400;
        out[0] = u8(seconds % 60);
        out[1] = u8(seconds / 60 % 60);
        out[2] = u8(seconds / 3600 % 24);
        out[3] = u8(days & 0xFF);
        out[4] = u8(((days >> 8) & 0x01) | (halted_ ? 0x40 : 0) | ((carry_ || days > 511) ? 0x80 : 0));
    }

    static std::int64_t secondsFor(const u8 registers[5]) {
        const std::int64_t days = registers[3] | (std::int64_t(registers[4] & 0x01) << 8);
        return days * 86400 + std::int64_t(registers[2] % 24) * 3600 + (registers[1] % 60) * 60 +
               registers[0] % 60;
    }

    void latch() {
        std::int64_t seconds = now();
        if (seconds / 86400 > 511) {
            carry_ = true;
            // Wrap the count too, so it doesn't grow without bound.
            base_ -= (seconds / 86400 / 512) * 512 * 86400;
            seconds = now();
        }
        registersFor(seconds, latched_);
    }

    // The game setting the clock: change one field of the running time and
    // carry on counting from there. Also where it halts and resumes it.
    void setClockRegister(int index, u8 value) {
        u8 registers[5];
        registersFor(now(), registers);
        registers[index] = value;
        halted_ = registers[4] & 0x40;
        carry_ = registers[4] & 0x80;
        base_ = secondsFor(registers);
        baseTime_ = g_clock();
        latched_[index] = value;
    }

    std::vector<u8> rom_;
    std::vector<u8> ram_;
    mutable std::vector<u8> image_;  // ram() with the clock appended
    bool hasBattery_;
    bool hasClock_;
    u32 romBankCount_;
    u32 ramBankCount_;

    bool enabled_ = false;
    u8 romBank_ = 1;
    u8 select_ = 0;
    bool latchArmed_ = false;

    std::int64_t base_ = 0;
    std::int64_t baseTime_;
    bool halted_ = false;
    bool carry_ = false;
    u8 latched_[5] = {};
};

// MBC5: nine-bit ROM bank number (up to 8 MiB) and 16 RAM banks. Unlike
// MBC1 and MBC3, bank 0 can be mapped at 0x4000. Pokemon Yellow uses it,
// as do most later and Color titles.
class Mbc5Cartridge : public Cartridge {
   public:
    Mbc5Cartridge(std::vector<u8> rom, std::size_t ramBytes, bool hasBattery)
        : rom_(std::move(rom)),
          ram_(ramBytes, 0xFF),
          hasBattery_(hasBattery),
          romBankCount_(static_cast<u32>(rom_.size() / kRomBankSize)),
          ramBankCount_(static_cast<u32>(ramBytes / kRamBankSize)) {}

    u8 readRom(u16 address) override {
        std::size_t offset = address;
        if (address >= 0x4000) {
            u32 bank = romBankCount_ > 0 ? romBank_ % romBankCount_ : 0;
            offset = std::size_t(bank) * kRomBankSize + (address - 0x4000);
        }
        return offset < rom_.size() ? rom_[offset] : 0xFF;
    }

    void writeRom(u16 address, u8 value) override {
        if (address <= 0x1FFF) {
            ramEnabled_ = (value & 0x0F) == 0x0A;
        } else if (address <= 0x2FFF) {
            romBank_ = u16((romBank_ & 0x100) | value);
        } else if (address <= 0x3FFF) {
            romBank_ = u16((romBank_ & 0xFF) | ((value & 0x01) << 8));
        } else if (address <= 0x5FFF) {
            // Bit 3 drives the motor on rumble carts; the bank is the rest.
            ramBank_ = value & 0x0F;
        }
    }

    u8 readRam(u16 address) override {
        if (!ramEnabled_ || ram_.empty()) return 0xFF;
        std::size_t offset = ramOffset(address);
        return offset < ram_.size() ? ram_[offset] : 0xFF;
    }

    void writeRam(u16 address, u8 value) override {
        if (!ramEnabled_ || ram_.empty()) return;
        std::size_t offset = ramOffset(address);
        if (offset < ram_.size()) ram_[offset] = value;
    }

    bool hasBattery() const override { return hasBattery_; }
    const std::vector<u8>& ram() const override { return ram_; }
    void loadRam(const std::vector<u8>& data) override {
        if (data.size() == ram_.size()) ram_ = data;
    }

   private:
    std::size_t ramOffset(u16 address) const {
        u32 bank = ramBankCount_ > 0 ? ramBank_ % ramBankCount_ : 0;
        return std::size_t(bank) * kRamBankSize + (address - 0xA000);
    }

    std::vector<u8> rom_;
    std::vector<u8> ram_;
    bool hasBattery_;
    u32 romBankCount_;
    u32 ramBankCount_;

    bool ramEnabled_ = false;
    u16 romBank_ = 1;
    u8 ramBank_ = 0;
};

std::size_t ramSizeForCode(u8 code) {
    switch (code) {
        case 0x00: return 0;
        case 0x01: return 0;       // unused/unofficial 2KB variant, treat as none
        case 0x02: return 8 * 1024;
        case 0x03: return 32 * 1024;
        case 0x04: return 128 * 1024;
        case 0x05: return 64 * 1024;
        default: return 0;
    }
}

}  // namespace

std::unique_ptr<Cartridge> loadCartridge(std::vector<u8> romData) {
    if (romData.size() < 0x150) return nullptr;

    u8 type = romData[0x147];
    std::size_t ramBytes = ramSizeForCode(romData[0x149]);

    switch (type) {
        case 0x00:  // ROM ONLY
            return std::make_unique<RomOnlyCartridge>(std::move(romData));
        case 0x01:  // MBC1
        case 0x02:  // MBC1+RAM
        case 0x03:  // MBC1+RAM+BATTERY
            return std::make_unique<Mbc1Cartridge>(std::move(romData), ramBytes, type == 0x03);
        case 0x0F:  // MBC3+TIMER+BATTERY
        case 0x10:  // MBC3+TIMER+RAM+BATTERY
        case 0x11:  // MBC3
        case 0x12:  // MBC3+RAM
        case 0x13:  // MBC3+RAM+BATTERY
            return std::make_unique<Mbc3Cartridge>(std::move(romData), ramBytes,
                                                   type == 0x0F || type == 0x10 || type == 0x13,
                                                   type == 0x0F || type == 0x10);
        case 0x19:  // MBC5
        case 0x1A:  // MBC5+RAM
        case 0x1B:  // MBC5+RAM+BATTERY
        case 0x1C:  // MBC5+RUMBLE
        case 0x1D:  // MBC5+RUMBLE+RAM
        case 0x1E:  // MBC5+RUMBLE+RAM+BATTERY
            return std::make_unique<Mbc5Cartridge>(std::move(romData), ramBytes,
                                                   type == 0x1B || type == 0x1E);
        default:
            // MBC2 and the rarer mappers (HuC1/3, MMM01, the Pocket Camera).
            return nullptr;
    }
}

void setClockSource(ClockSource source) { g_clock = source ? source : wallClock; }

}  // namespace gb
