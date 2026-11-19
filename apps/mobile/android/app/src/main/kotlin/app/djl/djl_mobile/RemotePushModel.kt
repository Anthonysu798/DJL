package app.djl.mobile

import java.net.URLEncoder

internal object RemotePushEnvelope {
    fun validId(value: String?) = value != null && value.isNotEmpty() && value.length <= 512 &&
        value.none { it <= ' ' || it == '\u007f' || it in "/\\?#" || it.isWhitespace() }

    fun fresh(receivedAt: Long, now: Long) = receivedAt >= 0 && now >= receivedAt && now - receivedAt <= 300_000

    fun decode(raw: Map<String, String>): Map<String, String>? {
        val source = raw["source"] ?: return null
        if (source == "djl.cloudRun") {
            val conversation = raw["conversationId"]
            val run = raw["runId"]
            val status = raw["status"]
            if (!validId(conversation) || !validId(run) || status !in setOf("succeeded", "failed")) return null
            val encoded = URLEncoder.encode(conversation, "UTF-8").replace("+", "%20").replace("%21", "!").replace("%27", "'").replace("%28", "(").replace("%29", ")").replace("%7E", "~")
            if (raw["url"] != "djl://cloud/c/$encoded") return null
            return mapOf("source" to source, "conversationId" to conversation!!, "runId" to run!!, "status" to status!!, "url" to raw["url"]!!)
        }
        val legacy = source == "djl.runCompletion"
        if (source !in setOf("codex.runCompletion", "codex.structuredUserInput") && !legacy) return null
        if (legacy && raw["result"] !in setOf("completed", "failed")) return null
        val thread = raw["threadId"]
        val turn = raw["turnId"]?.takeUnless { legacy && it.isEmpty() }
        if (!validId(thread) || turn != null && !validId(turn)) return null
        return buildMap {
            put("source", if (legacy) "codex.runCompletion" else source)
            put("threadId", thread!!)
            if (turn != null) put("turnId", turn)
        }
    }
}

internal class RemotePushRegistrationGate {
    private var epoch = 0L
    private var enabled = false
    @Synchronized fun enable(): Long { enabled = true; return ++epoch }
    @Synchronized fun clear() { enabled = false; epoch++ }
    @Synchronized fun accepts(value: Long) = enabled && value == epoch
}

internal object RemotePushDeliveryWindow {
    fun remember(previous: Map<String, Long>, key: String, now: Long): Map<String, Long>? {
        val live = previous.filterValues { RemotePushEnvelope.fresh(it, now) }
        if (live.containsKey(key)) return null
        return live.entries.sortedBy { it.value }.takeLast(127)
            .associate { it.key to it.value } + (key to now)
    }
}
