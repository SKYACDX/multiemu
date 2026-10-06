package com.multiemuapp

import android.content.Intent
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "MultiEmuApp"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  /**
   * A save picked for import can come back to a freshly restarted app, before
   * React is up to receive it -- noted here so the next start can offer to
   * finish the import (com.multiemu.gbcore.PendingSaveImport).
   */
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode == com.multiemu.gbcore.PendingSaveImport.REQUEST_CODE && resultCode == RESULT_OK) {
      data?.data?.let { com.multiemu.gbcore.PendingSaveImport.rememberResult(this, it) }
    }
    super.onActivityResult(requestCode, resultCode, data)
  }
}
