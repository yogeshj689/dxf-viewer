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
        versionCode = 3
        versionName = "1.1"
    }

    // Fixed signing key so every new build installs as an update over the previous one.
    // (Fine for sideloading. For Google Play, create a private key and keep it out of the repo.)
    signingConfigs {
        create("release") {
            storeFile = file("dxfviewer-release.jks")
            storePassword = "dxfviewer123"
            keyAlias = "dxfviewer"
            keyPassword = "dxfviewer123"
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
