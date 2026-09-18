package ai.runanywhere.starter

import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import com.facebook.react.bridge.*
import java.io.File
import java.io.FileOutputStream

/**
 * NativePdfModule — Android native bridge for PDF intelligence.
 *
 * Capabilities:
 *  1. getPageCount(filePath) → number of pages
 *  2. rasterizePages(filePath, maxPages) → array of JPEG image paths
 *  3. extractBasicInfo(filePath) → { pageCount, fileSize, fileName }
 */
class NativePdfModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "NativePdfModule"

    /**
     * Get basic PDF info: page count, file size, file name.
     */
    @ReactMethod
    fun getPdfInfo(filePath: String, promise: Promise) {
        try {
            val cleanPath = filePath.replace("file://", "")
            val file = File(cleanPath)
            if (!file.exists()) {
                promise.reject("FILE_NOT_FOUND", "PDF file not found: $cleanPath")
                return
            }

            // H6 fix: use try/finally to prevent FD leak on error
            var fd: ParcelFileDescriptor? = null
            var renderer: PdfRenderer? = null
            try {
                fd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
                renderer = PdfRenderer(fd)
                val pageCount = renderer.pageCount

                val result = Arguments.createMap().apply {
                    putInt("pageCount", pageCount)
                    putDouble("fileSize", file.length().toDouble())
                    putString("fileName", file.name)
                }
                promise.resolve(result)
            } finally {
                try { renderer?.close() } catch (_: Exception) {}
                try { fd?.close() } catch (_: Exception) {}
            }
        } catch (e: Exception) {
            promise.reject("PDF_INFO_ERROR", "Failed to read PDF info: ${e.message}", e)
        }
    }

    /**
     * Rasterize up to `maxPages` of a PDF into JPEG images.
     * Returns an array of absolute file paths to the generated JPEGs.
     *
     * Uses Android's built-in PdfRenderer (no external dependency).
     * Resolution: 2x scale for crisp OCR results on ML Kit.
     */
    @ReactMethod
    fun rasterizePages(filePath: String, maxPages: Int, promise: Promise) {
        try {
            val cleanPath = filePath.replace("file://", "")
            val file = File(cleanPath)
            if (!file.exists()) {
                promise.reject("FILE_NOT_FOUND", "PDF not found: $cleanPath")
                return
            }

            var fd: ParcelFileDescriptor? = null
            var renderer: PdfRenderer? = null
            try {
                fd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
                renderer = PdfRenderer(fd)
                val totalPages = renderer.pageCount
                val pagesToRender = minOf(maxPages, totalPages)

                // Output directory: app cache for auto-cleanup
                val outDir = File(reactApplicationContext.cacheDir, "pdf_pages")
                if (!outDir.exists()) outDir.mkdirs()

                val resultPaths = Arguments.createArray()

                for (i in 0 until pagesToRender) {
                    val page = renderer.openPage(i)
                    var bitmap: Bitmap? = null
                    try {
                        // H6 fix: cap scale by total pixels to prevent OOM on oversized pages
                        val totalPixels = page.width.toLong() * page.height.toLong()
                        val scale = if (totalPixels > 4_000_000) 1 else 2

                        bitmap = Bitmap.createBitmap(
                            page.width * scale,
                            page.height * scale,
                            Bitmap.Config.ARGB_8888
                        )

                        val canvas = android.graphics.Canvas(bitmap)
                        canvas.drawColor(android.graphics.Color.WHITE)
                        page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)

                        val safeFileName = file.nameWithoutExtension.replace(Regex("[^a-zA-Z0-9_-]"), "_")
                        val outFile = File(outDir, "${safeFileName}_page_${i + 1}.jpg")
                        FileOutputStream(outFile).use { fos ->
                            bitmap.compress(Bitmap.CompressFormat.JPEG, 80, fos)
                        }

                        resultPaths.pushString(outFile.absolutePath)
                    } finally {
                        bitmap?.recycle()
                        page.close()
                    }
                }

                promise.resolve(resultPaths)
            } finally {
                try { renderer?.close() } catch (_: Exception) {}
                try { fd?.close() } catch (_: Exception) {}
            }
        } catch (e: SecurityException) {
            promise.reject("PDF_ENCRYPTED", "PDF is password-protected: ${e.message}", e)
        } catch (e: Exception) {
            promise.reject("RASTERIZE_ERROR", "Failed to rasterize PDF: ${e.message}", e)
        }
    }

    /**
     * Clean up cached rasterized page images to free disk space.
     */
    @ReactMethod
    fun cleanupCache(promise: Promise) {
        try {
            val outDir = File(reactApplicationContext.cacheDir, "pdf_pages")
            if (outDir.exists()) {
                outDir.listFiles()?.forEach { it.delete() }
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }
}
