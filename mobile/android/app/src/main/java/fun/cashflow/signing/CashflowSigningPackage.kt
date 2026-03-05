package `fun`.cashflow.signing

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class CashflowSigningPackage : BaseReactPackage() {

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
    return if (name == CashflowSigningModule.NAME) {
      CashflowSigningModule(reactContext)
    } else {
      null
    }
  }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
    return ReactModuleInfoProvider {
      mapOf(
        CashflowSigningModule.NAME to ReactModuleInfo(
          CashflowSigningModule.NAME,
          CashflowSigningModule.NAME,
          false,
          false,
          false,
          true
        )
      )
    }
  }
}
