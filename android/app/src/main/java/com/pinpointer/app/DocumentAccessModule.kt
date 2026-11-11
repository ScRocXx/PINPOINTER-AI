package com.pinpointer.app

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.util.Log
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors

/**
 * DocumentAccessModule — PDF access that works without "All files access".
 *
 *  - pickPdfFolder(): the system folder picker (Storage Access Framework).
 *    Access to the chosen folder is kept across restarts.
 *  - pickPdfFiles(): the system file picker for one or more PDFs. This is
 *    how PDFs in the Download folder are reached, because Android 11+ does
 *    not let any app pick the Download folder itself.
 *  - Share to Pinpointer: PDFs shared from other apps arrive through
 *    MainActivity and are handed to JS as an event.
 *
 * Every PDF is copied into app storage (files/imported_pdfs/) so the
 * existing file-path based pipeline, viewer and share code keep working.
 */
class DocumentAccessModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx), ActivityEventListener {

    companion object {
        private const val TAG = "DocumentAccess"
        private const val REQ_FOLDER = 47101
        private const val REQ_FILES = 47102
        const val IMPORT_DIR = "imported_pdfs"
        const val EVENT_SHARED = "PinpointerSharedPdfs"

        private val io = Executors.newSingleThreadExecutor()
        private val pendingShared = mutableListOf<String>()
        @Volatile private var instance: DocumentAccessModule? = null

        /** Called by MainActivity for every launch / new intent. */
        @JvmStatic
        fun handleShareIntent(context: Context, intent: Intent?) {
            if (intent == null) return
            val uris = sharedUris(intent)
            if (uris.isEmpty()) return
            val appContext = context.applicationContext
            // The grant for shared URIs only lasts while the activity lives,
            // so copy straight away.
            io.execute {
                val paths = uris.mapNotNull { copyIntoApp(appContext, it) }
                if (paths.isEmpty()) return@execute
                synchronized(pendingShared) { pendingShared.addAll(paths) }
                instance?.emitShared()
            }
        }

        @Suppress("DEPRECATION")
        private fun sharedUris(intent: Intent): List<Uri> = when (intent.action) {
            Intent.ACTION_SEND ->
                listOfNotNull(intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))
            Intent.ACTION_SEND_MULTIPLE ->
                intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.toList() ?: emptyList()
            else -> emptyList()
        }

        private fun displayName(context: Context, uri: Uri): String? = try {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
        } catch (e: Exception) {
            null
        }

