#include "gb/cpu.h"

namespace gb {

namespace {
// Standard SM83 8-bit register encoding used throughout the opcode table:
// 0=B 1=C 2=D 3=E 4=H 5=L 6=(HL) 7=A
constexpr int kRegHlIndirect = 6;
}  // namespace

void Cpu::reset() {
    // Post-bootrom (DMG) power-up state. We don't emulate the bootrom
    // itself yet, so execution starts directly at the cartridge entry
    // point with the registers already in the state the bootrom would
    // have left them.
    setAf(0x01B0);
    setBc(0x0013);
    setDe(0x00D8);
    setHl(0x014D);
    sp_ = 0xFFFE;
    pc_ = 0x0100;
    ime_ = false;
    halted_ = false;
}

u8 Cpu::fetch8() { return bus_.read(pc_++); }

u16 Cpu::fetch16() {
    u8 lo = fetch8();
    u8 hi = fetch8();
    return u16(hi) << 8 | lo;
}

u8 Cpu::inc(u8 value) {
    u8 result = u8(value + 1);
    setFlag(kFlagH, (value & 0x0F) == 0x0F);
    setFlag(kFlagZ, result == 0);
    setFlag(kFlagN, false);
    return result;
}

u8 Cpu::dec(u8 value) {
    u8 result = u8(value - 1);
    setFlag(kFlagH, (value & 0x0F) == 0x00);
    setFlag(kFlagZ, result == 0);
    setFlag(kFlagN, true);
    return result;
}

void Cpu::add(u8 value, bool withCarry) {
    int carry = (withCarry && flagC()) ? 1 : 0;
    int result = a_ + value + carry;
    setFlag(kFlagH, ((a_ & 0x0F) + (value & 0x0F) + carry) > 0x0F);
    setFlag(kFlagC, result > 0xFF);
    a_ = u8(result);
    setFlag(kFlagZ, a_ == 0);
    setFlag(kFlagN, false);
}

void Cpu::sub(u8 value, bool withCarry) {
    int carry = (withCarry && flagC()) ? 1 : 0;
    int result = a_ - value - carry;
    setFlag(kFlagH, (int(a_ & 0x0F) - int(value & 0x0F) - carry) < 0);
    setFlag(kFlagC, result < 0);
    a_ = u8(result);
    setFlag(kFlagZ, a_ == 0);
    setFlag(kFlagN, true);
}

void Cpu::and_(u8 value) {
    a_ &= value;
    setFlag(kFlagZ, a_ == 0);
    setFlag(kFlagN, false);
    setFlag(kFlagH, true);
    setFlag(kFlagC, false);
}

void Cpu::or_(u8 value) {
    a_ |= value;
    setFlag(kFlagZ, a_ == 0);
    setFlag(kFlagN, false);
    setFlag(kFlagH, false);
    setFlag(kFlagC, false);
}

void Cpu::xor_(u8 value) {
    a_ ^= value;
    setFlag(kFlagZ, a_ == 0);
    setFlag(kFlagN, false);
    setFlag(kFlagH, false);
    setFlag(kFlagC, false);
}

void Cpu::cp(u8 value) {
    int result = a_ - value;
    setFlag(kFlagH, (a_ & 0x0F) < (value & 0x0F));
    setFlag(kFlagC, a_ < value);
    setFlag(kFlagZ, u8(result) == 0);
    setFlag(kFlagN, true);
}

void Cpu::push16(u16 value) {
    bus_.write(--sp_, u8(value >> 8));
    bus_.write(--sp_, u8(value));
}

u16 Cpu::pop16() {
    u8 lo = bus_.read(sp_++);
    u8 hi = bus_.read(sp_++);
    return u16(hi) << 8 | lo;
}

int Cpu::execute(u8 opcode) {
    // ---- 8-bit register helpers (index order: B C D E H L (HL) A) ----
    auto getReg8 = [&](int idx) -> u8 {
        switch (idx) {
            case 0: return b_;
            case 1: return c_;
            case 2: return d_;
            case 3: return e_;
            case 4: return h_;
            case 5: return l_;
            case 6: return readHl();
            default: return a_;
        }
    };
    auto setReg8 = [&](int idx, u8 v) {
        switch (idx) {
            case 0: b_ = v; break;
            case 1: c_ = v; break;
            case 2: d_ = v; break;
            case 3: e_ = v; break;
            case 4: h_ = v; break;
            case 5: l_ = v; break;
            case 6: writeHl(v); break;
            default: a_ = v; break;
        }
    };
    // 16-bit pair helpers, index order BC DE HL SP
    auto getRp = [&](int idx) -> u16 {
        switch (idx) {
            case 0: return bc();
            case 1: return de();
            case 2: return hl();
            default: return sp_;
        }
    };
    auto setRp = [&](int idx, u16 v) {
        switch (idx) {
            case 0: setBc(v); break;
            case 1: setDe(v); break;
            case 2: setHl(v); break;
            default: sp_ = v; break;
        }
    };
    // 16-bit pair helpers used by PUSH/POP, index order BC DE HL AF
    auto getRp2 = [&](int idx) -> u16 {
        switch (idx) {
            case 0: return bc();
            case 1: return de();
            case 2: return hl();
            default: return af();
        }
    };
    auto setRp2 = [&](int idx, u16 v) {
        switch (idx) {
            case 0: setBc(v); break;
            case 1: setDe(v); break;
            case 2: setHl(v); break;
            default: setAf(v); break;
        }
    };
    auto condition = [&](int idx) -> bool {
        switch (idx) {
            case 0: return !flagZ();
            case 1: return flagZ();
            case 2: return !flagC();
            default: return flagC();
        }
    };

    // ---- fixed single-byte opcodes ----
    switch (opcode) {
        case 0x00:  // NOP
            return 1;
        case 0x76:  // HALT
            halted_ = true;
            return 1;
        case 0x10:  // STOP -- has a padding byte on real hardware
            fetch8();
            return 1;
        case 0xF3:  // DI
            ime_ = false;
            return 1;
        case 0xFB:  // EI
            // NOTE: real hardware delays the effect by one instruction;
            // not modeled yet.
            ime_ = true;
            return 1;
        case 0x2F:  // CPL
            a_ = u8(~a_);
            setFlag(kFlagN, true);
            setFlag(kFlagH, true);
            return 1;
        case 0x37:  // SCF
            setFlag(kFlagN, false);
            setFlag(kFlagH, false);
            setFlag(kFlagC, true);
            return 1;
        case 0x3F:  // CCF
            setFlag(kFlagN, false);
            setFlag(kFlagH, false);
            setFlag(kFlagC, !flagC());
            return 1;
        case 0x07: {  // RLCA
            u8 carry = a_ >> 7;
            a_ = u8((a_ << 1) | carry);
            f_ = 0;
            setFlag(kFlagC, carry);
            return 1;
        }
        case 0x0F: {  // RRCA
            u8 carry = a_ & 1;
            a_ = u8((a_ >> 1) | (carry << 7));
            f_ = 0;
            setFlag(kFlagC, carry);
            return 1;
        }
        case 0x17: {  // RLA
            u8 carry = a_ >> 7;
            a_ = u8((a_ << 1) | (flagC() ? 1 : 0));
            f_ = 0;
            setFlag(kFlagC, carry);
            return 1;
        }
        case 0x1F: {  // RRA
            u8 carry = a_ & 1;
            a_ = u8((a_ >> 1) | ((flagC() ? 1 : 0) << 7));
            f_ = 0;
            setFlag(kFlagC, carry);
            return 1;
        }
        case 0x02:  // LD (BC),A
            bus_.write(bc(), a_);
            return 2;
        case 0x12:  // LD (DE),A
            bus_.write(de(), a_);
            return 2;
        case 0x0A:  // LD A,(BC)
            a_ = bus_.read(bc());
            return 2;
        case 0x1A:  // LD A,(DE)
            a_ = bus_.read(de());
            return 2;
        case 0x22:  // LD (HL+),A
            bus_.write(hl(), a_);
            setHl(hl() + 1);
            return 2;
        case 0x2A:  // LD A,(HL+)
            a_ = bus_.read(hl());
            setHl(hl() + 1);
            return 2;
        case 0x32:  // LD (HL-),A
            bus_.write(hl(), a_);
            setHl(hl() - 1);
            return 2;
        case 0x3A:  // LD A,(HL-)
            a_ = bus_.read(hl());
            setHl(hl() - 1);
            return 2;
        case 0x08: {  // LD (nn),SP
            u16 addr = fetch16();
            bus_.write(addr, u8(sp_));
            bus_.write(addr + 1, u8(sp_ >> 8));
            return 5;
        }
        case 0xE0:  // LDH (n),A
            bus_.write(0xFF00 + fetch8(), a_);
            return 3;
        case 0xF0:  // LDH A,(n)
            a_ = bus_.read(0xFF00 + fetch8());
            return 3;
        case 0xE2:  // LD (C),A
            bus_.write(0xFF00 + c_, a_);
            return 2;
        case 0xF2:  // LD A,(C)
            a_ = bus_.read(0xFF00 + c_);
            return 2;
        case 0xEA:  // LD (nn),A
            bus_.write(fetch16(), a_);
            return 4;
        case 0xFA:  // LD A,(nn)
            a_ = bus_.read(fetch16());
            return 4;
        case 0xF9:  // LD SP,HL
            sp_ = hl();
            return 2;
        case 0xC3:  // JP nn
            pc_ = fetch16();
            return 4;
        case 0xE9:  // JP (HL)  [does not read memory at HL, jumps to HL itself]
            pc_ = hl();
            return 1;
        case 0x18: {  // JR e
            i8 offset = i8(fetch8());
            pc_ = u16(pc_ + offset);
            return 3;
        }
        case 0xCD: {  // CALL nn
            u16 target = fetch16();
            push16(pc_);
            pc_ = target;
            return 6;
        }
        case 0xC9:  // RET
            pc_ = pop16();
            return 4;
        case 0xD9:  // RETI
            pc_ = pop16();
            ime_ = true;
            return 4;
        case 0xE8: {  // ADD SP,e
            i8 offset = i8(fetch8());
            int result = int(sp_) + offset;
            setFlag(kFlagZ, false);
            setFlag(kFlagN, false);
            setFlag(kFlagH, ((sp_ & 0x0F) + (offset & 0x0F)) > 0x0F);
            setFlag(kFlagC, ((sp_ & 0xFF) + (offset & 0xFF)) > 0xFF);
            sp_ = u16(result);
            return 4;
        }
        case 0xF8: {  // LD HL,SP+e
            i8 offset = i8(fetch8());
            int result = int(sp_) + offset;
            setFlag(kFlagZ, false);
            setFlag(kFlagN, false);
            setFlag(kFlagH, ((sp_ & 0x0F) + (offset & 0x0F)) > 0x0F);
            setFlag(kFlagC, ((sp_ & 0xFF) + (offset & 0xFF)) > 0xFF);
            setHl(u16(result));
            return 3;
        }
        case 0xCB:
            // TODO: bit-rotate/shift/BIT/SET/RES table (0xCB-prefixed
            // opcodes). Not implemented yet -- consume the second byte so
            // decoding doesn't desync, but this does not do anything else.
            fetch8();
            return 2;
        default:
            break;
    }

    // ---- patterned blocks ----

    // LD r,r' (0x40-0x7F, 0x76 already handled above as HALT)
    if ((opcode & 0xC0) == 0x40) {
        int dst = (opcode >> 3) & 7;
        int src = opcode & 7;
        setReg8(dst, getReg8(src));
        bool touchesHl = dst == kRegHlIndirect || src == kRegHlIndirect;
        return touchesHl ? 2 : 1;
    }

    // ALU A,r (0x80-0xBF): op selects ADD/ADC/SUB/SBC/AND/XOR/OR/CP
    if ((opcode & 0xC0) == 0x80) {
        int op = (opcode >> 3) & 7;
        int src = opcode & 7;
        u8 value = getReg8(src);
        switch (op) {
            case 0: add(value, false); break;
            case 1: add(value, true); break;
            case 2: sub(value, false); break;
            case 3: sub(value, true); break;
            case 4: and_(value); break;
            case 5: xor_(value); break;
            case 6: or_(value); break;
            default: cp(value); break;
        }
        return src == kRegHlIndirect ? 2 : 1;
    }

    // ALU A,n immediate (0xC6,0xCE,0xD6,0xDE,0xE6,0xEE,0xF6,0xFE)
    if ((opcode & 0xC7) == 0xC6) {
        int op = (opcode >> 3) & 7;
        u8 value = fetch8();
        switch (op) {
            case 0: add(value, false); break;
            case 1: add(value, true); break;
            case 2: sub(value, false); break;
            case 3: sub(value, true); break;
            case 4: and_(value); break;
            case 5: xor_(value); break;
            case 6: or_(value); break;
            default: cp(value); break;
        }
        return 2;
    }

    // LD r,n (0x06,0x0E,0x16,0x1E,0x26,0x2E,0x36,0x3E)
    if ((opcode & 0xC7) == 0x06) {
        int reg = (opcode >> 3) & 7;
        u8 value = fetch8();
        setReg8(reg, value);
        return reg == kRegHlIndirect ? 3 : 2;
    }

    // INC r (0x04,0x0C,...,0x3C)
    if ((opcode & 0xC7) == 0x04) {
        int reg = (opcode >> 3) & 7;
        setReg8(reg, inc(getReg8(reg)));
        return reg == kRegHlIndirect ? 3 : 1;
    }

    // DEC r (0x05,0x0D,...,0x3D)
    if ((opcode & 0xC7) == 0x05) {
        int reg = (opcode >> 3) & 7;
        setReg8(reg, dec(getReg8(reg)));
        return reg == kRegHlIndirect ? 3 : 1;
    }

    // LD rp,nn (0x01,0x11,0x21,0x31)
    if ((opcode & 0xCF) == 0x01) {
        int rp = (opcode >> 4) & 3;
        setRp(rp, fetch16());
        return 3;
    }

    // INC rp (0x03,0x13,0x23,0x33)
    if ((opcode & 0xCF) == 0x03) {
        int rp = (opcode >> 4) & 3;
        setRp(rp, u16(getRp(rp) + 1));
        return 2;
    }

    // DEC rp (0x0B,0x1B,0x2B,0x3B)
    if ((opcode & 0xCF) == 0x0B) {
        int rp = (opcode >> 4) & 3;
        setRp(rp, u16(getRp(rp) - 1));
        return 2;
    }

    // ADD HL,rp (0x09,0x19,0x29,0x39)
    if ((opcode & 0xCF) == 0x09) {
        int rp = (opcode >> 4) & 3;
        u16 value = getRp(rp);
        int result = int(hl()) + int(value);
        setFlag(kFlagN, false);
        setFlag(kFlagH, ((hl() & 0x0FFF) + (value & 0x0FFF)) > 0x0FFF);
        setFlag(kFlagC, result > 0xFFFF);
        setHl(u16(result));
        return 2;
    }

    // PUSH rp2 (0xC5,0xD5,0xE5,0xF5)
    if ((opcode & 0xCF) == 0xC5) {
        int rp = (opcode >> 4) & 3;
        push16(getRp2(rp));
        return 4;
    }

    // POP rp2 (0xC1,0xD1,0xE1,0xF1)
    if ((opcode & 0xCF) == 0xC1) {
        int rp = (opcode >> 4) & 3;
        setRp2(rp, pop16());
        return 3;
    }

    // JR cc,e (0x20,0x28,0x30,0x38)
    if ((opcode & 0xE7) == 0x20) {
        int cc = (opcode >> 3) & 3;
        i8 offset = i8(fetch8());
        if (condition(cc)) {
            pc_ = u16(pc_ + offset);
            return 3;
        }
        return 2;
    }

    // JP cc,nn (0xC2,0xCA,0xD2,0xDA)
    if ((opcode & 0xE7) == 0xC2) {
        int cc = (opcode >> 3) & 3;
        u16 target = fetch16();
        if (condition(cc)) {
            pc_ = target;
            return 4;
        }
        return 3;
    }

    // CALL cc,nn (0xC4,0xCC,0xD4,0xDC)
    if ((opcode & 0xE7) == 0xC4) {
        int cc = (opcode >> 3) & 3;
        u16 target = fetch16();
        if (condition(cc)) {
            push16(pc_);
            pc_ = target;
            return 6;
        }
        return 3;
    }

    // RET cc (0xC0,0xC8,0xD0,0xD8)
    if ((opcode & 0xE7) == 0xC0) {
        int cc = (opcode >> 3) & 3;
        if (condition(cc)) {
            pc_ = pop16();
            return 5;
        }
        return 2;
    }

    // RST n (0xC7,0xCF,0xD7,0xDF,0xE7,0xEF,0xF7,0xFF)
    if ((opcode & 0xC7) == 0xC7) {
        u16 target = opcode & 0x38;
        push16(pc_);
        pc_ = target;
        return 4;
    }

    // Unimplemented / unassigned opcode. TODO: DAA and anything else still
    // missing from the table above. Treated as a 1-cycle no-op for now so
    // the fetch/decode loop doesn't get stuck.
    return 1;
}

int Cpu::serviceInterrupt() {
    u8 ie = bus_.read(0xFFFF);
    u8 iflag = bus_.read(0xFF0F);
    u8 pending = ie & iflag & 0x1F;
    if (pending == 0) return 0;

    halted_ = false;  // hardware wakes on IE&IF regardless of IME
    if (!ime_) return 0;

    for (int i = 0; i < 5; i++) {
        if (pending & (1 << i)) {
            ime_ = false;
            bus_.write(0xFF0F, iflag & ~u8(1 << i));
            push16(pc_);
            pc_ = 0x0040 + u16(i) * 8;  // VBlank, LCD STAT, Timer, Serial, Joypad
            return 5;
        }
    }
    return 0;  // unreachable
}

int Cpu::step() {
    int interruptCycles = serviceInterrupt();
    if (interruptCycles > 0) return interruptCycles;

    if (halted_) return 1;

    u8 opcode = fetch8();
    return execute(opcode);
}

}  // namespace gb
