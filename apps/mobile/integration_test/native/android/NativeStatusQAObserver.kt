// TEST ONLY: copied into a disposable project by the guarded preparer.
// Reads public own-app OS APIs. PendingIntent underlying extras are NOT exposed.
package app.djl.mobile

import android.Manifest
import android.content.pm.PackageManager
import android.app.Activity
import android.app.Notification
import android.app.NotificationManager
import android.os.Build
import android.os.Process
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel

internal object NativeStatusQAObserver {
    fun install(activity: Activity, messenger: BinaryMessenger) {
        MethodChannel(messenger, "app.djl/test_only_run_status_observer").setMethodCallHandler { call, result ->
            if (call.method != "snapshot") { result.notImplemented(); return@setMethodCallHandler }
            if (Build.VERSION.SDK_INT < 26) { result.success(mapOf("supported" to false)); return@setMethodCallHandler }
            val manager = activity.getSystemService(NotificationManager::class.java)
            val notifications = manager.activeNotifications.filter { it.id == 24601 && it.packageName == activity.packageName && it.notification.channelId == "djl.local_task_status" }
            val runtimeAllowed = Build.VERSION.SDK_INT < 33 || activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            val permissionAllowed = runtimeAllowed && manager.areNotificationsEnabled() && manager.getNotificationChannel("djl.local_task_status")?.importance != NotificationManager.IMPORTANCE_NONE
            val output = mutableMapOf<String, Any>("supported" to true, "platform" to "android", "pid" to Process.myPid(), "count" to notifications.size, "permissionAllowed" to permissionAllowed)
            if (notifications.size == 1) {
                val notification = notifications.single().notification
                fun text(value: Notification): List<String> = listOfNotNull(value.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString(), value.extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()) + (value.extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.map { it.toString() } ?: emptyList())
                val visible = text(notification)
                val lines = notification.extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.map { it.toString() } ?: emptyList()
                fun safe(strings: List<String>) = strings.none { it.contains("DJL QA PUBLIC TITLE") || it.contains("qa-public-folder") || it.contains("qa-status-public-") || it.contains("djl://") }
                val publicVersion = notification.publicVersion
                val intent = notification.contentIntent
                val actions = notification.actions?.map { it.actionIntent } ?: emptyList()
                output.putAll(mapOf(
                    "readableGenericFieldsSafe" to safe(visible),
                    "publicGeneric" to (publicVersion != null && safe(text(publicVersion)) && publicVersion.visibility == Notification.VISIBILITY_PUBLIC),
                    "privateVisibility" to (notification.visibility == Notification.VISIBILITY_PRIVATE),
                    "channelLow" to (manager.getNotificationChannel("djl.local_task_status")?.importance == NotificationManager.IMPORTANCE_LOW),
                    "contentIntentOwned" to (intent != null && intent.creatorPackage == activity.packageName && actions.all { it != null && it.creatorPackage == activity.packageName }),
                    "contentIntentImmutable" to (Build.VERSION.SDK_INT >= 31 && intent != null && intent.isImmutable && actions.all { it != null && it.isImmutable }),
                    "genericInitialOrder" to (lines == listOf("Running", "Failed", "Ready") && visible.contains("1 active/paused · 1 failed · 1 ready")),
                    "genericUpdatedOrder" to (lines == listOf("Finishing", "Paused", "Ready") && visible.contains("2 active/paused · 0 failed · 1 ready")),
                    "detailedCanaryMatches" to lines.any { it.contains("DJL QA PUBLIC TITLE") && it.contains("qa-public-folder") },
                    // Public postTime plus timeoutAfter establishes the absolute
                    // scheduled deadline; underlying intent extras stay opaque.
                    "deadlineMatches" to NativeStatusDeadline.matches((call.arguments as? Map<*, *>)?.get("deadline"), notifications.single().postTime, notification.timeoutAfter),
                    "lineCount" to lines.size
                ))
            }
            result.success(output)
        }
    }
}
