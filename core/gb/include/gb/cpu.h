#pragma once
#include "gb/bus.h"
#include "gb/types.h"

namespace gb {

// Sharp SM83 CPU (the Game Boy's CPU core — a Z80/8080 hybrid, not a real
// Z80). Talks to memory only through Bus, so it can be tested in isolation.
class Cpu {
   public:
    explicit Cpu(Bus& bus) : bus_(bus) { reset(); }

    // Puts registers in their post-bootrom power-up state: the DMG's, or
    // with cgb the CGB's in colour mode -- A=0x11 is how a game tells it
    // is running on a Game Boy Color.
    // A real implementation will eventually want to *run* the bootrom
    // instead, but starting from the known post-boot state is enough to
    // start executing cartridge code and to unit-test the decoder.
    void reset(bool cgb = false);

    // Executes exactly one instruction, or services one pending interrupt
    // if IME (or, for waking from HALT, just IE&IF) allows it. Returns the
    // number of machine cycles (m-cycles, 1 m-cycle = 4 t-cycles) it took;
    // the caller must convert to t-cycles (x4) to drive Bus::tick.
    int step();

    // --- register access (exposed for tests and for the debugger UI) ---
    u16 af() const { return (u16(a_) << 8) | f_; }
    u16 bc() const { return (u16(b_) << 8) | c_; }
    u16 de() const { return (u16(d_) << 8) | e_; }
    u16 hl() const { return (u16(h_) << 8) | l_; }
    u16 sp() const { return sp_; }
    u16 pc() const { return pc_; }

    u8 a() const { return a_; }
    u8 f() const { return f_; }
    u8 b() const { return b_; }
    u8 c() const { return c_; }
    u8 d() const { return d_; }
    u8 e() const { return e_; }
    u8 h() const { return h_; }
    u8 l() const { return l_; }

    bool flagZ() const { return f_ & kFlagZ; }
    bool flagN() const { return f_ & kFlagN; }
    bool flagH() const { return f_ & kFlagH; }
    bool flagC() const { return f_ & kFlagC; }

    bool halted() const { return halted_; }
    bool interruptsEnabled() const { return ime_; }

    static constexpr u8 kFlagZ = 0x80;
    static constexpr u8 kFlagN = 0x40;
    static constexpr u8 kFlagH = 0x20;
    static constexpr u8 kFlagC = 0x10;

   private:
    Bus& bus_;

    u8 a_ = 0, f_ = 0, b_ = 0, c_ = 0, d_ = 0, e_ = 0, h_ = 0, l_ = 0;
    u16 sp_ = 0, pc_ = 0;
    bool ime_ = false;
    bool halted_ = false;

    void setAf(u16 v) {
        a_ = u8(v >> 8);
        f_ = u8(v & 0xF0);  // low nibble of F is always 0 on real hardware
    }
    void setBc(u16 v) {
        b_ = u8(v >> 8);
        c_ = u8(v);
    }
    void setDe(u16 v) {
        d_ = u8(v >> 8);
        e_ = u8(v);
    }
    void setHl(u16 v) {
        h_ = u8(v >> 8);
        l_ = u8(v);
    }

    void setFlag(u8 mask, bool set) {
        if (set)
            f_ |= mask;
        else
            f_ &= ~mask;
    }

    u8 fetch8();
    u16 fetch16();

    // addressing helpers
    u8 readHl() { return bus_.read(hl()); }
    void writeHl(u8 v) { bus_.write(hl(), v); }

    // ALU helpers (operate on A, set flags)
    void add(u8 value, bool withCarry);
    void sub(u8 value, bool withCarry);
    void and_(u8 value);
    void or_(u8 value);
    void xor_(u8 value);
    void cp(u8 value);
    u8 inc(u8 value);
    u8 dec(u8 value);

    void push16(u16 value);
    u16 pop16();

    void jumpIf(bool condition, u16 target);
    void jrIf(bool condition, i8 offset);
    void callIf(bool condition, u16 target);
    void retIf(bool condition);

    // Executes one opcode. Returns m-cycles taken.
    int execute(u8 opcode);

    // Checks IE & IF & IME (0xFFFF, 0xFF0F, ime_) for a pending
    // interrupt. If one exists, HALT is cleared unconditionally (hardware
    // wakes on IE&IF regardless of IME); if IME is also set, dispatches
    // it (pushes PC, jumps to the vector, clears IME and the IF bit) and
    // returns 5 m-cycles. Returns 0 if nothing was dispatched.
    int serviceInterrupt();
};

}  // namespace gb
