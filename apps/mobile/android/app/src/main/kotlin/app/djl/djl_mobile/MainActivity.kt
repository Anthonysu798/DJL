package app.djl.mobile

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.view.WindowManager
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.util.Locale

class MainActivity : FlutterFragmentActivity() {
    private var runStatusBridge: RunStatusBridge? = null
    private var remotePushBridge: RemotePushBridge? = null
    private lateinit var voiceChannel: MethodChannel
    private var recognizer: SpeechRecognizer? = null
    private var voiceSession: String? = null
    private var permissionResult: MethodChannel.Result? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        intent?.let { intent = RunStatusBridge.routeIntent(RemotePushBridge.captureTap(this, it)) }
        super.onCreate(savedInstanceState)
        // Android can snapshot before Flutter paints its inactive privacy shield.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            setRecentsScreenshotEnabled(false)
        } else {
            window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "djl.mobile/app-info").setMethodCallHandler { call, result ->
            if (call.method == "version") {
                result.success(packageManager.getPackageInfo(packageName, 0).versionName)
            } else if (call.method == "searchMatches") {
                val titles = call.argument<List<String>>("titles")
                val query = call.argument<String>("query")
                if (titles == null || query == null) {
                    result.error("invalid_search", "Search requires titles and a query.", null)
                } else {
                    result.success(DeviceTextSearch.matches(titles, query, resources.configuration.locales[0]))
                }
            } else if (call.method == "relativeDate") {
                val date = call.argument<Number>("date")?.toDouble()
                val reference = call.argument<Number>("relativeTo")?.toDouble()
                if (date == null || reference == null || !date.isFinite() || !reference.isFinite() ||
                    kotlin.math.abs(date) > 8_640_000_000_000_000.0 ||
                    kotlin.math.abs(reference) > 8_640_000_000_000_000.0) {
                    result.error("invalid_date", "Relative dates require UTC milliseconds.", null)
                } else {
                    result.success(DeviceRecencyFormatter.format(date.toLong(), reference.toLong(),
                        elapsed = call.argument<Boolean>("elapsed") == true))
                }
            } else result.notImplemented()
        }
        DJLFiles.register(this, flutterEngine.dartExecutor.binaryMessenger)
        runStatusBridge = RunStatusBridge(this, flutterEngine.dartExecutor.binaryMessenger)
        remotePushBridge = RemotePushBridge(this, flutterEngine.dartExecutor.binaryMessenger)
        voiceChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "djl.mobile/voice")
        voiceChannel.setMethodCallHandler { call, result ->
            when (call.method) {
                "initialize" -> {
                    if (!onDeviceAvailable()) result.success(false)
                    else if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) result.success(true)
                    else if (permissionResult != null) result.error("busy", "Microphone permission is pending.", null)
                    else {
                        permissionResult = result
                        ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.RECORD_AUDIO), 1204)
                    }
                }
                "listen" -> {
                    val session = call.argument<String>("sessionId")
                    if (session == null || !onDeviceAvailable()) result.error("unavailable", "On-device speech is unavailable.", null)
                    else if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) result.error("permission", "Microphone access is required.", null)
                    else {
                        stopRecognizer()
                        voiceSession = session
                        // No createSpeechRecognizer fallback: audio stays in the on-device engine.
                        recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(this)
                        recognizer?.setRecognitionListener(object : RecognitionListener {
                            override fun onReadyForSpeech(params: Bundle?) {}
                            override fun onBeginningOfSpeech() {}
                            override fun onRmsChanged(rmsdB: Float) {}
                            override fun onBufferReceived(buffer: ByteArray?) {}
                            override fun onEndOfSpeech() {}
                            override fun onEvent(eventType: Int, params: Bundle?) {}
                            override fun onError(error: Int) {
                                emitVoice(session, "error", error.toString())
                                stopRecognizer()
                            }
                            override fun onPartialResults(partialResults: Bundle?) {
                                emitVoice(session, "text", partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: "")
                            }
                            override fun onResults(results: Bundle?) {
                                emitVoice(session, "text", results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: "")
                                emitVoice(session, "done", "")
                                stopRecognizer()
                            }
                        })
                        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
                            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                            .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                        try {
                            recognizer?.startListening(intent)
                            result.success(null)
                        } catch (_: Exception) {
                            stopRecognizer()
                            result.error("unavailable", "Could not start on-device speech.", null)
                        }
                    }
                }
                "stop" -> {
                    if (voiceSession == call.argument<String>("sessionId")) recognizer?.stopListening()
                    result.success(null)
                }
                "cancel" -> {
                    if (voiceSession == call.argument<String>("sessionId")) stopRecognizer()
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(RunStatusBridge.routeIntent(RemotePushBridge.captureTap(this, intent)))
        remotePushBridge?.emitPendingTap()
    }

    private fun onDeviceAvailable(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && SpeechRecognizer.isOnDeviceRecognitionAvailable(this)
    private fun emitVoice(session: String, type: String, text: String) {
        if (voiceSession == session) voiceChannel.invokeMethod("event", mapOf("sessionId" to session, "type" to type, "text" to text))
    }
    private fun stopRecognizer() {
        voiceSession = null
        recognizer?.cancel()
        recognizer?.destroy()
        recognizer = null
    }
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        runStatusBridge?.onPermissionResult(requestCode)
        remotePushBridge?.onPermissionResult(requestCode)
        if (requestCode == 1204) {
            permissionResult?.success(grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED)
            permissionResult = null
        }
    }
    override fun onStop() {
        stopRecognizer()
        super.onStop()
    }
    override fun onDestroy() {
        remotePushBridge?.dispose()
        remotePushBridge = null
        runStatusBridge?.dispose()
        runStatusBridge = null
        permissionResult?.success(false)
        permissionResult = null
        stopRecognizer()
        super.onDestroy()
    }
}
