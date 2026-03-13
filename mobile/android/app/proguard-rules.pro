# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# --- Hermes ---
-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.jni.** { *; }

# --- React Native ---
-keep,allowobfuscation @interface com.facebook.proguard.annotations.DoNotStrip
-keep,allowobfuscation @interface com.facebook.proguard.annotations.KeepGettersAndSetters
-keep @com.facebook.proguard.annotations.DoNotStrip class *
-keepclassmembers class * {
    @com.facebook.proguard.annotations.DoNotStrip *;
    @com.facebook.proguard.annotations.KeepGettersAndSetters *;
}
-keepclassmembers class * {
    @com.facebook.react.uimanager.annotations.ReactProp <methods>;
    @com.facebook.react.uimanager.annotations.ReactPropGroup <methods>;
}
-dontwarn com.facebook.react.**

# --- react-native-quick-crypto (native JNI) ---
-keep class com.margelo.quickcrypto.** { *; }

# --- react-native-keychain ---
-keep class com.oblador.keychain.** { *; }

# --- react-native-svg ---
-keep class com.horcrux.svg.** { *; }

# --- Okhttp / networking (used by React Native) ---
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**

# --- Keep native methods ---
-keepclasseswithmembernames class * {
    native <methods>;
}
