// Runs a .gb ROM through gb::GameBoy until one full frame is rendered (or
// a step budget is exhausted, as a safety net against ROMs that never
// reach VBlank) and writes the resulting framebuffer as an uncompressed
// 24-bit BMP, scaled up for visibility.
//
// Usage: dump_frame <input.gb> <output.bmp> [scale=4] [max_steps=2000000]
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <vector>

#include "gb/cartridge.h"
#include "gb/gameboy.h"

namespace {

// Maps a 2-bit shade (0 = lightest, 3 = darkest, matching GB convention)
// to a grayscale byte.
gb::u8 shadeToGray(gb::u8 shade) { return gb::u8(255 - shade * 85); }

bool writeBmp(const char* path, const gb::Ppu::Framebuffer& fb, int scale) {
    const int width = gb::kScreenWidth * scale;
    const int height = gb::kScreenHeight * scale;
    const int rowBytes = width * 3;
    const int rowPadding = (4 - (rowBytes % 4)) % 4;
    const int imageSize = (rowBytes + rowPadding) * height;
    const int fileSize = 54 + imageSize;

    std::ofstream out(path, std::ios::binary);
    if (!out) return false;

    auto write16 = [&](std::uint16_t v) { out.write(reinterpret_cast<const char*>(&v), 2); };
    auto write32 = [&](std::uint32_t v) { out.write(reinterpret_cast<const char*>(&v), 4); };

    // BITMAPFILEHEADER
    out.write("BM", 2);
    write32(std::uint32_t(fileSize));
    write32(0);
    write32(54);
    // BITMAPINFOHEADER
    write32(40);
    write32(std::uint32_t(width));
    write32(std::uint32_t(height));  // positive height = bottom-up row order
    write16(1);
    write16(24);
    write32(0);
    write32(std::uint32_t(imageSize));
    write32(2835);
    write32(2835);
    write32(0);
    write32(0);

    std::vector<char> padding(std::size_t(rowPadding), 0);
    for (int y = height - 1; y >= 0; y--) {
        int srcY = y / scale;
        for (int x = 0; x < width; x++) {
            int srcX = x / scale;
            gb::u8 shade = fb[std::size_t(srcY) * gb::kScreenWidth + srcX];
            gb::u8 gray = shadeToGray(shade);
            char bgr[3] = {char(gray), char(gray), char(gray)};
            out.write(bgr, 3);
        }
        if (rowPadding > 0) out.write(padding.data(), rowPadding);
    }
    return true;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 3) {
        std::fprintf(stderr, "usage: %s <input.gb> <output.bmp> [scale=4] [max_steps=2000000]\n", argv[0]);
        return 1;
    }
    int scale = argc > 3 ? std::atoi(argv[3]) : 4;
    long maxSteps = argc > 4 ? std::atol(argv[4]) : 2'000'000;

    std::ifstream in(argv[1], std::ios::binary);
    if (!in) {
        std::fprintf(stderr, "failed to open %s\n", argv[1]);
        return 1;
    }
    std::vector<gb::u8> rom((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());

    auto cartridge = gb::loadCartridge(std::move(rom));
    if (!cartridge) {
        std::fprintf(stderr, "loadCartridge() rejected %s (bad header or unsupported mapper)\n", argv[1]);
        return 1;
    }

    gb::GameBoy gameBoy(std::move(cartridge));
    long steps = 0;
    while (!gameBoy.frameReady() && steps < maxSteps) {
        gameBoy.step();
        steps++;
    }
    if (!gameBoy.frameReady()) {
        std::fprintf(stderr, "gave up after %ld steps without reaching VBlank\n", steps);
        return 1;
    }
    std::printf("Reached VBlank after %ld CPU steps (PC=0x%04X)\n", steps, gameBoy.cpu().pc());

    if (!writeBmp(argv[2], gameBoy.framebuffer(), scale)) {
        std::fprintf(stderr, "failed to write %s\n", argv[2]);
        return 1;
    }
    std::printf("Wrote %s\n", argv[2]);
    return 0;
}
