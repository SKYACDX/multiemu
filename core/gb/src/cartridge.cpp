#include "gb/cartridge.h"

namespace gb {

namespace {

constexpr u16 kRomBankSize = 0x4000;
constexpr u16 kRamBankSize = 0x2000;

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
        default:
            // TODO: MBC2, MBC3 (+RTC), MBC5 -- unsupported for now.
            return nullptr;
    }
}

}  // namespace gb
