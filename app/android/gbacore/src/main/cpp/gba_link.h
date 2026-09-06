// Local (same-device) link cable: two mGBA cores connected through
// mGBA's own GBASIOLockstep -- the same mechanism its Qt frontend uses
// to run two Game Boy Advances in one process (see
// third_party/mgba/src/platform/qt/MultiplayerController.cpp, which this
// is a Qt-free, 2-player-only port of). Network play (the WebSocket
// relay) is a separate, later effort built on a custom SIO driver
// instead of this lockstep mechanism.
//
// Why this needs its own background thread per side: the lockstep
// protocol's `wait` callback can block the calling thread for an
// arbitrary real-world duration in the middle of mCore::runFrame() (SIO
// is cycle-accurate hardware -- one side genuinely has to pause until
// the other side is ready to exchange a byte). GbaView's normal
// single-player path calls runFrame() synchronously from a Choreographer
// vsync callback; doing that here would freeze the whole app's UI
// thread whenever a transfer stalls. So each linked side gets its own
// std::thread that can block freely, and the UI reads out whatever
// frame that thread most recently finished via a small double buffer.
#pragma once

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "mgba/core/core.h"
#include "mgba/core/interface.h"
#include "mgba/internal/gba/sio/lockstep.h"

class LinkedGbaSession {
public:
    // Takes ownership of both cores (already loaded/reset by the
    // caller, same as a standalone GbaNative) and starts both run
    // threads immediately.
    LinkedGbaSession(mCore* coreA, mCore* coreB);
    ~LinkedGbaSession();

    LinkedGbaSession(const LinkedGbaSession&) = delete;
    LinkedGbaSession& operator=(const LinkedGbaSession&) = delete;

    // player is 0 or 1. Copies out the most recently completed frame --
    // safe to call from any thread (the UI thread), doesn't touch the
    // emulation threads.
    void getFramebuffer(int player, uint32_t* outArgb) const;
    void setButtonPressed(int player, int buttonBit, bool pressed);
    unsigned width() const { return kWidth; }
    unsigned height() const { return kHeight; }

    // TEMPORARY diagnostic -- see App.tsx's debug overlay for this
    // feature. If this stays at 0 forever, runFrame() never returned
    // even once (most likely a lockstep deadlock); if it climbs
    // normally, the engine itself is fine and the bug is in the
    // rendering path instead. Delete once local link is confirmed
    // working end-to-end.
    uint64_t framesRun(int player) const { return players_[player].framesRun.load(std::memory_order_relaxed); }

    // TEMPORARY diagnostic -- SIO mode/cycle-bank state for both players,
    // read without bigLock_ (approximate/racy on purpose: this is a
    // throwaway debug overlay, not something correctness depends on).
    std::string debugState() const;

private:
    struct Player {
        mCore* core = nullptr;
        GBASIOLockstepNode node{};
        LinkedGbaSession* session = nullptr;
        int id = 0;

        // mLockstep's own bookkeeping (ported field-for-field from
        // MultiplayerController::Player / the lambdas below).
        int waitMask = 0;
        int awake = 1;
        int32_t cyclesPosted = 0;

        // What wakes/blocks this player's run thread: mCoreThreadStopWaiting
        // (Qt) / mCoreThreadWaitFromThread (Qt) become notify_one/wait on
        // this condition variable instead.
        std::mutex wakeMutex;
        std::condition_variable wakeCv;
        bool wakeRequested = false;

        std::thread runThread;
        std::atomic<bool> running{false};
        std::atomic<uint64_t> framesRun{0};  // TEMPORARY diagnostic, see framesRun() above.

        // What the core itself renders into each runFrame() (mGBA's own
        // color_t, not yet converted to Android's ARGB_8888).
        std::vector<color_t> rawBuffer;

        // Double-buffered output: the run thread writes `back`, then
        // swaps it into `front` under frameMutex once a frame completes.
        std::vector<uint32_t> frontBuffer;
        std::vector<uint32_t> backBuffer;
        mutable std::mutex frameMutex;
    };

    static constexpr unsigned kWidth = 240;
    static constexpr unsigned kHeight = 160;

    void runLoop(int id);
    void blockPlayer(Player& p);
    void wakePlayer(Player& p);

    // mLockstep callback trampolines (context is `this`).
    static void lockCb(mLockstep* ls);
    static void unlockCb(mLockstep* ls);
    static bool signalCb(mLockstep* ls, unsigned mask);
    static bool waitCb(mLockstep* ls, unsigned mask);
    static void addCyclesCb(mLockstep* ls, int id, int32_t cycles);
    static int32_t useCyclesCb(mLockstep* ls, int id, int32_t cycles);
    static int32_t unusedCyclesCb(mLockstep* ls, int id);
    static void unloadCb(mLockstep* ls, int id);

    GBASIOLockstep lockstep_{};
    // mLockstep::lock/unlock, called imperatively (not via RAII) from
    // scattered points in mGBA's own C code -- recursive so that if any
    // call path ever re-enters a lock/unlock pair on the same thread
    // (impossible to fully rule out by reading mGBA's C source alone,
    // without a debugger to step through it), it can't self-deadlock the
    // way a plain std::mutex would.
    std::recursive_mutex bigLock_;
    Player players_[2];
};
