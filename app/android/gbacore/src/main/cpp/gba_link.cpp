#include "gba_link.h"

#include <algorithm>
#include <android/log.h>
#include <chrono>

#include "mgba/core/blip_buf.h"
#include "mgba/internal/gba/gba.h"

// TEMPORARY diagnostic logging while chasing a live lockstep deadlock --
// delete once local link is confirmed working. `adb logcat -s gba_link`.
#define LLOG(...) __android_log_print(ANDROID_LOG_DEBUG, "gba_link", __VA_ARGS__)

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

// Comfortably more than mGBA's own per-transfer cycle grants (2000-2048,
// see LOCKSTEP_INCREMENT/LOCKSTEP_TRANSFER in lockstep.c) so a defensive
// top-up (see waitCb) can't itself immediately run out again before the
// topped-up side gets a chance to run.
constexpr int32_t kWaitTopUpCycles = 8192;

// Real hardware/the reference Qt frontend only ever attaches the link
// driver on demand, mid-game, after the user has already picked
// multiplayer from a running game's own menu -- never before the ROM
// has even booted. Attaching at core-creation time instead (this
// session's first attempt) put the SIO port in "something's attached"
// state from instruction one, and produced a screen that stayed 100%
// black forever even though both cores kept running -- consistent with
// the game's own boot-time hardware check getting confused by an
// unexpected already-attached peripheral. Running each side unlinked
// for a couple hundred frames first, matching how long real boot+menu
// navigation takes, avoids that.
constexpr int kWarmupFrames = 240;

