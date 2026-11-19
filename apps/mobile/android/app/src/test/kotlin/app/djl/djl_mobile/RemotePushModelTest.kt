package app.djl.mobile

import org.junit.Assert.*
import org.junit.Test

class RemotePushModelTest {
    @Test fun routesOnlyKnownContentFreeEnvelopes() {
        val route = RemotePushEnvelope.decode(mapOf("source" to "djl.cloudRun", "runId" to "r1", "conversationId" to "c1", "status" to "succeeded", "url" to "djl://cloud/c/c1", "body" to "private"))!!
        assertEquals(setOf("source", "runId", "conversationId", "status", "url"), route.keys)
        assertNull(RemotePushEnvelope.decode(route + ("url" to "djl://cloud/c/c1?approve=1")))
        assertNull(RemotePushEnvelope.decode(route + ("source" to "foreign")))
        assertNull(RemotePushEnvelope.decode(route + ("status" to "running")))
        assertNull(RemotePushEnvelope.decode(route + ("conversationId" to "../bad")))
    }

    @Test fun pairedCompletionNormalizesLegacyWithoutTrustingMacOrEmptyTurn() {
        val input = mapOf("source" to "djl.runCompletion", "threadId" to "thread-1", "turnId" to "", "result" to "completed", "macId" to "untrusted")
        assertEquals(mapOf("source" to "codex.runCompletion", "threadId" to "thread-1"), RemotePushEnvelope.decode(input))
        assertNull(RemotePushEnvelope.decode(input + ("result" to "running")))
        assertNull(RemotePushEnvelope.decode(input + ("turnId" to "../bad")))
    }

    @Test fun clearFencesRegistrationAndOnlyCurrentOptInCanAcceptAnIdentifier() {
        val gate = RemotePushRegistrationGate()
        val first = gate.enable()
        gate.clear()
        assertFalse(gate.accepts(first))
        val second = gate.enable()
        assertFalse(gate.accepts(first))
        assertTrue(gate.accepts(second))
        gate.clear()
        assertFalse(gate.accepts(second))
    }

    @Test fun receiptLifetimeRejectsFutureAndExpiredNotifications() {
        assertTrue(RemotePushEnvelope.fresh(1000, 1000))
        assertTrue(RemotePushEnvelope.fresh(1000, 301000))
        assertFalse(RemotePushEnvelope.fresh(1000, 301001))
        assertFalse(RemotePushEnvelope.fresh(1000, 999))
    }

    @Test fun deliveryDedupeSurvivesTapConsumptionAndExpiresWithinABoundedWindow() {
        val seen = RemotePushDeliveryWindow.remember(emptyMap(), "message-1", 1000)!!
        // Tap routes are stored separately and may already have been consumed.
        assertNull(RemotePushDeliveryWindow.remember(seen, "message-1", 1001))
        assertNotNull(RemotePushDeliveryWindow.remember(seen, "message-1", 301001))
        val full = (0 until 128).associate { "message-$it" to 1000L + it }
        val trimmed = RemotePushDeliveryWindow.remember(full, "new-message", 2000)!!
        assertEquals(128, trimmed.size)
        assertFalse(trimmed.containsKey("message-0"))
        assertEquals(2000L, trimmed["new-message"])
    }
}
