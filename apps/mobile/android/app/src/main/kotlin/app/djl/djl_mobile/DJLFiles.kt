package app.djl.mobile

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import androidx.core.content.FileProvider
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel
import java.io.File

/** Shares attachment files from the cache folder with the app that opens them. */
class DJLFileProvider : FileProvider()

/** Opens an attachment in whichever installed app views its type. */
object DJLFiles {
    fun register(activity: Activity, messenger: BinaryMessenger) {
        MethodChannel(messenger, "djl.mobile/files").setMethodCallHandler { call, result ->
            if (call.method != "open") {
                result.notImplemented()
                return@setMethodCallHandler
            }
            val path = call.argument<String>("path")
            if (path == null) {
                result.error("invalid_file", "Opening a file requires its path.", null)
                return@setMethodCallHandler
            }
            try {
                val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.djl_files", File(path))
                val intent = Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, call.argument<String>("mimeType") ?: "*/*")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                activity.startActivity(intent)
                result.success(true)
            } catch (_: ActivityNotFoundException) {
                result.success(false)
            } catch (_: IllegalArgumentException) {
                result.success(false)
            }
        }
    }
}
