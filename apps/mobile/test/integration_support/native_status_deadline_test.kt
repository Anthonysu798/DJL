package app.djl.mobile

private data class Case(val name: String, val expected: Any?, val posted: Long, val timeout: Long, val matches: Boolean)

fun main() {
    val now = 1_800_000_000_000L
    val expected = now + 25_000
    val cases = listOf(
        Case("exact hidden deadline", expected, now, 25_000, true),
        Case("wrong visible stale deadline", expected, now, 30_000, false),
        Case("wrong visible hard deadline", expected, now, 45_000, false),
        Case("bounded positive posting latency", expected, now + 750, 25_000, true),
        Case("bounded negative scheduling slack", expected, now - 750, 25_000, true),
        Case("excess positive posting latency", expected, now + 751, 25_000, false),
        Case("excess negative scheduling slack", expected, now - 751, 25_000, false),
        Case("missing expected deadline", null, now, 25_000, false),
        Case("string expected deadline", expected.toString(), now, 25_000, false),
        Case("floating expected deadline", expected.toDouble(), now, 25_000, false),
        Case("boolean expected deadline", true, now, 25_000, false),
        Case("zero expected deadline", 0L, now, 25_000, false),
        Case("negative expected deadline", -1L, now, 25_000, false),
        Case("oversized expected deadline", Long.MAX_VALUE, now, 25_000, false),
        Case("zero post time", expected, 0, 25_000, false),
        Case("negative post time", expected, -1, 25_000, false),
        Case("post time overflow", expected, Long.MAX_VALUE, 25_000, false),
        Case("zero duration", expected, now, 0, false),
        Case("duration exceeds adapter cap", expected, now, 45_001, false),
        Case("valid maximum duration with actual expected deadline", now + 45_000, now, 45_000, true)
    )
    for (case in cases) {
        check(NativeStatusDeadline.matches(case.expected, case.posted, case.timeout) == case.matches) { "Native status deadline regression: ${case.name}" }
    }
    println("Native status deadline: ${cases.size} cases passed")
}
