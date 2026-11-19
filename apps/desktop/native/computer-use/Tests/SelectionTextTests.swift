import Foundation

@main struct SelectionTextTests {
    static func main() throws {
        var checks = 0, failures = 0
        func check(_ label: String, _ actual: NSRange?, _ expected: NSRange?) {
            checks += 1
            if actual != expected { failures += 1; print("FAIL \(label): \(String(describing: actual)) != \(String(describing: expected))") }
        }
        check("unique", try SelectionText.resolve("alpha beta", text: "beta"), NSRange(location: 6, length: 4))
        check("not found", try SelectionText.resolve("alpha", text: "beta"), nil)
        check("empty query", try SelectionText.resolve("alpha", text: ""), nil)
        check("empty value", try SelectionText.resolve("", text: "a"), nil)
        check("ambiguous", try SelectionText.resolve("red red", text: "red"), nil)
        check("overlapping ambiguity", try SelectionText.resolve("aaa", text: "aa"), nil)
        check("prefix", try SelectionText.resolve("red red", text: "red", prefix: "red "), NSRange(location: 4, length: 3))
        check("suffix", try SelectionText.resolve("red red", text: "red", suffix: " red"), NSRange(location: 0, length: 3))
        check("both contexts", try SelectionText.resolve("A red B red C", text: "red", prefix: "B ", suffix: " C"), NSRange(location: 8, length: 3))
        check("context rejected", try SelectionText.resolve("red", text: "red", prefix: "x"), nil)
        check("suffix beyond value", try SelectionText.resolve("red", text: "red", suffix: "x"), nil)
        check("empty context", try SelectionText.resolve("red", text: "red", prefix: "", suffix: ""), NSRange(location: 0, length: 3))
        check("case sensitive", try SelectionText.resolve("Red", text: "red"), nil)
        check("UTF16 location", try SelectionText.resolve("🧪 café", text: "café"), NSRange(location: 3, length: 4))
        check("UTF16 length", try SelectionText.resolve("x🧪y", text: "🧪"), NSRange(location: 1, length: 2))
        check("canonical equivalence", try SelectionText.resolve("xe\u{301}y", text: "é"), NSRange(location: 1, length: 2))
        check("newline context", try SelectionText.resolve("a\nb\nc", text: "b", prefix: "a\n", suffix: "\nc"), NSRange(location: 2, length: 1))
        check("before", try SelectionText.resolve("alpha beta", text: "beta", mode: .before), NSRange(location: 6, length: 0))
        check("after", try SelectionText.resolve("alpha beta", text: "beta", mode: .after), NSRange(location: 10, length: 0))
        let bold = SelectionText.Mapping(offsets: [nil, nil, 0, 1, nil, nil], sourceLength: 2)
        check("Markdown mapping", try SelectionText.resolve("**Hi**", text: "Hi", mapping: bold), NSRange(location: 0, length: 2))
        check("include generated marks", try SelectionText.resolve("**Hi**", text: "**Hi**", mapping: bold), NSRange(location: 0, length: 2))
        check("generated marks only", try SelectionText.resolve("**Hi**", text: "**", prefix: "Hi", mapping: bold), nil)
        check("mapped after", try SelectionText.resolve("**Hi**", text: "Hi", mode: .after, mapping: bold), NSRange(location: 2, length: 0))
        let spaced = SelectionText.Mapping(offsets: [2, nil, 5], sourceLength: 6)
        check("span omitted source", try SelectionText.resolve("a-b", text: "a-b", mapping: spaced), NSRange(location: 2, length: 4))
        check("mapping count", try SelectionText.resolve("abc", text: "a", mapping: .init(offsets: [0], sourceLength: 3)), nil)
        check("mapping negative", try SelectionText.resolve("a", text: "a", mapping: .init(offsets: [-1], sourceLength: 3)), nil)
        check("mapping beyond source", try SelectionText.resolve("a", text: "a", mapping: .init(offsets: [3], sourceLength: 3)), nil)
        check("mapping reversed", try SelectionText.resolve("ab", text: "ab", mapping: .init(offsets: [1, 0], sourceLength: 3)), nil)
        check("mapping repeated source", try SelectionText.resolve("ab", text: "ab", mapping: .init(offsets: [0, 0], sourceLength: 1)), NSRange(location: 0, length: 1))
        enum Cancelled: Error { case requested }
        var visits = 0, cancelled = false
        do {
            _ = try SelectionText.resolve(String(repeating: "a", count: 1000), text: "a", prefix: "b", checkpoint: {
                visits += 1
                if visits == 3 { throw Cancelled.requested }
            })
        } catch Cancelled.requested { cancelled = true }
        checks += 1
        if !cancelled || visits != 3 { failures += 1; print("FAIL cancellation during rejected matches") }
        check("source bound", try SelectionText.resolve(String(repeating: "a", count: 1_048_577), text: "x"), nil)
        print("SelectionText: \(checks) checks, \(failures) failures")
        if failures != 0 { exit(1) }
    }
}