        private fun sizeOf(context: Context, uri: Uri): Long = try {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)
                ?.use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else -1L } ?: -1L
        } catch (e: Exception) {
            -1L
        }

        private fun shortHash(text: String): String {
            val bytes = MessageDigest.getInstance("SHA-1").digest(text.toByteArray())
            return bytes.take(5).joinToString("") { "%02x".format(it) }
        }

        /**
         * Copies a PDF behind a content:// URI into files/imported_pdfs/.
         * The name keeps the original file name (so search results read
         * well) plus a short hash of the URI (so two "scan.pdf" don't clash).
         * Skips the copy when an identical-size copy already exists.
         */
        fun copyIntoApp(context: Context, uri: Uri): String? {
            return try {
                val original = displayName(context, uri) ?: "document.pdf"
                val base = original.removeSuffix(".pdf").removeSuffix(".PDF")
                    .replace(Regex("[^\\p{L}\\p{N} ._()-]"), "_").take(80).ifBlank { "document" }
                val dir = File(context.filesDir, IMPORT_DIR).apply { mkdirs() }
                val target = File(dir, "$base-${shortHash(uri.toString())}.pdf")
                val size = sizeOf(context, uri)
                if (target.exists() && size >= 0 && target.length() == size) return target.absolutePath

                val tmp = File(dir, target.name + ".part")
                context.contentResolver.openInputStream(uri)?.use { input ->
                    tmp.outputStream().use { output -> input.copyTo(output, 64 * 1024) }
                } ?: return null
                if (tmp.length() == 0L) { tmp.delete(); return null }
                if (target.exists()) target.delete()
                if (!tmp.renameTo(target)) { tmp.delete(); return null }
                target.absolutePath
            } catch (e: Exception) {
                Log.w(TAG, "Could not copy $uri: ${e.message}")
                null
            }
        }
    }

    private var pendingPick: Promise? = null

    init {
        ctx.addActivityEventListener(this)
        instance = this
    }

    override fun getName() = "DocumentAccessModule"

    override fun invalidate() {
        if (instance === this) instance = null
        ctx.removeActivityEventListener(this)
        super.invalidate()
    }

    private fun emitShared() {
        if (!ctx.hasActiveReactInstance()) return
        val count = synchronized(pendingShared) { pendingShared.size }
        if (count == 0) return
        try {
            ctx.emitDeviceEvent(EVENT_SHARED, count)
        } catch (e: Exception) {
            Log.w(TAG, "Could not emit shared PDFs event: ${e.message}")
        }
    }

    /** True when the manifest still declares MANAGE_EXTERNAL_STORAGE (Android 11+). */
    @ReactMethod
    fun canRequestAllFilesAccess(promise: Promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            promise.resolve(false)
            return
        }
        try {
            val info = ctx.packageManager.getPackageInfo(ctx.packageName, PackageManager.GET_PERMISSIONS)
            promise.resolve(info.requestedPermissions?.contains(Manifest.permission.MANAGE_EXTERNAL_STORAGE) == true)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    private fun startPicker(intent: Intent, requestCode: Int, promise: Promise) {
        // React Native 0.80+ only offers the activity through the context
        // (the module's own getCurrentActivity() is deprecated, and as a Kotlin
        // function it no longer reads as a `currentActivity` property).
        val activity = ctx.currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "Pinpointer is not in the foreground")
            return
        }
        if (pendingPick != null) {
            promise.reject("PICKER_BUSY", "A picker is already open")
            return
        }
        pendingPick = promise
        try {
            activity.startActivityForResult(intent, requestCode)
        } catch (e: Exception) {
            pendingPick = null
            promise.reject("PICKER_UNAVAILABLE", "No file picker on this phone: ${e.message}", e)
        }
    }

    /** Opens the folder picker. Resolves { uri, name } or null if cancelled. */
    @ReactMethod
    fun pickPdfFolder(promise: Promise) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        )
        startPicker(intent, REQ_FOLDER, promise)
    }

    /** Opens the file picker for PDFs. Resolves with the local copies' paths ([] if cancelled). */
    @ReactMethod
    fun pickPdfFiles(promise: Promise) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/pdf"
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
        startPicker(intent, REQ_FILES, promise)
    }

    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQ_FOLDER && requestCode != REQ_FILES) return
        val promise = pendingPick ?: return
        pendingPick = null

        if (resultCode != Activity.RESULT_OK || data == null) {
            if (requestCode == REQ_FOLDER) promise.resolve(null) else promise.resolve(Arguments.createArray())
            return
        }

        if (requestCode == REQ_FOLDER) {
            val uri = data.data
            if (uri == null) { promise.resolve(null); return }
            try {
                ctx.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            } catch (e: Exception) {
                promise.reject("FOLDER_NOT_KEPT", "Could not keep access to this folder: ${e.message}", e)
                return
            }
            promise.resolve(Arguments.createMap().apply {
                putString("uri", uri.toString())
                putString("name", folderName(uri))
            })
            return
        }

        val uris = mutableListOf<Uri>()
        data.clipData?.let { clip -> for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let(uris::add) }
        if (uris.isEmpty()) data.data?.let(uris::add)
        io.execute {
            val paths = Arguments.createArray()
            uris.mapNotNull { copyIntoApp(ctx, it) }.forEach(paths::pushString)
            promise.resolve(paths)
        }
    }

    override fun onNewIntent(intent: Intent) {
        // MainActivity forwards share intents through handleShareIntent.
    }

    private fun folderName(treeUri: Uri): String = try {
        val docId = DocumentsContract.getTreeDocumentId(treeUri)
        docId.substringAfterLast(':').substringAfterLast('/').ifBlank { docId }
    } catch (e: Exception) {
        treeUri.lastPathSegment ?: "Folder"
    }

    /** Folders the user picked earlier and that Pinpointer still has access to. */
    @ReactMethod
    fun listPdfFolders(promise: Promise) {
        val out = Arguments.createArray()
        ctx.contentResolver.persistedUriPermissions
            .filter { it.isReadPermission && DocumentsContract.isTreeUri(it.uri) }
            .forEach {
                out.pushMap(Arguments.createMap().apply {
                    putString("uri", it.uri.toString())
                    putString("name", folderName(it.uri))
                })
            }
        promise.resolve(out)
    }

    /** Stops using a picked folder. Already-indexed PDFs stay searchable. */
    @ReactMethod
    fun forgetPdfFolder(uri: String, promise: Promise) {
        try {
            ctx.contentResolver.releasePersistableUriPermission(Uri.parse(uri), Intent.FLAG_GRANT_READ_URI_PERMISSION)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    /**
     * Copies every PDF in a picked folder (up to `maxDepth` levels, hidden
     * folders skipped) into app storage. Resolves with the number of PDFs.
     */
    @ReactMethod
    fun importPdfFolder(treeUriString: String, maxDepth: Int, promise: Promise) {
        io.execute {
            try {
                val treeUri = Uri.parse(treeUriString)
                val rootId = DocumentsContract.getTreeDocumentId(treeUri)
                var count = 0
                fun walk(docId: String, depth: Int) {
                    if (depth > maxDepth) return
                    val children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId)
                    val cols = arrayOf(
                        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                        DocumentsContract.Document.COLUMN_MIME_TYPE,
                    )
                    val found = mutableListOf<Triple<String, String, String>>()
                    ctx.contentResolver.query(children, cols, null, null, null)?.use { c ->
                        while (c.moveToNext()) {
                            found.add(Triple(c.getString(0), c.getString(1) ?: "", c.getString(2) ?: ""))
                        }
                    }
                    for ((id, name, mime) in found) {
                        if (name.startsWith(".")) continue
                        if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
                            walk(id, depth + 1)
                        } else if (mime == "application/pdf" || name.lowercase().endsWith(".pdf")) {
                            val docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, id)
                            if (copyIntoApp(ctx, docUri) != null) count++
                        }
                    }
                }
                walk(rootId, 1)
                promise.resolve(count)
            } catch (e: Exception) {
                // Usually: the folder was deleted or access was taken away.
                promise.reject("FOLDER_UNREADABLE", "Could not read folder: ${e.message}", e)
            }
        }
    }

    /** PDFs shared to Pinpointer since the last call (paths of the local copies). */
    @ReactMethod
    fun takeSharedPdfs(promise: Promise) {
        val out = Arguments.createArray()
        synchronized(pendingShared) {
            pendingShared.forEach(out::pushString)
            pendingShared.clear()
        }
        promise.resolve(out)
    }

    // Required by NativeEventEmitter on the JS side.
    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Double) {}
}
