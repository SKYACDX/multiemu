cmake_minimum_required(VERSION 3.22)
project(n3dsjni CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# The core itself (libazahar_libretro.so) is not linked: it is dlopen()ed at
# run time and driven through its libretro entry points, the same way the
# desktop port loads azahar_libretro.dll. Only libretro.h is needed here.
set(AZAHAR_ROOT ${CMAKE_CURRENT_SOURCE_DIR}/../../../../../../third_party/azahar)

add_library(n3dsjni SHARED n3ds_jni.cpp)
target_include_directories(n3dsjni PRIVATE ${AZAHAR_ROOT}/externals/libretro-common/libretro-common/include)
target_link_libraries(n3dsjni PRIVATE android log EGL GLESv3 dl)
