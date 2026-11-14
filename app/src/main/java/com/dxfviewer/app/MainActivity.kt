package com.dxfviewer.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.View
import android.view.WindowInsets
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.ByteArrayInputStream

/**
 * DXF Viewer — a native Android shell around a fast canvas-based DXF renderer
 * (bundled in assets/index.html). Works fully offline.
 *
 *  • "Open" button → system file picker (Downloads, Drive, WhatsApp docs, etc.)
 *  • Opening a .dxf / .dwg from a file manager / "Open with" / Share → loads directly
 *  • DWG files are converted on-device by LibreDWG (WebAssembly, assets/libredwg)
 *
 * Assets and the opened file are served from a virtual https origin so that ES modules and
 * WebAssembly load correctly (they are blocked on file:// URLs).
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private var pageReady = false
    private var queuedUri: Uri? = null
    @Volatile private var currentUri: Uri? = null
    private var fileSeq = 0

    companion object {
        private const val PICK_DXF = 4021
        private const val HOST = "appassets.androidplatform.net"
        private const val ORIGIN = "https://$HOST"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.parseColor("#14171D")
        window.navigationBarColor = Color.parseColor("#14171D")

        web = WebView(this)
        web.setBackgroundColor(Color.parseColor("#0E1014"))
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            builtInZoomControls = false
            setSupportZoom(false)
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, req: WebResourceRequest): WebResourceResponse? =
                serve(req.url)
        }
        web.webChromeClient = WebChromeClient()
        web.addJavascriptInterface(Bridge(), "Android")
        setContentView(web)
        applyInsets(web)

        web.loadUrl("$ORIGIN/assets/index.html")
        handleIntent(intent)
    }

    /** Keep the UI clear of the status bar / gesture bar on edge-to-edge devices. */
    private fun applyInsets(v: View) {
        v.setOnApplyWindowInsetsListener { view, insets ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val b = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                view.setPadding(b.left, b.top, b.right, b.bottom)
            } else {
                @Suppress("DEPRECATION")
                view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop,
                    insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        val uri: Uri? = when (intent?.action) {
            Intent.ACTION_VIEW -> intent.data
            Intent.ACTION_SEND -> streamExtra(intent)
            else -> null
        }
        if (uri != null) {
            if (pageReady) loadUri(uri) else queuedUri = uri
        }
    }

    @Suppress("DEPRECATION")
    private fun streamExtra(intent: Intent): Uri? =
        if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else intent.getParcelableExtra(Intent.EXTRA_STREAM)

    private fun pickFile() {
        val i = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"   // many devices don't tag .dxf with a MIME type, so allow all and validate in the viewer
        }
        startActivityForResult(i, PICK_DXF)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == PICK_DXF && resultCode == RESULT_OK) data?.data?.let { loadUri(it) }
    }

    private fun displayName(uri: Uri): String {
        try {
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    val n = c.getString(0)
                    if (!n.isNullOrBlank()) return n
                }
            }
        } catch (_: Exception) { }
        return uri.lastPathSegment?.substringAfterLast('/') ?: "drawing.dxf"
    }

    private fun mimeFor(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
        "html" -> "text/html"
        "js", "mjs", "cjs" -> "text/javascript"
        "wasm" -> "application/wasm"
        "json", "map" -> "application/json"
        "css" -> "text/css"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        else -> "application/octet-stream"
    }

    /** Serves /assets/... from the APK and /__file/... from the currently opened document. */
    private fun serve(url: Uri): WebResourceResponse? {
        if (url.host != HOST) return null
        val path = url.path ?: return null
        val headers = mapOf("Access-Control-Allow-Origin" to "*", "Cache-Control" to "no-store")
        return try {
            when {
                path.startsWith("/assets/") -> {
                    val name = path.removePrefix("/assets/")
                    WebResourceResponse(mimeFor(name), if (name.endsWith(".wasm")) null else "utf-8",
                        200, "OK", headers, assets.open(name))
                }
                path.startsWith("/__file/") -> {
                    val uri = currentUri ?: return notFound()
                    val stream = contentResolver.openInputStream(uri) ?: return notFound()
                    WebResourceResponse("application/octet-stream", null, 200, "OK", headers, stream)
                }
                else -> notFound()
            }
        } catch (e: Exception) { notFound() }
    }

    private fun notFound() = WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
        mapOf("Access-Control-Allow-Origin" to "*"), ByteArrayInputStream(ByteArray(0)))

    private fun loadUri(uri: Uri) {
        currentUri = uri
        val name = displayName(uri)
        fileSeq++
        web.evaluateJavascript("window.onNativeFile(${jsString(name)}, ${jsString("$ORIGIN/__file/$fileSeq")})", null)
    }

    private fun jsString(s: String): String =
        "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ").replace("\u2028", " ").replace("\u2029", " ") + "\""

    inner class Bridge {
        @JavascriptInterface fun openFile() = runOnUiThread { pickFile() }

        @JavascriptInterface fun ready() = runOnUiThread {
            pageReady = true
            queuedUri?.let { queuedUri = null; loadUri(it) }
        }
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }
}
