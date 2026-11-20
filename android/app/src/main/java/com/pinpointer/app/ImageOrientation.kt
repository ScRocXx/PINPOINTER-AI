package com.pinpointer.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.provider.MediaStore

/**
 * Which way up a photo is. Cameras often store a portrait photo sideways with
 * an orientation tag; ML Kit and CLIP must see it upright.
 *
 * Gallery photos (content:// from MediaStore) carry the orientation as a
 * column; files carry it in their EXIF data.
 */
object ImageOrientation {
    /** Degrees (0, 90, 180, 270) to turn the stored image clockwise to stand it upright. */
    fun rotationDegrees(context: Context, uri: String): Int = try {
        if (uri.startsWith("content://")) {
            context.contentResolver.query(
                Uri.parse(uri), arrayOf(MediaStore.Images.ImageColumns.ORIENTATION), null, null, null,
            )?.use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getInt(0) else 0 } ?: 0
        } else {
            when (ExifInterface(uri.removePrefix("file://"))
                .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90
                ExifInterface.ORIENTATION_ROTATE_180 -> 180
                ExifInterface.ORIENTATION_ROTATE_270 -> 270
                else -> 0
            }
        }
    } catch (e: Exception) {
        0
    }

    /** The bitmap turned upright (the input is recycled when a new one is made). */
    fun rotate(bitmap: Bitmap, degrees: Int): Bitmap {
        if (degrees % 360 == 0) return bitmap
        val matrix = Matrix().apply { postRotate(degrees.toFloat()) }
        val turned = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        if (turned !== bitmap) bitmap.recycle()
        return turned
    }
}
