// Entry point into ds_platform.cpp's Platform:: implementation that
// isn't part of melonDS's own Platform.h -- call once at startup with
// the app's private files directory before touching any NDS instance.
#pragma once

#include <string>

namespace melonDS::Platform {
void SetLocalDir(const std::string& dir);
}
