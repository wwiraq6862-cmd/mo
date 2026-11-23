import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    id("kotlin-android")
    id("dev.flutter.flutter-gradle-plugin")
}

val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
val hasKeystoreFile = keystorePropertiesFile.exists()
if (hasKeystoreFile) {
    FileInputStream(keystorePropertiesFile).use { keystoreProperties.load(it) }
}

val hasValidReleaseSigning = hasKeystoreFile &&
    !keystoreProperties.getProperty("storeFile").isNullOrBlank() &&
    !keystoreProperties.getProperty("storePassword").isNullOrBlank() &&
    !keystoreProperties.getProperty("keyAlias").isNullOrBlank() &&
    !keystoreProperties.getProperty("keyPassword").isNullOrBlank()

val customAppId = (project.findProperty("HAMILHA_APP_ID") as String?)?.trim()
    ?.takeIf { it.isNotEmpty() } ?: "com.hamilha.app"
val allowDebugReleaseSigning =
    (project.findProperty("allowDebugSigning") as String?)?.equals("true", ignoreCase = true) == true
val isPlayStoreBundleTask = gradle.startParameter.taskNames.any {
    it.contains("bundleRelease", ignoreCase = true)
}

android {
    namespace = "com.hamilha.app"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        isCoreLibraryDesugaringEnabled = true
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        // استبدل com.hamilha.app بمعرفك الفريد قبل النشر (أو مرّر -PHAMILHA_APP_ID=com.yourcompany.hamilha)
        applicationId = customAppId
        minSdk = 24
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        multiDexEnabled = true
    }

    signingConfigs {
        if (hasValidReleaseSigning) {
            create("release") {
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            signingConfig = if (hasValidReleaseSigning) {
                signingConfigs.getByName("release")
            } else {
                if (isPlayStoreBundleTask && !allowDebugReleaseSigning) {
                    throw GradleException(
                        "HAMILHA: Cannot build a Google Play release App Bundle without android/key.properties. " +
                            "Copy android/key.properties.example to android/key.properties with your release keystore, " +
                            "or pass -PallowDebugSigning=true for local testing only."
                    )
                }
                logger.warn("HAMILHA: android/key.properties not configured; using debug keystore for local release testing only (NOT valid for Google Play).")
                signingConfigs.getByName("debug")
            }
        }
    }
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.2")
}

flutter {
    source = "../.."
}
