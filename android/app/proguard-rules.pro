# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# ── sherpa-onnx: keep ALL classes from the AAR ──────────────────────────────
# The AAR is loaded via fileTree (not Maven), so R8 doesn't see its consumer
# ProGuard rules. The native JNI layer calls back into Java by class name —
# if R8 renames or strips ANY of these, you get a SIGSEGV at model init time.
-keep class com.k2fsa.sherpa.onnx.** { *; }
-keepclassmembers class com.k2fsa.sherpa.onnx.** { native <methods>; }
-dontwarn com.k2fsa.sherpa.onnx.**

# ── ONNX Runtime (bundled inside sherpa-onnx AAR) ───────────────────────────
# sherpa-onnx bundles onnxruntime internally. Its native code reflects into
# these Java classes for session management, tensor allocation, etc.
-keep class ai.onnxruntime.** { *; }
-keepclassmembers class ai.onnxruntime.** { native <methods>; }
-dontwarn ai.onnxruntime.**

# Also cover the Microsoft ONNX Runtime package name variant
-keep class com.microsoft.onnxruntime.** { *; }
-dontwarn com.microsoft.onnxruntime.**

# ── JNI / Reflection safety net ─────────────────────────────────────────────
# Preserve annotations and inner classes needed for JNI callbacks
-keepattributes *Annotation*
-keepattributes InnerClasses
-keepattributes Signature

# Keep all native methods across the entire app (JNI safety net)
-keepclasseswithmembernames class * {
    native <methods>;
}