// Matches gba_jni.cpp's kAudioSampleRateHz -- kept as its own constant
// (rather than shared) since the two JNI files otherwise have no reason
// to depend on each other; GbaLinkNative.audioSampleRateHz must return
// this same value.
constexpr int kAudioSampleRateHz = 48000;

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
        // reset() (not called by loadGbaCore -- see gba_link_jni.cpp) must
        // run AFTER setVideoBuffer: mGBA's _GBACoreReset only associates
        // the video renderer with the core if outputBuffer is already set
        // at that moment, or every frame renders into nothing.
        p.core->reset(p.core);

        // Same audio setup as gba_jni.cpp's nativeCreate, done per core --
        // each side's own blip_buf ring buffer is read out independently
        // by readAudioSamples() below.
        p.core->setAudioBufferSize(p.core, 2048);
        blip_set_rates(p.core->getAudioChannel(p.core, 0), p.core->frequency(p.core), kAudioSampleRateHz);
        blip_set_rates(p.core->getAudioChannel(p.core, 1), p.core->frequency(p.core), kAudioSampleRateHz);

        GBASIOLockstepNodeCreate(&p.node);
        GBASIOLockstepAttachNode(&lockstep_, &p.node);
        p.id = p.node.id;

        // GBASIOSetDriver (the call that makes this core's own SIO port
        // actually look "attached" to the running game) is deliberately
        // NOT made here -- see kWarmupFrames. Each runLoop attaches its
        // own core's driver itself, from its own thread, once it's done
        // warming up -- see runLoop.
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

    int framesUntilAttach = kWarmupFrames;

    while (p.running.load(std::memory_order_relaxed)) {
        // May block for a real, unpredictable duration inside here --
        // see the header comment -- whenever the lockstep protocol needs
        // this side to wait on the other one. Only possible at all once
        // the driver below is actually attached; every call before that
        // is a plain, unlinked runFrame() like single-player GbaView's.
        p.core->runFrame(p.core);

        if (framesUntilAttach > 0 && --framesUntilAttach == 0) {
            // The slave's attach (below, via GBASIOLockstepNodeLoad) reads
            // the master's node.d.p to clear its slave bit -- it must not
            // run until the master has attached and set that pointer.
            // Each side warms up on its own thread with no shared timer,
            // so without this wait the slave can easily win the race and
            // dereference the master's still-null node.d.p.
            if (id != 0) {
                while (!masterAttached_.load(std::memory_order_acquire) &&
                       p.running.load(std::memory_order_relaxed)) {
                    std::this_thread::sleep_for(std::chrono::milliseconds(1));
                }
            }
            auto* gba = static_cast<GBA*>(p.core->board);
            GBASIOSetDriver(&gba->sio, &p.node.d, SIO_MULTI);
            GBASIOSetDriver(&gba->sio, &p.node.d, SIO_NORMAL_32);
            if (id == 0) {
                masterAttached_.store(true, std::memory_order_release);
            }
            LLOG("player %d: link driver attached after warmup", id);
        }

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

void LinkedGbaSession::getFramebuffer(int player, uint32_t* outArgb) const {
    const Player& p = players_[player];
    std::lock_guard<std::mutex> lock(p.frameMutex);
    std::copy(p.frontBuffer.begin(), p.frontBuffer.end(), outArgb);
}

int LinkedGbaSession::readAudioSamples(int player, int16_t* outSamples, int outCapacityFrames) const {
    mCore* core = players_[player].core;
    blip_t* left = core->getAudioChannel(core, 0);
    blip_t* right = core->getAudioChannel(core, 1);

    int availableFrames = blip_samples_avail(left);
    int frames = availableFrames < outCapacityFrames ? availableFrames : outCapacityFrames;
    if (frames <= 0) return 0;

    blip_read_samples(left, outSamples, frames, 1);
    blip_read_samples(right, outSamples + 1, frames, 1);
    return frames;
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
    LLOG("signal(mask=%u) waitMaskAfter=%d awake=%d woke=%d transfer=%d", mask, player.waitMask, player.awake, woke,
         self->lockstep_.d.transferActive);
    return woke;
}

bool LinkedGbaSession::waitCb(mLockstep* ls, unsigned mask) {
    auto* self = static_cast<LinkedGbaSession*>(ls->context);
    Player& player = self->players_[0];
    bool slept = false;
    player.waitMask |= static_cast<int>(mask);
    LLOG("wait(mask=%u) waitMaskAfter=%d awakeBefore=%d transfer=%d", mask, player.waitMask, player.awake,
         self->lockstep_.d.transferActive);
    if (player.awake > 0) {
        // Defensive top-up before going quiet ourselves: addCycles(0,
        // ...) -- the only thing that ever refills the other player's
        // cycle bank -- is called AFTER this wait() returns (see
        // mGBA's own lockstep.c), not before. If the other player's
        // bank also happens to hit zero at this exact instant, it
        // blocks in useCyclesCb too, and neither side can call the
        // addCycles that would wake the other -- confirmed live via
        // logcat as the actual deadlock past the first one. Crediting
        // it generously here, right before we go quiet, guarantees it
        // has enough runway to keep running and eventually signal us.
        for (unsigned bit = 1; bit < 2; bit++) {
            if (!(mask & (1u << bit))) continue;
            Player& other = self->players_[bit];
            other.cyclesPosted += kWaitTopUpCycles;
            self->wakePlayer(other);
            other.awake = 1;
        }

        // Set BEFORE blocking, not after -- blockPlayer releases
        // bigLock_ while it sleeps (see its own comment), so another
        // thread's signalCb can run concurrently and will check this
        // exact flag to decide whether to wake us. Setting it only
        // after blockPlayer returns leaves a window where we're
        // genuinely asleep but still look "awake" to that check, so the
        // signal that was supposed to wake us gets silently dropped --
        // a classic lost-wakeup, and the actual deadlock this session
        // kept reproducing.
        player.awake = 0;
        self->blockPlayer(player);
        slept = true;
    }
    LLOG("wait(mask=%u) RETURNED slept=%d", mask, slept);
    return slept;
}

void LinkedGbaSession::addCyclesCb(mLockstep* ls, int id, int32_t cycles) {
    auto* self = static_cast<LinkedGbaSession*>(ls->context);
    if (id == 0) {
        Player& other = self->players_[1];
        if (other.node.mode > SIO_MULTI) {
            // Not currently in a connected link mode on that side -- has
            // nothing to do with this transfer.
            LLOG("addCycles(0, %d) SKIPPED other.mode=%d", cycles, other.node.mode);
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
        LLOG("addCycles(0, %d) other.cyc=%d other.awake=%d", cycles, other.cyclesPosted, other.awake);
    } else {
        self->players_[id].cyclesPosted += cycles;
        LLOG("addCycles(%d, %d) cyc=%d", id, cycles, self->players_[id].cyclesPosted);
    }
}

int32_t LinkedGbaSession::useCyclesCb(mLockstep* ls, int id, int32_t cycles) {
    auto* self = static_cast<LinkedGbaSession*>(ls->context);
    Player& p = self->players_[id];
    p.cyclesPosted -= cycles;
    LLOG("useCycles(%d, %d) cycAfter=%d transfer=%d", id, cycles, p.cyclesPosted, self->lockstep_.d.transferActive);
    if (p.cyclesPosted <= 0) {
        // Set BEFORE blocking -- see waitCb's comment, same lost-wakeup
        // hazard applies here (addCyclesCb's id==0 branch checks this
        // exact flag to decide whether to post/wake).
        p.awake = 0;
        LLOG("useCycles(%d) BLOCKING", id);
        self->blockPlayer(p);
        LLOG("useCycles(%d) WOKE cyc=%d", id, p.cyclesPosted);
    }
    return p.cyclesPosted;
}

int32_t LinkedGbaSession::unusedCyclesCb(mLockstep* ls, int id) {
    auto* self = static_cast<LinkedGbaSession*>(ls->context);
    int32_t v = self->players_[id].cyclesPosted;
    LLOG("unusedCycles(%d) = %d transfer=%d", id, v, self->lockstep_.d.transferActive);
    return v;
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
