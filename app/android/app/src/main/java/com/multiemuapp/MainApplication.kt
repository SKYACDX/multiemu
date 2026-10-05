package com.multiemuapp

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.multiemu.dscore.DsPackage
import com.multiemu.gbacore.GbaPackage
import com.multiemu.gbcore.GameBoyPackage
import com.multiemu.n3dscore.N3dsPackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(GameBoyPackage())
          add(GbaPackage())
          add(DsPackage())
          add(N3dsPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
