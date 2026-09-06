#include "gba_link.h"

#include <algorithm>
#include <chrono>
#include <sstream>

#include "mgba/internal/gba/gba.h"

namespace {

// Mirrors gba_jni.cpp's own toArgb8888 -- duplicated rather than shared
// across a header because it's five lines and the two files otherwise
// have no reason to depend on each other.
inline uint32_t toArgb8888(color_t pixel) {
    auto p = static_cast<uint32_t>(pixel);
    uint32_t r = p & 0xFF;
    uint32_t g = (p >> 8) & 0xFF;
    uint32_t b = (p >> 16) & 0xFF;
    return 0xFF000000u | (r << 16) | (g << 8) | b;
}

constexpr double kGbaFps = 59.7275005696;

}  // namespace

LinkedGbaSession::LinkedGbaSession(mCore* coreA, mCore* coreB) {
    lockstep_.d.context = this;
    lockstep_.d.lock = lockCb;
    lockstep_.d.unlock = unlockCb;
    lockstep_.d.signal = signalCb;
    lockstep_.d.wait = waitCb;
    lockstep_.d.addCycles = addCyclesCb;
    lockstep_.d.useCycles = useCyclesCb;
    lockstep_.d.unusedCycles = unusedCyclesCb;
    lockstep_.d.unload = unloadCb;
    GBASIOLockstepInit(&lockstep_);

    mCore* cores[2] = {coreA, coreB};
    for (int i = 0; i < 2; i++) {
        Player& p = players_[i];
        p.core = cores[i];
        p.session = this;
        p.frontBuffer.assign(static_cast<size_t>(kWidth) * kHeight, 0);
        p.backBuffer.assign(static_cast<size_t>(kWidth) * kHeight, 0);
        p.rawBuffer.assign(static_cast<size_t>(kWidth) * kHeight, 0);
        p.core->setVideoBuffer(p.core, p.rawBuffer.data(), kWidth);

        GBASIOLockstepNodeCreate(&p.node);
        GBASIOLockstepAttachNode(&lockstep_, &p.node);
        p.id = p.node.id;

        // Attach to both modes real GBA link games actually use (hardware
        // "Multi Play" and the plain Normal/UART-style mode some games,
        // e.g. Pokémon's trading protocol, drive by hand) -- matches
        // MultiplayerController::attachGame exactly, so whichever one a
        // given game picks, it's already wired.
        auto* gba = static_cast<GBA*>(p.core->board);
        GBASIOSetDriver(&gba->sio, &p.node.d, SIO_MULTI);
        GBASIOSetDriver(&gba->sio, &p.node.d, SIO_NORMAL_32);
    }

    for (int i = 0; i < 2; i++) {
        players_[i].running.store(true, std::memory_order_relaxed);
        players_[i].runThread = std::thread([this, i] { runLoop(i); });
    }
}

LinkedGbaSession::~LinkedGbaSession() {
    for (int i = 0; i < 2; i++) {
        players_[i].running.store(false, std::memory_order_relaxed);
    }
    // Wake anyone currently blocked in blockPlayer() -- its predicate
    // also checks `running`, so this is what lets a stuck thread notice
    // shutdown instead of waiting forever for a lockstep partner that's
    // going away too.
    for (int i = 0; i < 2; i++) wakePlayer(players_[i]);
    for (int i = 0; i < 2; i++) {
        if (players_[i].runThread.joinable()) players_[i].runThread.join();
    }
    for (int i = 0; i < 2; i++) {
        Player& p = players_[i];
        auto* gba = static_cast<GBA*>(p.core->board);
        GBASIOSetDriver(&gba->sio, nullptr, SIO_MULTI);
        GBASIOSetDriver(&gba->sio, nullptr, SIO_NORMAL_32);
        GBASIOLockstepDetachNode(&lockstep_, &p.node);
        mCoreConfigDeinit(&p.core->config);
        p.core->deinit(p.core);
    }
}

void LinkedGbaSession::runLoop(int id) {
    Player& p = players_[id];
    using clock = std::chrono::steady_clock;
    const std::chrono::duration<double> frameDuration(1.0 / kGbaFps);
    auto next = clock::now();

    while (p.running.load(std::memory_order_relaxed)) {
        // May block for a real, unpredictable duration inside here --
        // see the header comment -- whenever the lockstep protocol needs
        // this side to wait on the other one.
        p.core->runFrame(p.core);
        p.framesRun.fetch_add(1, std::memory_order_relaxed);

        {
            std::lock_guard<std::mutex> lock(p.frameMutex);
            for (size_t i = 0; i < p.backBuffer.size(); i++) {
                p.backBuffer[i] = toArgb8888(p.rawBuffer[i]);
            }
            std::swap(p.backBuffer, p.frontBuffer);
        }

        // Independent of the lockstep pacing above: without this, a side
        // that isn't currently mid-transfer would spin runFrame() as
        // fast as the CPU allows instead of at the real GBA frame rate.
        next += std::chrono::duration_cast<clock::duration>(frameDuration);
        auto now = clock::now();
        if (next > now) {
            std::this_thread::sleep_until(next);
        } else {
            next = now;  // fell behind -- don't try to burst-catch-up
        }
    }
}

void LinkedGbaSession::blockPlayer(Player& p) {
    // bigLock_ is held by the caller (lockCb was called at the top of
    // whatever mGBA callback got us here) -- release it while sleeping,
    // exactly like a condition_variable releases its own mutex, so the
    // OTHER player's thread can acquire bigLock_ and actually make the
    // progress (a signal/addCycles call) that wakes this one back up.
    // Forgetting this release is a guaranteed two-thread deadlock.
    bigLock_.unlock();
    {
        std::unique_lock<std::mutex> lock(p.wakeMutex);
        p.wakeCv.wait(lock, [&] { return p.wakeRequested || !p.running.load(std::memory_order_relaxed); });
        p.wakeRequested = false;
    }
    bigLock_.lock();
}

