// Implements melonDS's Platform:: interface (see
// third_party/melonds/src/Platform.h) for Android -- unlike mGBA, which
// already ships a complete, frontend-agnostic C API (mCore), melonDS's
// core expects the frontend to provide file I/O, threading primitives,
// logging, and save/firmware persistence itself. This is that frontend
// layer, kept separate from ds_jni.cpp (the actual JNI entry points)
// the same way gba_link.cpp is kept separate from gba_link_jni.cpp.
//
// Scope for now: local single-cart play, plus internet play through
// libslirp (Net_*, see below). Local wireless multiplayer (MP_*) and
// DSi-only peripherals (camera, mic, AAC/DSP audio, rumble/motion
// addons) are stubbed out -- safe no-ops, not crashes, but those
// features won't work until someone implements them for real.
#include "Platform.h"
#include "SPI_Firmware.h"

#include "Net.h"
#include "Net_Slirp.h"

#include <android/log.h>
#include <memory>
#include <cstdarg>
#include <cstdio>
#include <dlfcn.h>
#include <mutex>
#include <semaphore.h>
#include <cstring>
#include <string>
#include <vector>
#include <thread>
#include <unistd.h>
#include <cerrno>
#include <fcntl.h>

#define TAG "melonDS"

namespace melonDS::Platform {

// Set once at startup from JNI (see ds_jni.cpp's nativeInit) to the
// app's private files directory -- where BIOS/firmware images and
// melonDS's own config would live if it needs any local files.
static std::string g_localDir;

void SetLocalDir(const std::string& dir) { g_localDir = dir; }

// Shared with ds_jni.cpp, which reads this image back when it creates a
// session -- see WriteFirmware below.
// extern, because a namespace-scope `const` has internal linkage by
// default and ds_jni.cpp links against this.
extern const char* const kFirmwareFileName = "firmware.bin";

std::string GetLocalFilePath(const std::string& filename) { return g_localDir + "/" + filename; }

// ---- File I/O -- FileHandle is just a FILE* in a trench coat. ----

struct FileHandle {
    FILE* f;
};

static const char* ModeString(FileMode mode) {
    bool read = mode & Read, write = mode & Write, append = mode & Append;
    bool preserveExisting = (mode & Preserve) && (mode & NoCreate);
    if (append) return (mode & Text) ? "a" : "ab";
    if (read && write) return preserveExisting ? "r+b" : "w+b";
    if (write) return (mode & Text) ? "w" : "wb";
    return (mode & Text) ? "r" : "rb";
}

FileHandle* OpenFile(const std::string& path, FileMode mode) {
    if (!(mode & Read) && !(mode & Write)) return nullptr;
    if ((mode & Write) && (mode & Preserve) && (mode & NoCreate)) {
        // ReadWriteExisting-style: don't create, don't truncate.
        FILE* probe = fopen(path.c_str(), "rb");
        if (!probe) return nullptr;
        fclose(probe);
    }
    FILE* f = fopen(path.c_str(), ModeString(mode));
    if (!f) return nullptr;
    return new FileHandle{f};
}

FileHandle* OpenLocalFile(const std::string& path, FileMode mode) { return OpenFile(GetLocalFilePath(path), mode); }

bool FileExists(const std::string& name) {
    FILE* f = fopen(name.c_str(), "rb");
    if (!f) return false;
    fclose(f);
    return true;
}

bool LocalFileExists(const std::string& name) { return FileExists(GetLocalFilePath(name)); }

bool CheckFileWritable(const std::string& filepath) {
    FILE* f = fopen(filepath.c_str(), "ab");
    if (!f) return false;
    fclose(f);
    return true;
}

bool CheckLocalFileWritable(const std::string& filepath) { return CheckFileWritable(GetLocalFilePath(filepath)); }

bool CloseFile(FileHandle* file) {
    if (!file) return false;
    bool ok = fclose(file->f) == 0;
    delete file;
    return ok;
}

bool IsEndOfFile(FileHandle* file) { return feof(file->f) != 0; }

bool FileReadLine(char* str, int count, FileHandle* file) { return fgets(str, count, file->f) != nullptr; }

u64 FilePosition(FileHandle* file) { return static_cast<u64>(ftell(file->f)); }

bool FileSeek(FileHandle* file, s64 offset, FileSeekOrigin origin) {
    int whence = origin == FileSeekOrigin::Start ? SEEK_SET : origin == FileSeekOrigin::Current ? SEEK_CUR : SEEK_END;
    return fseek(file->f, static_cast<long>(offset), whence) == 0;
}

void FileRewind(FileHandle* file) { rewind(file->f); }

u64 FileRead(void* data, u64 size, u64 count, FileHandle* file) { return fread(data, size, count, file->f); }

bool FileFlush(FileHandle* file) { return fflush(file->f) == 0; }

u64 FileWrite(const void* data, u64 size, u64 count, FileHandle* file) { return fwrite(data, size, count, file->f); }

u64 FileWriteFormatted(FileHandle* file, const char* fmt, ...) {
    va_list args;
    va_start(args, fmt);
    int n = vfprintf(file->f, fmt, args);
    va_end(args);
    return n < 0 ? 0 : static_cast<u64>(n);
}

u64 FileLength(FileHandle* file) {
    long pos = ftell(file->f);
    fseek(file->f, 0, SEEK_END);
    long len = ftell(file->f);
    fseek(file->f, pos, SEEK_SET);
    return static_cast<u64>(len);
}

// ---- Logging ----

void Log(LogLevel level, const char* fmt, ...) {
    int prio = level == LogLevel::Debug ? ANDROID_LOG_DEBUG
             : level == LogLevel::Info  ? ANDROID_LOG_INFO
             : level == LogLevel::Warn  ? ANDROID_LOG_WARN
                                        : ANDROID_LOG_ERROR;
    va_list args;
    va_start(args, fmt);
    __android_log_vprint(prio, TAG, fmt, args);
    va_end(args);
}

// ---- Threading ----

struct Thread {
    std::thread t;
};

Thread* Thread_Create(std::function<void()> func) { return new Thread{std::thread(std::move(func))}; }

void Thread_Free(Thread* thread) {
    if (thread->t.joinable()) thread->t.detach();
    delete thread;
}

void Thread_Wait(Thread* thread) {
    if (thread->t.joinable()) thread->t.join();
}

struct Semaphore {
    sem_t sem;
};

Semaphore* Semaphore_Create() {
    auto* s = new Semaphore();
    sem_init(&s->sem, 0, 0);
    return s;
}

void Semaphore_Free(Semaphore* sema) {
    sem_destroy(&sema->sem);
    delete sema;
}

void Semaphore_Reset(Semaphore* sema) {
    while (sem_trywait(&sema->sem) == 0) {}
}

void Semaphore_Wait(Semaphore* sema) { sem_wait(&sema->sem); }

bool Semaphore_TryWait(Semaphore* sema, int timeout_ms) {
    if (timeout_ms <= 0) return sem_trywait(&sema->sem) == 0;
    timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    ts.tv_sec += timeout_ms / 1000;
    ts.tv_nsec += (timeout_ms % 1000) * 1000000;
    if (ts.tv_nsec >= 1000000000) {
        ts.tv_sec += 1;
        ts.tv_nsec -= 1000000000;
    }
    return sem_timedwait(&sema->sem, &ts) == 0;
}

void Semaphore_Post(Semaphore* sema, int count) {
    for (int i = 0; i < count; i++) sem_post(&sema->sem);
}

struct Mutex {
    std::mutex m;
};

Mutex* Mutex_Create() { return new Mutex(); }
void Mutex_Free(Mutex* mutex) { delete mutex; }
void Mutex_Lock(Mutex* mutex) { mutex->m.lock(); }
void Mutex_Unlock(Mutex* mutex) { mutex->m.unlock(); }
bool Mutex_TryLock(Mutex* mutex) { return mutex->m.try_lock(); }

void Sleep(u64 usecs) { std::this_thread::sleep_for(std::chrono::microseconds(usecs)); }

u64 GetMSCount() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

u64 GetUSCount() {
    using namespace std::chrono;
    return duration_cast<microseconds>(steady_clock::now().time_since_epoch()).count();
}

// ---- Save/firmware persistence ----
//
// userdata is whatever was passed to NDS's constructor -- see
// ds_jni.cpp, which sets it to a DsUserData* carrying this instance's
// save file path. NDS/GBA save memory is always written back in full
// (savedata/savelen cover the whole buffer; writeoffset/writelen just
// say what changed), so the simplest correct thing is to rewrite the
// whole file every time -- these calls aren't hot-path/high-frequency.

void SignalStop(StopReason reason, void* userdata) {
    Log(LogLevel::Info, "[melonDS] SignalStop reason=%d\n", static_cast<int>(reason));
}

// Through path.tmp, synced and renamed over the save: killing the app in
// the middle of a write used to leave a truncated save, the one thing a
// player can't get back. rename() replaces the old file in one step.
// A save that couldn't be written is logged with the reason: losing one
// silently is the worst thing that can happen to a player. The directory is
// synced after the rename so the rename itself survives a power cut.
static void WriteSaveAtomically(const std::string& path, const u8* data, u32 length) {
    const std::string temporary = path + ".tmp";
    FILE* f = fopen(temporary.c_str(), "wb");
    if (!f) {
        __android_log_print(ANDROID_LOG_ERROR, TAG, "save: cannot open %s: %s", temporary.c_str(), strerror(errno));
        return;
    }
    const bool written = fwrite(data, 1, length, f) == length && fflush(f) == 0 && fsync(fileno(f)) == 0;
    const int writeError = errno;
    fclose(f);
    if (!written) {
        __android_log_print(ANDROID_LOG_ERROR, TAG, "save: cannot write %s: %s", temporary.c_str(), strerror(writeError));
        remove(temporary.c_str());
        return;
    }
    if (rename(temporary.c_str(), path.c_str()) != 0) {
        __android_log_print(ANDROID_LOG_ERROR, TAG, "save: cannot replace %s: %s", path.c_str(), strerror(errno));
        remove(temporary.c_str());
        return;
    }
    const std::string directory = path.substr(0, path.find_last_of('/'));
    const int dirFd = open(directory.c_str(), O_RDONLY | O_DIRECTORY);
    if (dirFd >= 0) {
        fsync(dirFd);
        close(dirFd);
    }
}

void WriteNDSSave(const u8* savedata, u32 savelen, u32 writeoffset, u32 writelen, void* userdata) {
    auto* path = static_cast<const std::string*>(userdata);
    if (!path || path->empty()) return;
    WriteSaveAtomically(*path, savedata, savelen);
}

// Same shape as WriteNDSSave -- userdata is the inserted GBA cart's own
// save path (see ds_jni.cpp's nativeInsertGbaCart), so Pal Park-style
// transfers (melonDS's GBACart slot-2 emulation) persist across
// sessions the same way the main NDS cart's save does.
void WriteGBASave(const u8* savedata, u32 savelen, u32 writeoffset, u32 writelen, void* userdata) {
    auto* path = static_cast<const std::string*>(userdata);
    if (!path || path->empty()) return;
    WriteSaveAtomically(*path, savedata, savelen);
}

// TODO: persist firmware changes (e.g. the user's DS settings) back to
// disk -- for now firmware edits made in a session don't survive a
// restart. Not needed for a game to boot and play.
// Called whenever the emulated console writes to its own firmware --
// which is exactly what a game's "Nintendo WFC settings" screen does.
// Those settings (access point, WEP key, DNS) live in the firmware, not
// in any cartridge, so persisting the image here is what makes the setup
// a once-per-device job instead of a once-per-ROM one: every game reads
// the same firmware back (see ds_jni.cpp, which loads this file when it
// builds a session).
//
// Writes the whole image rather than just [writeoffset, writelen): it's
// a couple of hundred KB, this happens only when a game deliberately
// saves settings, and a partial write that lands wrong would leave an
// image no game can read.
void WriteFirmware(const Firmware& firmware, u32 writeoffset, u32 writelen, void* userdata) {
    // melonDS calls this on every firmware SPI write, which comes in
    // bursts -- six identical ones during a single boot, measured. Only
    // the changes are worth a 128K file write, so compare first.
    static std::vector<u8> lastWritten;
    const u8* buffer = firmware.Buffer();
    const u32 length = firmware.Length();
    if (lastWritten.size() == length && memcmp(lastWritten.data(), buffer, length) == 0) return;
    lastWritten.assign(buffer, buffer + length);

    const std::string path = GetLocalFilePath(kFirmwareFileName);
    FILE* f = fopen(path.c_str(), "wb");
    if (!f) {
        __android_log_print(ANDROID_LOG_ERROR, TAG, "firmware: could not open %s for writing", path.c_str());
        return;
    }
    const size_t written = fwrite(buffer, 1, length, f);
    fclose(f);
    __android_log_print(ANDROID_LOG_INFO, TAG, "firmware: saved %zu/%u bytes", written, length);
}

// TODO: persist the emulated RTC's date/time if a game changes it.
void WriteDateTime(int year, int month, int day, int hour, int minute, int second, void* userdata) {}

// ---- Local multiplayer -- not implemented yet. ----

void MP_Begin(void* userdata) {}
void MP_End(void* userdata) {}
int MP_SendPacket(u8* data, int len, u64 timestamp, void* userdata) { return 0; }
int MP_RecvPacket(u8* data, u64* timestamp, void* userdata) { return 0; }
int MP_SendCmd(u8* data, int len, u64 timestamp, void* userdata) { return 0; }
int MP_SendReply(u8* data, int len, u64 timestamp, u16 aid, void* userdata) { return 0; }
int MP_SendAck(u8* data, int len, u64 timestamp, void* userdata) { return 0; }
int MP_RecvHostPacket(u8* data, u64* timestamp, void* userdata) { return 0; }
u16 MP_RecvReplies(u8* data, u64 timestamp, u16 aidmask, void* userdata) { return 0; }

// ---- Internet play ----
//
// Slirp ("indirect" mode): melonDS is a virtual router doing NAT over
// ordinary host sockets, which is the only workable option on Android --
// the alternative, Net_PCap, needs raw access to a network adapter.
//
// The DS itself doesn't need a real access point either: melonDS
// emulates one (WifiAP.cpp, "melonAP"), and it is that AP which calls
// these two functions to push packets out and pull them back in. So a
// game's Nintendo WFC connection setup talks to an access point that
// exists only inside the emulator.
//
// Built lazily, on the first packet a game actually sends: most sessions
// never touch wifi, and there's no reason to stand up a network stack
// for them. Only ever called from the emulation thread.
static Net g_net;
static bool g_netStarted = false;

static Net& EnsureNet() {
    if (!g_netStarted) {
        g_netStarted = true;
        g_net.SetDriver(std::make_unique<Net_Slirp>([](const u8* data, int len) { g_net.RXEnqueue(data, len); }));
        // One emulated console, so one instance, id 0 -- melonDS's Net
        // supports several for its multi-window builds.
        g_net.RegisterInstance(0);
        __android_log_print(ANDROID_LOG_INFO, TAG, "Net: slirp driver up");
    }
    return g_net;
}

int Net_SendPacket(u8* data, int len, void* userdata) {
    EnsureNet().SendPacket(data, len, 0);
    return 0;
}

int Net_RecvPacket(u8* data, void* userdata) {
    // Net::RecvPacket pumps the driver itself (Driver->RecvCheck), so
    // there's nothing else to tick on a timer.
    return EnsureNet().RecvPacket(data, 0);
}

// ---- DSi-only peripherals -- not implemented yet. ----

void Camera_Start(int num, void* userdata) {}
void Camera_Stop(int num, void* userdata) {}
void Camera_CaptureFrame(int num, u32* frame, int width, int height, bool yuv, void* userdata) {}

void Mic_Start(void* userdata) {}
void Mic_Stop(void* userdata) {}
int Mic_ReadInput(s16* data, int maxlength, void* userdata) { return 0; }

AACDecoder* AAC_Init() { return nullptr; }
void AAC_DeInit(AACDecoder* dec) {}
bool AAC_Configure(AACDecoder* dec, int frequency, int channels) { return false; }
bool AAC_DecodeFrame(AACDecoder* dec, const void* input, int inputlen, void* output, int outputlen) { return false; }

// ---- Addon peripherals (Guitar Grip, Rumble Pak, Motion Pak) -- not implemented yet. ----

bool Addon_KeyDown(KeyType type, void* userdata) { return false; }
void Addon_RumbleStart(u32 len, void* userdata) {}
void Addon_RumbleStop(void* userdata) {}
float Addon_MotionQuery(MotionQueryType type, void* userdata) { return 0.0f; }

// ---- Dynamic library loading. ----
//
// Not there for a plugin system -- ARMJIT_Memory.cpp uses this to look up
// ASharedMemory_create from libandroid.so at runtime (it's only available
// from API 26+, so melonDS probes for it instead of linking it directly),
// falling back to opening /dev/ashmem by hand if the lookup fails. That
// fallback is blocked by SELinux for regular apps on modern Android (the
// open() is denied, but the code presses on with the resulting bad fd and
// segfaults on the following ftruncate/mmap) -- this stub returning
// nullptr unconditionally forced every build onto that broken fallback
// path, which is what made enabling the JIT crash instantly on ROM load.
// A plain dlopen/dlsym/dlclose is all melonDS actually asks of this API.

DynamicLibrary* DynamicLibrary_Load(const char* lib) { return reinterpret_cast<DynamicLibrary*>(dlopen(lib, RTLD_LAZY)); }
void DynamicLibrary_Unload(DynamicLibrary* lib) { dlclose(reinterpret_cast<void*>(lib)); }
void* DynamicLibrary_LoadFunction(DynamicLibrary* lib, const char* name) { return dlsym(reinterpret_cast<void*>(lib), name); }

}  // namespace melonDS::Platform
