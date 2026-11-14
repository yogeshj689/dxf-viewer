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
import android.webkit.WebView
import android.webkit.WebViewClient
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction
import kotlin.concurrent.thread

/**
 * DXF Viewer — a native Android shell around a fast canvas-based DXF renderer
 * (bundled in assets/index.html). Works fully offline.
 *
 *  • "Open" button → system file picker (Downloads, Drive, WhatsApp docs, etc.)
 *  • Opening a .dxf from a file manager / "Open with" / Share → loads directly
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private var pendingText: String? = null
    private var pageReady = false
    private var queuedUri: Uri? = null

    companion object { private const val PICK_DXF = 4021 }

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
            allowFileAccess = true
            builtInZoomControls = false
            setSupportZoom(false)
        }
        web.webViewClient = WebViewClient()
        web.webChromeClient = WebChromeClient()
        web.addJavascriptInterface(Bridge(), "Android")
        setContentView(web)
        applyInsets(web)

        web.loadUrl("file:///android_asset/index.html")
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

    private fun decode(bytes: ByteArray): String = try {
        Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(bytes)).toString()
    } catch (e: CharacterCodingException) {
        String(bytes, Charset.forName("windows-1252"))   // older DXFs are ANSI encoded
    }

    private fun loadUri(uri: Uri) {
        thread {
            try {
                val name = displayName(uri)
                val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() }
                    ?: throw IllegalStateException("Could not open file")
                pendingText = decode(bytes)
                runOnUiThread { web.evaluateJavascript("window.onNativeFile(${jsString(name)})", null) }
            } catch (e: Throwable) {
                val msg = if (e is OutOfMemoryError) "This file is too large to open on this device."
                          else "Could not read file: ${e.message}"
                runOnUiThread { web.evaluateJavascript("window.onNativeError(${jsString(msg)})", null) }
            }
        }
    }

    private fun jsString(s: String): String =
        "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ").replace(" ", " ").replace(" ", " ") + "\""

    inner class Bridge {
        @JavascriptInterface fun openFile() = runOnUiThread { pickFile() }

        /** Hands the decoded file text to JS once, then frees it. */
        @JavascriptInterface fun takeText(): String? { val t = pendingText; pendingText = null; return t }

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
