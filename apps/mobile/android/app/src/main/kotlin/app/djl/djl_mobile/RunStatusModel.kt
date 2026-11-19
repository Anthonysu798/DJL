package app.djl.mobile

import java.net.URI
import java.net.URLDecoder
import java.util.UUID

// Pure local protocol v1. Never persist/log the raw channel map.
internal data class RunStatusIdentity(val instance: String, val epoch: Long) {
    companion object {
        fun decode(raw: Map<*, *>): RunStatusIdentity? {
            if (RunStatusDecode.integer(raw["schemaVersion"]) != 1L) return null
            val epoch = RunStatusDecode.integer(raw["epoch"]) ?: return null
            val instance = raw["instance"] as? String ?: return null
            if (instance.length != 36 || runCatching { UUID.fromString(instance).toString() }.getOrNull() != instance.lowercase()) return null
            return RunStatusIdentity(instance.lowercase(), epoch)
        }
    }
}

internal class RunStatusGate {
    private var active: RunStatusIdentity? = null
    private val retired = mutableSetOf<String>()
    private var revision = 0L
    fun end(identity: RunStatusIdentity): Long? {
        if (identity.instance in retired) return null
        active?.let {
            if (it.instance == identity.instance) {
                if (identity.epoch < it.epoch) return null
            } else retired.add(it.instance)
        }
        active = identity
        return ++revision
    }
    fun update(identity: RunStatusIdentity): Long? {
        val old = active ?: return null
        if (old.instance != identity.instance || identity.epoch < old.epoch) return null
        active = identity
        return ++revision
    }
    fun invalidate() { revision++ }
    fun current(token: Long) = token == revision
}

internal data class RunStatusRow(val state: String, val startedAt: Long, val staleAt: Long, val expiresAt: Long,
    val threadId: String? = null, val title: String? = null, val detail: String? = null, val url: String? = null)

internal data class RunStatusSnapshot(val identity: RunStatusIdentity, val detailed: Boolean,
    val running: List<RunStatusRow>, val failed: List<RunStatusRow>, val ready: List<RunStatusRow>) {
    val rows get() = (running + failed + ready).take(3)
    fun nextDeadline(now: Long) = (running + failed + ready).flatMap { listOf(it.staleAt, it.expiresAt) }.filter { it > now }.minOrNull()
    fun project(now: Long): RunStatusSnapshot {
        fun live(rows: List<RunStatusRow>) = rows.filter { it.expiresAt > now }.map {
            if (it.state in listOf("running", "finishing") && it.staleAt <= now) it.copy(state = "paused") else it
        }
        return copy(running = live(running), failed = live(failed), ready = live(ready))
    }
    companion object {
        fun actionURL(raw: String): String? {
            if (raw.toByteArray(Charsets.UTF_8).size > 2048) return null
            val uri = runCatching { URI(raw) }.getOrNull() ?: return null
            val path = uri.rawPath ?: return null
            if (!path.startsWith("/")) return null
            val thread = runCatching { URLDecoder.decode(path.drop(1).replace("+", "%2B"), "UTF-8") }.getOrNull() ?: return null
            return RunStatusDecode.qualifiedURL(raw, thread)
        }
        fun decode(raw: Map<*, *>, now: Long): RunStatusSnapshot? {
            if (!RunStatusDecode.keys(raw, setOf("schemaVersion", "epoch", "instance", "detailed", "counts", "buckets", "action"), setOf("nextDeadline"))) return null
            val identity = RunStatusIdentity.decode(raw) ?: return null
            val detailed = raw["detailed"] as? Boolean ?: return null
            if (raw["action"] != "openApp") return null
            val counts = raw["counts"] as? Map<*, *> ?: return null
            val buckets = raw["buckets"] as? Map<*, *> ?: return null
            val names = setOf("running", "failed", "ready")
            if (!RunStatusDecode.keys(counts, names) || !RunStatusDecode.keys(buckets, names)) return null
            val decoded = mutableMapOf<String, List<RunStatusRow>>()
            for (bucket in names) {
                val rows = buckets[bucket] as? List<*> ?: return null
                if (rows.size > 3 || RunStatusDecode.integer(counts[bucket]) != rows.size.toLong()) return null
                decoded[bucket] = rows.map { RunStatusDecode.row(it as? Map<*, *> ?: return null, bucket, detailed, now) ?: return null }
            }
            if (raw.containsKey("nextDeadline")) {
                val deadline = RunStatusDecode.integer(raw["nextDeadline"]) ?: return null
                if (deadline <= 0 || deadline > now + 14_400_000) return null
            }
            return RunStatusSnapshot(identity, detailed, decoded.getValue("running"), decoded.getValue("failed"), decoded.getValue("ready")).project(now)
        }
    }
}

