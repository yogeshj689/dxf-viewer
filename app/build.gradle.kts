plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.dxfviewer.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.dxfviewer.app"
        minSdk = 24          // Android 7.0+
        targetSdk = 35
        versionCode = 2
        versionName = "1.1"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Signs release with the debug key so the APK installs straight away.
            // Replace with your own keystore before publishing to Google Play.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
