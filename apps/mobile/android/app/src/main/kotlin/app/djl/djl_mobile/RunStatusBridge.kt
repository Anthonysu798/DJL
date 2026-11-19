package app.djl.mobile

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel

internal class RunStatusBridge(private val activity: MainActivity, messenger: BinaryMessenger) {
    private val channel = MethodChannel(messenger, "app.djl/local_run_status")
    private val manager = activity.getSystemService(NotificationManager::class.java)
    private val gate = RunStatusGate()
    private var permissionResult: MethodChannel.Result? = null
    private var requested = false

    init {
        channel.setMethodCallHandler { call, result ->
            when (call.method) {
                "availability" -> result.success(permission())
                "requestPermission" -> requestPermission(result)
                "openSettings" -> result.success(openSettings())
                "end" -> {
                    val raw = call.arguments as? Map<*, *>
                    val identity = raw?.takeIf { it.keys == setOf("schemaVersion", "epoch", "instance") }?.let(RunStatusIdentity::decode)
                    if (identity == null) { reject(result) }
                    else if (gate.end(identity) == null) result.success(unavailable("superseded"))
                    else { clear(); result.success(capability()) }
                }
                "update" -> {
                    val snapshot = (call.arguments as? Map<*, *>)?.let { RunStatusSnapshot.decode(it, System.currentTimeMillis()) }
                    if (snapshot == null) reject(result)
                    else if (gate.update(snapshot.identity) == null) result.success(unavailable("superseded"))
                    else publish(snapshot, result)
                }
                else -> result.notImplemented()
            }
        }
    }
    private fun unavailable(reason: String) = mapOf("available" to false, "reason" to reason)
    private fun permission(): Map<String, Any> {
        // API24/25 have no OS-owned notification timeout. Do not leave an
        // indefinitely live surface if Dart/process execution stops.
        if (Build.VERSION.SDK_INT < 26) return mapOf("state" to "unsupported", "canRequest" to false, "canOpenSettings" to false)
        val runtimeDenied = Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        val channelDenied = manager.getNotificationChannel(CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE
        val allowed = !runtimeDenied && manager.areNotificationsEnabled() && !channelDenied
        return mapOf("state" to if (allowed) "allowed" else "denied", "canRequest" to (runtimeDenied && !requested && !channelDenied), "canOpenSettings" to true)
    }
    private fun capability(): Map<String, Any> = when (permission()["state"]) {
        "allowed" -> mapOf("available" to true)
        "unsupported" -> unavailable("deadlineUnsupported")
        else -> unavailable("denied")
    }
    private fun requestPermission(result: MethodChannel.Result) {
        if (permissionResult != null) { result.success(permission()); return }
        if (permission()["canRequest"] == true && Build.VERSION.SDK_INT >= 33) {
            requested = true
            permissionResult = result
            try {
                ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), PERMISSION_REQUEST)
            } catch (_: Exception) {
                permissionResult = null
                result.success(permission())
            }
        } else result.success(permission())
    }
    fun onPermissionResult(requestCode: Int) {
        if (requestCode != PERMISSION_REQUEST) return
        permissionResult?.success(permission())
        permissionResult = null
    }
    private fun openSettings(): Boolean {
        if (Build.VERSION.SDK_INT < 26) return false
        return try {
            activity.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName))
            true
        } catch (_: Exception) { false }
    }
    private fun baseIntent() = Intent(activity, MainActivity::class.java).setAction(Intent.ACTION_MAIN)
        .addCategory(Intent.CATEGORY_LAUNCHER).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    private fun pending(index: Int, url: String? = null): PendingIntent {
        val intent = baseIntent()
        if (url != null) intent.putExtra(URL_EXTRA, url)
        return PendingIntent.getActivity(activity, REQUEST_BASE + index, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    private fun clear() {
        manager.cancel(NOTIFICATION)
        // Identity excludes extras: these fixed explicit intents can be canceled
        // after process death too, without persisting any private URL or raw JSON.
        for (index in 0..3) PendingIntent.getActivity(activity, REQUEST_BASE + index, baseIntent(), PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)?.cancel()
    }
    private fun reject(result: MethodChannel.Result) {
        gate.invalidate(); clear(); result.success(unavailable("invalidPayload"))
    }
    private fun publish(snapshot: RunStatusSnapshot, result: MethodChannel.Result) {
        clear()
        if (capability()["available"] != true || Build.VERSION.SDK_INT < 26) { result.success(capability()); return }
        val now = System.currentTimeMillis()
        val live = snapshot.project(now)
        val deadline = live.nextDeadline(now)
        if (live.rows.isEmpty() || deadline == null) { result.success(mapOf("available" to true)); return }
        try {
            manager.createNotificationChannel(NotificationChannel(CHANNEL, "Task status", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Local status from your paired Mac"
                lockscreenVisibility = Notification.VISIBILITY_PRIVATE
                setShowBadge(false)
            })
            if (capability()["available"] != true) { result.success(capability()); return }
            val summary = "${live.running.size} active/paused · ${live.failed.size} failed · ${live.ready.size} ready"
            val genericIntent = pending(0)
            val publicVersion = Notification.Builder(activity, CHANNEL).setSmallIcon(R.drawable.djl_launch_logo)
                .setContentTitle("DJL").setContentText("Task status · Open DJL").setContentIntent(genericIntent)
                .setVisibility(Notification.VISIBILITY_PUBLIC).setTimeoutAfter((deadline - now).coerceAtLeast(1)).build()
            val builder = Notification.Builder(activity, CHANNEL).setSmallIcon(R.drawable.djl_launch_logo)
                .setContentTitle("DJL · Task status").setContentText(summary).setOnlyAlertOnce(true).setShowWhen(false)
                .setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(publicVersion)
                .setTimeoutAfter((deadline - now).coerceAtLeast(1)).setAutoCancel(true)
            val style = Notification.InboxStyle().setSummaryText(summary)
            live.rows.forEachIndexed { index, row ->
                val label = row.state.replaceFirstChar { it.uppercase() }
                style.addLine(if (row.title != null) "$label · ${row.title}${if (row.detail.isNullOrEmpty()) "" else " · ${row.detail}"}" else label)
                if (row.url != null) builder.addAction(Notification.Action.Builder(null, "Open ${row.title?.takeIf { it.isNotEmpty() } ?: label}", pending(index + 1, row.url)).build())
            }
            builder.setStyle(style).setContentIntent(live.rows.first().url?.let { pending(1, it) } ?: genericIntent)
            manager.notify(NOTIFICATION, builder.build())
            // Capability means the local API accepted this operation, not pixels.
            result.success(mapOf("available" to true))
        } catch (_: Exception) { clear(); result.success(unavailable("notificationUnavailable")) }
    }
    fun dispose() {
        permissionResult?.success(mapOf("state" to "unsupported"))
        permissionResult = null
        channel.setMethodCallHandler(null)
        // The bounded notification may remain until its OS timeout. No service.
    }
    companion object {
        private const val CHANNEL = "djl.local_task_status"
        private const val NOTIFICATION = 24601
        private const val REQUEST_BASE = 24610
        const val PERMISSION_REQUEST = 24602
        private const val URL_EXTRA = "app.djl.localStatusURL"
        fun routeIntent(intent: Intent): Intent {
            val raw = intent.getStringExtra(URL_EXTRA) ?: return intent
            intent.removeExtra(URL_EXTRA)
            // Immutable explicit notification intents use extras so cleanup can
            // cancel them by fixed identity after a restart. Flutter app_links
            // receives only a separately validated canonical qualified URL.
            val url = RunStatusSnapshot.actionURL(raw)
            if (url != null) { intent.action = Intent.ACTION_VIEW; intent.data = Uri.parse(url) }
            return intent
        }
    }
}
