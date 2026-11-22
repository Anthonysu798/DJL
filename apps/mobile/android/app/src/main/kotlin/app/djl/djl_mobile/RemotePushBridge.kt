package app.djl.mobile

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailabilityLight
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.installations.FirebaseInstallations
import com.google.firebase.messaging.FirebaseMessaging
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

internal class RemotePushBridge(private val activity: MainActivity, messenger: BinaryMessenger) {
    private val channel = MethodChannel(messenger, "djl.mobile/remote-push")
    private var permissionResult: MethodChannel.Result? = null
    private var failed = false
    private var disposed = false

    init {
        channel.setMethodCallHandler { call, result ->
            when (call.method) {
                "status" -> result.success(state())
                "enable" -> {
                    if (availability(activity) != "ready") result.success(state())
                    else if (permissionResult != null) result.error("busy", "Notification permission is pending.", null)
                    else if (Build.VERSION.SDK_INT >= 33 && permission() == "notDetermined") {
                        preferences(activity).edit().putBoolean("enabled", true).putBoolean("requested", true).commit()
                        permissionResult = result
                        ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), PERMISSION)
                    } else enable(result)
                }
                "register" -> register(result)
                "clearToken" -> { clear(activity, call.argument<Boolean>("disable") == true); failed = false; result.success(null) }
                "initialTap" -> result.success(pendingTap(activity))
                "ack" -> {
                    synchronized(lock) {
                        if (pendingTap(activity)?.get("eventId") == call.arguments)
                            preferences(activity).edit().remove("pendingTap").commit()
                    }
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
    }

    private fun permission(): String {
        val manager = activity.getSystemService(NotificationManager::class.java)
        val denied = Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        if (denied) return if (preferences(activity).getBoolean("requested", false)) "denied" else "notDetermined"
        if (!manager.areNotificationsEnabled() || Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE) return "denied"
        return "authorized"
    }

    private fun state(): Map<String, Any> = buildMap {
        put("provider", "fcm"); put("environment", "production"); put("permission", permission())
        put("availability", if (failed && availability(activity) == "ready") "failed" else availability(activity))
        if (optedIn(activity)) preferences(activity).getString("installationId", null)?.let { put("token", it) }
    }

    private fun enable(result: MethodChannel.Result) {
        if (availability(activity) == "ready")
            preferences(activity).edit().putBoolean("enabled", true).commit()
        register(result)
    }
    private fun register(result: MethodChannel.Result) {
        if (!consented(activity) || availability(activity) != "ready" || permission() != "authorized") { result.success(state()); return }
        val context = activity.applicationContext
        val epoch = synchronized(lock) {
            gate.enable()
        }
        failed = false
        val completed = AtomicBoolean(false)
        fun finish(error: Boolean) {
            main.post {
                if (gate.accepts(epoch)) failed = error
                if (completed.compareAndSet(false, true)) {
                    result.success(state())
                }
                if (!disposed && gate.accepts(epoch)) channel.invokeMethod("state", state())
            }
        }
        // Bound the channel response while keeping Firebase operations serialized.
        // A timed-out SDK Task can still complete; it must finish before unregister.
        val timeout = Runnable { finish(true) }
        main.postDelayed(timeout, 30_000)
        operations.execute {
            try {
                if (!gate.accepts(epoch)) { finish(false); return@execute }
                val messaging = initialize(context) ?: throw IllegalStateException()
                if (preferences(context).getBoolean("unregisterPending", false)) {
                    Tasks.await(messaging.unregister())
                    synchronized(lock) {
                        if (gate.accepts(epoch)) preferences(context).edit().putBoolean("unregisterPending", false).commit()
                    }
                }
                if (!gate.accepts(epoch)) { finish(false); return@execute }
                Tasks.await(messaging.register())
                val id = Tasks.await(FirebaseInstallations.getInstance().id)
                synchronized(lock) {
                    if (gate.accepts(epoch) && consented(context)) preferences(context).edit().putString("installationId", id).commit()
                }
                finish(false)
            } catch (_: Exception) { finish(true) }
            finally { main.removeCallbacks(timeout) }
        }
    }

    fun onPermissionResult(requestCode: Int) {
        if (requestCode != PERMISSION) return
        // A late permission result must not restore consent revoked while it was pending.
        permissionResult?.let { permissionResult = null; register(it) }
    }
    fun emitPendingTap() { pendingTap(activity)?.let { if (!disposed) channel.invokeMethod("tap", it) } }
    fun dispose() {
        disposed = true
        permissionResult?.success(state()); permissionResult = null
        channel.setMethodCallHandler(null)
    }

    companion object {
        private const val PERMISSION = 1206
        private const val CHANNEL = "djl.remote.tasks"
        private const val TAP_ACTION = "app.djl.mobile.REMOTE_PUSH_TAP"
        private val lock = Any()
        private val gate = RemotePushRegistrationGate()
        private val main = Handler(Looper.getMainLooper())
        private val operations = Executors.newSingleThreadExecutor { task -> Thread(task, "djl-remote-push").apply { isDaemon = true } }
        private fun preferences(context: Context) = context.getSharedPreferences("djl.remote-push", Context.MODE_PRIVATE)
        private fun consented(context: Context) = preferences(context).getBoolean("enabled", false)
        fun optedIn(context: Context) = consented(context) && !preferences(context).getString("installationId", null).isNullOrBlank()
        private fun options(context: Context) = FirebaseOptions.fromResource(context)?.takeIf {
            it.applicationId.isNotBlank() && !it.apiKey.isNullOrBlank() && !it.projectId.isNullOrBlank() && !it.gcmSenderId.isNullOrBlank()
        }
        private fun availability(context: Context) = when {
            options(context) == null -> "unconfigured"
            GoogleApiAvailabilityLight.getInstance().isGooglePlayServicesAvailable(context) != ConnectionResult.SUCCESS -> "unsupported"
            else -> "ready"
        }
        fun initialize(context: Context): FirebaseMessaging? {
            if (!consented(context)) return null
            val config = options(context) ?: return null
            if (FirebaseApp.getApps(context).isEmpty()) FirebaseApp.initializeApp(context, config)
            return FirebaseMessaging.getInstance().apply {
                isAutoInitEnabled = false
                setNotificationDelegationEnabled(false)
                setDeliveryMetricsExportToBigQuery(false)
            }
        }
        private fun clear(context: Context, disable: Boolean) {
            synchronized(lock) {
                gate.clear()
                val edit = preferences(context).edit().putBoolean("unregisterPending", true)
                    .remove("installationId").remove("routes").remove("pendingTap").remove("seenDeliveries")
                if (disable) edit.putBoolean("enabled", false)
                edit.commit()
            }
            val manager = context.getSystemService(NotificationManager::class.java)
            manager.activeNotifications.filter { it.tag == CHANNEL }.forEach { manager.cancel(CHANNEL, it.id) }
            operations.execute {
                try {
                    if (FirebaseApp.getApps(context).isNotEmpty()) Tasks.await(FirebaseMessaging.getInstance().unregister())
                    // Keep the pending flag until the next serialized registration verifies unregister.
                } catch (_: Exception) { }
            }
        }
        private fun jsonMap(value: JSONObject): Map<String, Any> = value.keys().asSequence().associateWith { value.get(it) }
        private fun pendingTap(context: Context): Map<String, Any>? = synchronized(lock) {
            val value = preferences(context).getString("pendingTap", null)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return@synchronized null
            if (!RemotePushEnvelope.fresh(value.optLong("receivedAt", -1), System.currentTimeMillis())) {
                preferences(context).edit().remove("pendingTap").commit(); return@synchronized null
            }
            jsonMap(value)
        }
        fun captureTap(context: Context, intent: Intent): Intent {
            if (intent.action != TAP_ACTION) return intent
            synchronized(lock) {
                val prefs = preferences(context)
                val routes = runCatching { JSONObject(prefs.getString("routes", "{}")!!) }.getOrDefault(JSONObject())
                val nonce = intent.getStringExtra("djl.push.nonce")
                val stored = nonce?.let { routes.optJSONObject(it) }
                if (nonce != null) routes.remove(nonce)
                val edit = prefs.edit().putString("routes", routes.toString())
                if (optedIn(context) && stored != null && RemotePushEnvelope.fresh(stored.optLong("at", -1), System.currentTimeMillis())) {
                    val route = stored.optJSONObject("route")?.let { jsonMap(it).mapValues { entry -> entry.value.toString() } }?.let(RemotePushEnvelope::decode)
                    if (route != null) edit.putString("pendingTap", JSONObject(route).put("eventId", nonce).put("receivedAt", System.currentTimeMillis()).toString())
                }
                edit.commit()
            }
            // Routing data is resolved from private storage, never caller-supplied extras.
            return Intent(intent).setAction(Intent.ACTION_MAIN).setData(null).apply { removeExtra("djl.push.nonce") }
        }
        fun deliver(context: Context, data: Map<String, String>, messageId: String?) {
            if (!optedIn(context)) return
            val route = RemotePushEnvelope.decode(data) ?: return
            val manager = context.getSystemService(NotificationManager::class.java)
            if (!manager.areNotificationsEnabled() || Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
            if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(CHANNEL, context.getString(R.string.djl_channel_task_notifications), NotificationManager.IMPORTANCE_DEFAULT))
            val nonce = UUID.randomUUID().toString()
            val dedupe = MessageDigest.getInstance("SHA-256").digest((messageId ?: nonce).toByteArray()).joinToString("") { "%02x".format(it) }
            synchronized(lock) {
                if (!optedIn(context)) return
                val prefs = preferences(context)
                val routes = runCatching { JSONObject(prefs.getString("routes", "{}")!!) }.getOrDefault(JSONObject())
                val now = System.currentTimeMillis()
                val storedSeen = runCatching { JSONObject(prefs.getString("seenDeliveries", "{}")!!) }.getOrDefault(JSONObject())
                val seen = storedSeen.keys().asSequence().associateWith { storedSeen.optLong(it, -1) }
                val updatedSeen = RemotePushDeliveryWindow.remember(seen, dedupe, now) ?: return
                routes.keys().asSequence().toList().filter { !RemotePushEnvelope.fresh(routes.optJSONObject(it)?.optLong("at", -1) ?: -1, now) }.forEach { routes.remove(it) }
                while (routes.length() >= 32) routes.remove(routes.keys().next())
                routes.put(nonce, JSONObject().put("at", now).put("route", JSONObject(route)))
                prefs.edit().putString("routes", routes.toString()).putString("seenDeliveries", JSONObject(updatedSeen).toString()).commit()
                val tap = Intent(context, MainActivity::class.java).setAction(TAP_ACTION).putExtra("djl.push.nonce", nonce)
                val pending = PendingIntent.getActivity(context, nonce.hashCode(), tap, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
                val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, CHANNEL) else Notification.Builder(context)
                // An approval or question waits on the person; anything else finished.
                val attention = route["source"] == "codex.structuredUserInput"
                builder.setSmallIcon(R.drawable.djl_launch_logo)
                    .setContentTitle(context.getString(if (attention) R.string.djl_push_attention_title else R.string.djl_push_finished_title))
                    .setContentText(context.getString(if (attention) R.string.djl_push_attention_text else R.string.djl_push_finished_text)).setContentIntent(pending).setAutoCancel(true)
                    .setVisibility(Notification.VISIBILITY_PRIVATE)
                if (Build.VERSION.SDK_INT >= 26) builder.setTimeoutAfter(300_000)
                manager.notify(CHANNEL, nonce.hashCode(), builder.build())
            }
        }
    }
}