private object RunStatusDecode {
    fun keys(raw: Map<*, *>, required: Set<String>, optional: Set<String> = emptySet()) = raw.keys.containsAll(required) && raw.keys.all { it in required || it in optional }
    fun integer(raw: Any?): Long? = when (raw) { is Int -> raw.toLong(); is Long -> raw; else -> null }?.takeIf { it in 0..9_007_199_254_740_991L }
    private fun text(raw: Any?, max: Int, id: Boolean = false, basename: Boolean = false): String? {
        val text = raw as? String ?: return null
        if (text.codePointCount(0, text.length) > max || text != text.trim() || text.codePoints().anyMatch { it < 32 || it == 127 || it in 0xD800..0xDFFF }) return null
        if ((id || basename) && text.any { it == '/' || it == '\\' }) return null
        if (id && (text.isEmpty() || text.any { it == '?' || it == '#' })) return null
        return text
    }
    private fun encoded(value: String, path: Boolean): String {
        val safe = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~" + if (path) "!$&'()*+,;=:@" else ""
        return value.toByteArray(Charsets.UTF_8).joinToString("") {
            val byte = it.toInt() and 255
            if (safe.any { char -> char.code == byte }) byte.toChar().toString()
            else if (!path && byte == 32) "+" else "%%%02X".format(byte)
        }
    }
    fun qualifiedURL(raw: Any?, thread: String): String? {
        val value = raw as? String ?: return null
        if (text(thread, 256, id = true) == null) return null
        if (value.toByteArray(Charsets.UTF_8).size > 2048) return null
        val uri = runCatching { URI(value) }.getOrNull() ?: return null
        if (uri.scheme != "djl" || uri.rawAuthority != "thread" || uri.rawFragment != null || uri.rawPath?.startsWith("/") != true) return null
        val path = runCatching { URLDecoder.decode(uri.rawPath.drop(1).replace("+", "%2B"), "UTF-8") }.getOrNull() ?: return null
        if (path != thread) return null
        val query = uri.rawQuery?.split('&') ?: return null
        if (query.size != 2 || !query[0].startsWith("macId=") || !query[1].startsWith("macKeySha256=")) return null
        val mac = runCatching { URLDecoder.decode(query[0].substring(6), "UTF-8") }.getOrNull() ?: return null
        val fingerprint = query[1].substring(13)
        if (text(mac, 256, id = true) == null || !fingerprint.matches(Regex("[0-9a-f]{64}"))) return null
        val canonical = "djl://thread/${encoded(thread, true)}?macId=${encoded(mac, false)}&macKeySha256=$fingerprint"
        return value.takeIf { it == canonical }
    }
    fun row(raw: Map<*, *>, bucket: String, detailed: Boolean, now: Long): RunStatusRow? {
        val privateKeys = setOf("threadId", "title", "detail", "url")
        if (!keys(raw, setOf("state", "startedAt", "staleAt", "expiresAt"), if (detailed) privateKeys else emptySet())) return null
        val state = raw["state"] as? String ?: return null
        if (if (bucket == "running") state !in listOf("running", "finishing", "paused") else state != bucket) return null
        val start = integer(raw["startedAt"]) ?: return null
        val stale = integer(raw["staleAt"]) ?: return null
        val expiry = integer(raw["expiresAt"]) ?: return null
        val maxAge = if (bucket == "running") 14_400_000 else if (bucket == "failed") 900_000 else 300_000
        if (start <= 0 || start > now || stale < start || expiry <= start || expiry > start + maxAge || stale > now + 14_400_000) return null
        if (raw.keys.any { it in privateKeys }) {
            val thread = text(raw["threadId"], 256, id = true) ?: return null
            val title = text(raw["title"], 120) ?: return null
            val detail = text(raw["detail"], 80, basename = true) ?: return null
            val url = qualifiedURL(raw["url"], thread) ?: return null
            return RunStatusRow(state, start, stale, expiry, thread, title, detail, url)
        }
        return RunStatusRow(state, start, stale, expiry)
    }
}
