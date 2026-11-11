package com.pinpointer.app;

import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import android.os.Build;
import android.os.Environment;
import android.content.pm.PackageManager;
import android.os.StrictMode;
import android.content.res.AssetFileDescriptor;
import androidx.core.content.FileProvider;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import android.content.res.AssetManager;
import android.util.Log;

public class StorageModule extends ReactContextBaseJavaModule {
    private static final String TAG = "StorageModule";

    StorageModule(ReactApplicationContext context) {
        super(context);
    }

    @Override
    public String getName() {
        return "StorageModule";
    }

    @ReactMethod
    public void unpackAsset(final String assetFilename, final String destinationPath, final Promise promise) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                String assetPath = "models/" + assetFilename;
                Log.d(TAG, "Unpacking asset: " + assetPath + " -> " + destinationPath);

                try {
                    AssetManager assetManager = getReactApplicationContext().getAssets();
                    InputStream rawIn = null;
                    long expectedSize = -1;

                    // Strategy 1: Use openFd() for uncompressed assets (more reliable in release APKs)
                    try {
                        AssetFileDescriptor afd = assetManager.openFd(assetPath);
                        expectedSize = afd.getLength();
                        rawIn = afd.createInputStream();
                        Log.d(TAG, "Opened via openFd(), size=" + expectedSize + " bytes");
                    } catch (Exception fdErr) {
                        Log.w(TAG, "openFd() failed (" + fdErr.getMessage() + "), falling back to open()");
                        // Strategy 2: Fallback to open() with ACCESS_STREAMING for compressed assets
                        rawIn = assetManager.open(assetPath, AssetManager.ACCESS_STREAMING);
                        Log.d(TAG, "Opened via open(ACCESS_STREAMING)");
                    }

                    // Use 64KB buffer for faster I/O on large model files
                    BufferedInputStream in = new BufferedInputStream(rawIn, 65536);
                    BufferedOutputStream out = new BufferedOutputStream(new FileOutputStream(destinationPath), 65536);

                    byte[] buffer = new byte[65536];
                    int read;
                    long totalWritten = 0;

                    while ((read = in.read(buffer)) != -1) {
                        out.write(buffer, 0, read);
                        totalWritten += read;
                    }

                    out.flush();
                    out.close();
                    in.close();

                    // Validate the copy
                    java.io.File destFile = new java.io.File(destinationPath);
                    long actualSize = destFile.length();
                    Log.d(TAG, "Copy complete: wrote " + totalWritten + " bytes, file size=" + actualSize);

                    if (actualSize == 0) {
                        destFile.delete();
                        promise.reject("UNPACK_ASSET_ERROR", "Copied file is empty (0 bytes)");
                        return;
                    }

                    if (expectedSize > 0 && actualSize != expectedSize) {
                        Log.w(TAG, "Size mismatch: expected=" + expectedSize + " actual=" + actualSize);
                        // Don't fail — compressed assets may report different sizes via openFd
                    }

                    promise.resolve(destinationPath);
                } catch (Exception e) {
                    Log.e(TAG, "unpackAsset failed: " + e.getMessage(), e);
                    // Clean up partial file
                    try { new java.io.File(destinationPath).delete(); } catch (Exception ignored) {}
                    promise.reject("UNPACK_ASSET_ERROR", "Failed to unpack " + assetFilename + ": " + e.getMessage(), e);
                }
            }
        }).start();
    }

    /**
     * True when the user has turned on "All files access" for this app
     * (Android 11+). Below Android 11 that setting doesn't exist, so this
     * reports whether READ_EXTERNAL_STORAGE is granted instead.
     */
    @ReactMethod
    public void hasAllFilesAccess(Promise promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                promise.resolve(Environment.isExternalStorageManager());
            } else {
                promise.resolve(getReactApplicationContext().checkSelfPermission(
                        android.Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED);
            }
        } catch (Exception e) {
            promise.resolve(false);
        }
    }

    /**
     * Opens the "All files access" switch for this app, or the list of apps
     * when the phone has no page for a single app. Resolves true when a
     * screen opened and false when this phone has neither (some Android
     * builds leave them out), so JS can offer "Choose one folder" instead.
     * Never throws: an unhandled ActivityNotFoundException here used to
     * close the whole app.
     */
    @ReactMethod
    public void openAllFilesAccessSettings(Promise promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            promise.resolve(false);
            return;
        }
        Intent appPage = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
        appPage.addCategory(Intent.CATEGORY_DEFAULT);
        appPage.setData(Uri.parse("package:" + getReactApplicationContext().getPackageName()));
        Intent appList = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
        for (Intent intent : new Intent[] { appPage, appList }) {
            try {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getReactApplicationContext().startActivity(intent);
                promise.resolve(true);
                return;
            } catch (Exception e) {
                Log.w(TAG, "No screen for " + intent.getAction() + ": " + e.getMessage());
            }
        }
        promise.resolve(false);
    }

    @ReactMethod
    public void openPDF(String absolutePath) {
        try {
            Uri contentUri;
            if (absolutePath.startsWith("content://")) {
                contentUri = Uri.parse(absolutePath);
            } else {
                if (absolutePath.startsWith("file://")) {
                    absolutePath = absolutePath.substring(7);
                }
                java.io.File file = new java.io.File(absolutePath);
                contentUri = FileProvider.getUriForFile(getReactApplicationContext(), getReactApplicationContext().getPackageName() + ".fileprovider", file);
            }
            
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(contentUri, "application/pdf");
            
            // Modern Android requires ClipData for propagating URI permissions properly
            intent.setClipData(android.content.ClipData.newRawUri("", contentUri));
            intent.setFlags(Intent.FLAG_ACTIVITY_NO_HISTORY | Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            
            getReactApplicationContext().startActivity(intent);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @ReactMethod
    public void shareImage(String absolutePath) {
        try {
            Uri contentUri;
            if (absolutePath.startsWith("content://")) {
                contentUri = Uri.parse(absolutePath);
            } else {
                if (absolutePath.startsWith("file://")) {
                    absolutePath = absolutePath.substring(7);
                }
                java.io.File file = new java.io.File(absolutePath);
                contentUri = FileProvider.getUriForFile(getReactApplicationContext(), getReactApplicationContext().getPackageName() + ".fileprovider", file);
            }
            
            Intent shareIntent = new Intent(Intent.ACTION_SEND);
            shareIntent.setType("image/*");
            shareIntent.putExtra(Intent.EXTRA_STREAM, contentUri);
            
            // Modern Android requires ClipData for propagating URI permissions properly
            shareIntent.setClipData(android.content.ClipData.newRawUri("", contentUri));
            shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            
            Intent chooser = Intent.createChooser(shareIntent, "Share Image");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            
            getReactApplicationContext().startActivity(chooser);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
