# DXF Viewer — Android app

An offline DXF drawing viewer for Android phones and tablets (Android 7.0+).

## Features
- Opens ASCII DXF files (AutoCAD R12 → 2018+) from the **Open** button, from any file manager ("Open with → DXF Viewer"), or via **Share**
- Pinch to zoom, drag to pan, double-tap to zoom to fit
- Layers panel: turn layers on/off, see entity counts and colours
- Measure tool: tap two points (snaps to endpoints, centres, quadrants) → distance, Δx, Δy, angle
- Dark / light background, live coordinates and scale bar, drawing units from the file
- Supported entities: LINE, ARC, CIRCLE, ELLIPSE, LWPOLYLINE / POLYLINE (with arcs/bulges), SPLINE (NURBS), TEXT, MTEXT, ATTRIB, INSERT (blocks, nested, arrays), DIMENSION, HATCH, SOLID, 3DFACE, LEADER, POINT, true colour and AutoCAD colour index
- Works with no internet connection; nothing leaves the phone

Not supported: binary DXF (save as ASCII DXF), DWG files, 3D views, linetypes (dashes draw as solid lines).

## Build the APK — option A: Android Studio (easiest)
1. Install Android Studio (free) from developer.android.com/studio.
2. **File → Open** → choose this `DxfViewer` folder. Let Gradle sync finish.
3. **Build → Build App Bundle(s) / APK(s) → Build APK(s)**.
4. The APK is at `app/build/outputs/apk/debug/app-debug.apk`. Copy it to your phone and install
   (allow "Install unknown apps" when asked). Or plug your phone in with USB debugging on and press ▶ Run.

## Build the APK — option B: GitHub (no software to install)
1. Create a new GitHub repository and upload the contents of this folder (including the hidden `.github` folder).
2. Open the **Actions** tab → "Build APK" runs automatically (about 3–5 minutes).
3. Open the finished run → download **DXF-Viewer-apk** → unzip → install the `.apk` on your phone.

## Build from the command line
```
./gradlew assembleRelease      # needs JDK 17+ and the Android SDK (ANDROID_HOME set)
```

## Publishing to Google Play
Create your own signing key (Build → Generate Signed App Bundle in Android Studio), replace the
`signingConfig` line in `app/build.gradle.kts`, change `applicationId` to your own, and upload the `.aab`.

## Project layout
- `app/src/main/java/com/dxfviewer/app/MainActivity.kt` — native shell: file picker, "Open with"/Share handling, file decoding
- `app/src/main/assets/index.html` — the DXF parser and canvas renderer (touch gestures, layers, measure)
- `app/src/main/AndroidManifest.xml` — registers the app as a handler for .dxf files
