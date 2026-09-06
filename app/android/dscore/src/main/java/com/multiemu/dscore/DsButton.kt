package com.multiemu.dscore

/** Ordinal must match DS's KeyInput bit order -- see ds_jni.cpp's DsSession::keyMask. */
enum class DsButton {
    A, B, SELECT, START, RIGHT, LEFT, UP, DOWN, R, L, X, Y
}
