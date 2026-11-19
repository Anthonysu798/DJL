package app.djl.mobile

// TEST ONLY. postTime is OS wall-clock posting time; timeoutAfter is measured
// from that point. Allow at most 750ms posting/scheduling slack, never a later
// visible-row deadline in place of the expected hidden-row deadline.
internal object NativeStatusDeadline {
    private const val MAX_EPOCH = 9_007_199_254_740_991L
    private const val POSTING_ALLOWANCE_MS = 750L
    fun matches(expected: Any?, postTime: Long, timeoutAfter: Long): Boolean {
        val deadline = when (expected) {
            is Long -> expected
            is Int -> expected.toLong()
            else -> return false
        }
        if (deadline !in 1..MAX_EPOCH || timeoutAfter !in 1..45_000 || postTime !in 1..(MAX_EPOCH - timeoutAfter)) return false
        val actualDeadline = postTime + timeoutAfter
        return kotlin.math.abs(actualDeadline - deadline) <= POSTING_ALLOWANCE_MS
    }
}