void LinkedGbaSession::wakePlayer(Player& p) {
    std::lock_guard<std::mutex> lock(p.wakeMutex);
    p.wakeRequested = true;
    p.wakeCv.notify_one();
}

std::string LinkedGbaSession::debugState() const {
    std::ostringstream oss;
    for (int i = 0; i < 2; i++) {
        const Player& p = players_[i];
        oss << "P" << i << "[mode=" << p.node.mode << " cyc=" << p.cyclesPosted << " awake=" << p.awake
            << " wait=" << p.waitMask << " next=" << p.node.nextEvent << "] ";
    }
    oss << "attached=" << lockstep_.d.attached << " transfer=" << lockstep_.d.transferActive;
    return oss.str();
}

void LinkedGbaSession::getFramebuffer(int player, uint32_t* outArgb) const {
    const Player& p = players_[player];
    std::lock_guard<std::mutex> lock(p.frameMutex);
    std::copy(p.frontBuffer.begin(), p.frontBuffer.end(), outArgb);
}

void LinkedGbaSession::setButtonPressed(int player, int buttonBit, bool pressed) {
    // ponytail: addKeys/clearKeys is a plain bitmask write on the core,
    // called here from the UI thread while that player's own run thread
    // may concurrently be mid-runFrame() -- a torn/lost single bit flip
    // is possible in principle. Not worth a cross-thread input queue for
    // a "was this frame's input off by one bit" cosmetic risk; revisit
    // if it's ever actually observed to drop inputs.
    mCore* core = players_[player].core;
    uint32_t bit = 1u << buttonBit;
    if (pressed) {
        core->addKeys(core, bit);
    } else {
        core->clearKeys(core, bit);
    }
}

void LinkedGbaSession::lockCb(mLockstep* ls) {
    static_cast<LinkedGbaSession*>(ls->context)->bigLock_.lock();
}

void LinkedGbaSession::unlockCb(mLockstep* ls) {
    static_cast<LinkedGbaSession*>(ls->context)->bigLock_.unlock();
}

// Ported field-for-field from MultiplayerController's lambdas (Qt-free,
// hardcoded to exactly 2 players) -- see third_party/mgba/src/platform/
// qt/MultiplayerController.cpp. Only player 0 (the "master" node) ever
// actually blocks in wait(); other players post/consume cycle budgets
// via addCycles/useCycles and self-pace against those instead.
bool LinkedGbaSession::signalCb(mLockstep* ls, unsigned mask) {
    auto* self = static_cast<LinkedGbaSession*>(ls->context);
    Player& player = self->players_[0];
    bool woke = false;
    player.waitMask &= ~static_cast<int>(mask);
    if (!player.waitMask && player.awake < 1) {
        self->wakePlayer(player);
        player.awake = 1;
        woke = true;
    }
    return woke;
}

bool LinkedGbaSession::waitCb(mLockstep* ls, unsigned mask) {
    auto* self = static_cast<LinkedGbaSession*>(ls->context);
    Player& player = self->players_[0];
    bool slept = false;
    player.waitMask |= static_cast<int>(mask);
    if (player.awake > 0) {
        self->blockPlayer(player);
        player.awake = 0;
        slept = true;
    }
    return slept;
}

void LinkedGbaSession::addCyclesCb(mLockstep* ls, int id, int32_t cycles) {
    auto* self = static_cast<LinkedGbaSession*>(ls->context);
    if (id == 0) {
        Player& other = self->players_[1];
        if (other.node.mode > SIO_MULTI) {
            // Not currently in a connected link mode on that side -- has
            // nothing to do with this transfer.
            return;
        }
        other.cyclesPosted += cycles;
        // Qt's version calls these two unconditionally on every
        // addCycles(0, ...), not just when `awake < 1` -- only the
        // nextEvent bump is conditional on that. Waking an already-awake
        // player is harmless; NOT doing so here (my initial port's bug)
        // risked leaving player 1 under-scheduled/stalled instead.
        if (other.awake < 1) {
            other.node.nextEvent += other.cyclesPosted;
        }
        self->wakePlayer(other);
        other.awake = 1;
    } else {
        self->players_[id].cyclesPosted += cycles;
    }
}

int32_t LinkedGbaSession::useCyclesCb(mLockstep* ls, int id, int32_t cycles) {
    auto* self = static_cast<LinkedGbaSession*>(ls->context);
    Player& p = self->players_[id];
    p.cyclesPosted -= cycles;
    if (p.cyclesPosted <= 0) {
        self->blockPlayer(p);
        p.awake = 0;
    }
    return p.cyclesPosted;
}

int32_t LinkedGbaSession::unusedCyclesCb(mLockstep* ls, int id) {
    return static_cast<LinkedGbaSession*>(ls->context)->players_[id].cyclesPosted;
}

void LinkedGbaSession::unloadCb(mLockstep* ls, int id) {
    auto* self = static_cast<LinkedGbaSession*>(ls->context);
    if (id != 0) {
        Player& p = self->players_[id];
        p.cyclesPosted = 0;

        Player& master = self->players_[0];
        master.waitMask &= ~(1 << id);
        if (!master.waitMask && master.awake < 1) {
            self->wakePlayer(master);
            master.awake = 1;
        }
    } else {
        Player& other = self->players_[1];
        other.cyclesPosted += self->players_[0].node.eventDiff;
        if (other.awake < 1) {
            other.node.nextEvent += other.cyclesPosted;
            self->wakePlayer(other);
            other.awake = 1;
        }
    }
}
