package app.djl.mobile

import org.junit.Assert.*
import org.junit.Test

class RunStatusModelTest {
    private val now = 1_800_000_000_000L
    private val instance = "4b85f888-2c0a-4ead-9243-7f0792fc3ecb"
    private fun identity(epoch: Long = 0, id: String = instance) = mapOf("schemaVersion" to 1, "epoch" to epoch, "instance" to id)
    private fun row(state: String = "running") = mapOf("state" to state, "startedAt" to now - 1000, "staleAt" to now + 1000, "expiresAt" to now + 3000)
    private fun payload(detailed: Boolean = false, rows: List<Map<String, Any>> = listOf(row())) = identity() + mapOf(
        "detailed" to detailed, "counts" to mapOf("running" to rows.size, "failed" to 0, "ready" to 0),
        "buckets" to mapOf("running" to rows, "failed" to emptyList<Any>(), "ready" to emptyList<Any>()), "action" to "openApp", "nextDeadline" to now + 1000)
    @Test fun genericRejectsPrivateUnknownAndMalformedFields() {
        assertNull(RunStatusSnapshot.decode(payload(rows = listOf(row() + mapOf("title" to "private"))), now))
        assertNull(RunStatusSnapshot.decode(payload() + mapOf("host" to "private"), now))
        assertNull(RunStatusSnapshot.decode(payload() + mapOf("detailed" to 1), now))
        assertNull(RunStatusSnapshot.decode(payload(rows = listOf(row() + mapOf("state" to "unknown"))), now))
        assertNull(RunStatusSnapshot.decode(payload(rows = List(4) { row() }), now))
        assertNull(RunStatusSnapshot.decode(payload(rows = listOf(row() + mapOf("staleAt" to true))), now))
    }
    @Test fun detailedLinksAndUnicodeAreStrict() {
        val detail = row() + mapOf("threadId" to "t", "title" to "😀".repeat(120), "detail" to "project", "url" to "djl://thread/t?macId=m&macKeySha256=${"a".repeat(64)}")
        assertNotNull(RunStatusSnapshot.decode(payload(true, listOf(detail)), now)?.rows?.first()?.url)
        for (bad in listOf(mapOf("title" to "😀".repeat(121)), mapOf("detail" to "full/path"), mapOf("url" to "djl://thread/t?macId=m"), mapOf("url" to "djl://thread/wrong?macId=m&macKeySha256=${"a".repeat(64)}"), mapOf("url" to "djl://thread/t?macId=m&macKeySha256=${"a".repeat(64)}&extra=bad"))) {
            assertNull(RunStatusSnapshot.decode(payload(true, listOf(detail + bad)), now))
        }
    }
    @Test fun canonicalLinksRejectAlternateEscapesAndInvalidUtf8() {
        val key = "a".repeat(64)
        assertNull(RunStatusSnapshot.actionURL("djl://thread/t?macId=%6D&macKeySha256=$key"))
        assertNull(RunStatusSnapshot.actionURL("djl://thread/t?macId=%FF&macKeySha256=$key"))
        assertNotNull(RunStatusSnapshot.actionURL("djl://thread/t+%C3%A9?macId=a+b&macKeySha256=$key"))
    }

    @Test fun deadlinesPauseAndExpireWithoutNewEvidence() {
        val snapshot = RunStatusSnapshot.decode(payload(), now)!!
        assertEquals(now + 1000, snapshot.nextDeadline(now))
        assertEquals("paused", snapshot.project(now + 1000).rows.single().state)
        assertTrue(snapshot.project(now + 3000).rows.isEmpty())
        assertNull(RunStatusSnapshot.decode(payload(rows = listOf(row() + mapOf("expiresAt" to now + 14_400_001))), now))
    }
    @Test fun nineEntriesKeepHiddenDeadlinesButOnlyThreeVisibleRows() {
        val rows = listOf(row(), row(), row())
        val failed = List(3) { row("failed") }
        val ready = List(3) { row("ready") + mapOf("staleAt" to now + 500, "expiresAt" to now + 500) }
        val raw = payload() + mapOf("counts" to mapOf("running" to 3, "failed" to 3, "ready" to 3), "buckets" to mapOf("running" to rows, "failed" to failed, "ready" to ready))
        val snapshot = RunStatusSnapshot.decode(raw, now)!!
        assertEquals(listOf("running", "running", "running"), snapshot.rows.map { it.state })
        assertEquals(now + 500, snapshot.nextDeadline(now))
        assertEquals(0, snapshot.project(now + 500).ready.size)
        assertTrue(snapshot.rows.all { it.threadId == null && it.title == null && it.detail == null && it.url == null })
    }

    @Test fun newEndRetiresOldInstanceAndOldCompletions() {
        val gate = RunStatusGate()
        val old = RunStatusIdentity.decode(identity(90))!!
        assertNull(gate.update(old))
        val token = gate.end(old)!!
        assertNotNull(gate.update(old))
        assertNull(gate.update(RunStatusIdentity.decode(identity(89))!!))
        val fresh = RunStatusIdentity.decode(identity(0, "1b85f888-2c0a-4ead-9243-7f0792fc3ecb"))!!
        assertNotNull(gate.end(fresh))
        assertFalse(gate.current(token))
        assertNull(gate.update(old)); assertNull(gate.end(old))
        assertNotNull(gate.update(fresh))
    }
}
