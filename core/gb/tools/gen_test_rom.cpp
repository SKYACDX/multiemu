// Generates a tiny hand-assembled Game Boy ROM (no external assembler, no
// copyrighted game code) that exercises the whole pipeline end to end:
// CPU fetch/decode/execute, memory writes through the real Bus, VRAM/OAM,
// and the PPU's background renderer. It draws a black/white vertical
// stripe pattern across the whole screen and then loops forever.
//
// Usage: gen_test_rom <output.gb>
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <string>
#include <unordered_map>
#include <vector>

#include "gb/types.h"

namespace {

// Minimal two-pass "assembler": write bytes at increasing addresses,
// remembering label positions, and backpatch relative jump offsets once
// every label is known. Addresses are absolute (0x0000-based) since the
// ROM vector IS the address space for bank 0.
class Asm {
   public:
    Asm(std::vector<gb::u8>& rom, std::size_t startAddress) : rom_(rom), pos_(startAddress) {}

    void byte(gb::u8 b) {
        if (pos_ >= rom_.size()) rom_.resize(pos_ + 1, 0);
        rom_[pos_++] = b;
    }
    void bytes(std::initializer_list<gb::u8> bs) {
        for (gb::u8 b : bs) byte(b);
    }
    void label(const std::string& name) { labels_[name] = pos_; }

    // opcode is JR (0x18) or one of the conditional forms (0x20/0x28/0x30/0x38).
    void jr(gb::u8 opcode, const std::string& target) {
        byte(opcode);
        pendingJr_.push_back({pos_, target});
        byte(0x00);  // placeholder, patched in resolve()
    }

    void resolve() {
        for (auto& [patchPos, target] : pendingJr_) {
            int rel = int(labels_.at(target)) - int(patchPos + 1);
            rom_[patchPos] = gb::u8(std::int8_t(rel));
        }
    }

   private:
    std::vector<gb::u8>& rom_;
    std::size_t pos_;
    std::unordered_map<std::string, std::size_t> labels_;
    std::vector<std::pair<std::size_t, std::string>> pendingJr_;
};

}  // namespace

int main(int argc, char** argv) {
    if (argc != 2) {
        std::fprintf(stderr, "usage: %s <output.gb>\n", argv[0]);
        return 1;
    }

    std::vector<gb::u8> rom;
    constexpr std::size_t kTileData = 0x0200;  // must land after the code below

    Asm a(rom, 0x0150);
    a.bytes({0xF3});              // DI
    a.bytes({0x31, 0xFE, 0xFF});  // LD SP,0xFFFE
    a.bytes({0xAF});              // XOR A          (A = 0)
    a.bytes({0xE0, 0x40});        // LDH (LCDC),A   ; turn the LCD off before touching VRAM

    // Copy 32 bytes of tile data (two 8x8 tiles) from ROM into VRAM at 0x8000.
    a.bytes({0x21, 0x00, 0x80});                                   // LD HL,0x8000
    a.bytes({0x11, gb::u8(kTileData & 0xFF), gb::u8(kTileData >> 8)});  // LD DE,kTileData
    a.bytes({0x06, 0x20});                                         // LD B,32
    a.label("copyTiles");
    a.bytes({0x1A});  // LD A,(DE)
    a.bytes({0x22});  // LD (HL+),A
    a.bytes({0x13});  // INC DE
    a.bytes({0x05});  // DEC B
    a.jr(0x20, "copyTiles");  // JR NZ,copyTiles

    // Fill the whole 32x32 background tile map (0x9800-0x9BFF) alternating
    // tile 0/tile 1 -- since 32 is even, this produces solid 8px-wide
    // vertical stripes across the visible 20x18 screen.
    a.bytes({0x21, 0x00, 0x98});  // LD HL,0x9800
    a.bytes({0x01, 0x00, 0x04});  // LD BC,1024
    a.bytes({0x1E, 0x00});        // LD E,0          ; E = next tile index to write
    a.label("fillLoop");
    a.bytes({0x7B});        // LD A,E
    a.bytes({0x22});        // LD (HL+),A
    a.bytes({0xEE, 0x01});  // XOR 1               ; toggle 0/1
    a.bytes({0x5F});        // LD E,A
    a.bytes({0x0B});        // DEC BC
    a.bytes({0x78});        // LD A,B
    a.bytes({0xB1});        // OR C                ; BC == 0 ?
    a.jr(0x20, "fillLoop");  // JR NZ,fillLoop

    a.bytes({0x3E, 0xE4});  // LD A,0xE4           ; identity BG palette (id N -> shade N)
    a.bytes({0xE0, 0x47});  // LDH (BGP),A

    a.bytes({0x3E, 0x91});  // LD A,0x91           ; LCD on, BG on, tile data @ 0x8000, map @ 0x9800
    a.bytes({0xE0, 0x40});  // LDH (LCDC),A

    a.label("loopForever");
    a.jr(0x18, "loopForever");  // JR loopForever

    a.resolve();

    if (rom.size() < kTileData + 32) rom.resize(kTileData + 32, 0);
    for (int i = 0; i < 16; i++) rom[kTileData + i] = 0xFF;       // tile 0: solid color ID 3
    for (int i = 0; i < 16; i++) rom[kTileData + 16 + i] = 0x00;  // tile 1: solid color ID 0

    // Pad to a plausible cartridge size. Header defaults (all zero) are
    // exactly what we want: type 0x00 = ROM ONLY, no RAM.
    rom.resize(0x8000, 0);

    std::ofstream out(argv[1], std::ios::binary);
    if (!out) {
        std::fprintf(stderr, "failed to open %s for writing\n", argv[1]);
        return 1;
    }
    out.write(reinterpret_cast<const char*>(rom.data()), std::streamsize(rom.size()));
    std::printf("Wrote %zu bytes to %s\n", rom.size(), argv[1]);
    return 0;
}
