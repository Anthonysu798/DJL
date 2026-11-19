package app.djl.mobile

import android.content.Intent
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class DJLRemoteMessagingService : FirebaseMessagingService() {
    override fun onCreate() {
        RemotePushBridge.initialize(applicationContext)
        super.onCreate()
    }
    override fun handleIntent(intent: Intent) {
        // The server sends data only. Never let FCM render remote-provided text.
        if (intent.action == "com.google.android.c2dm.intent.RECEIVE" &&
            (!RemotePushBridge.optedIn(this) || intent.hasExtra("gcm.n.e") || intent.hasExtra("gcm.notification.e"))) return
        super.handleIntent(intent)
    }
    override fun onMessageReceived(message: RemoteMessage) {
        if (message.notification == null) RemotePushBridge.deliver(this, message.data, message.messageId)
    }
}
