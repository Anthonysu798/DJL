import Foundation

@main struct SelectionOperationTests {
    enum TestError: Error { case cancelled, focus, invalid, write }
    static func main() throws {
        var checks = 0, failures = 0
        func check(_ condition: Bool, _ name: String) {
            checks += 1
            if !condition { failures += 1; print("FAIL \(name)") }
        }
        func scenario(_ name: String, initial: String = "🧪 café", later: String? = nil,
                      text: String = "café", cancellation: String? = nil,
                      fault: String? = nil, expected: String? = nil) {
            var reads = 0, focused = false, writes: [NSRange] = [], stopped = cancellation == "before"
            var outcome: String?
            do {
                let range = try SelectionOperation.perform(text: text, prefix: nil, suffix: nil, mode: .text, readValue: {
                    reads += 1
                    if reads == 2 && cancellation == "read" { stopped = true }
                    return reads == 1 ? initial : later ?? initial
                }, focus: {
                    focused = true
                    if fault == "focus" { throw TestError.focus }
                    if cancellation == "focus" { stopped = true }
                }, validate: {
                    if fault == "validate" { throw TestError.invalid }
                }, write: { range in
                    if fault == "write" { throw TestError.write }
                    writes.append(range)
                }, checkpoint: {
                    if stopped { throw TestError.cancelled }
                })
                check(range == NSRange(location: 3, length: 4), name + " returned exact UTF16 range")
            } catch SelectionOperation.Failure.missingOrAmbiguous { outcome = "match" }
              catch SelectionOperation.Failure.valueChanged { outcome = "changed" }
              catch TestError.cancelled { outcome = "cancelled" }
              catch TestError.focus { outcome = "focus" }
              catch TestError.invalid { outcome = "validate" }
              catch TestError.write { outcome = "write" }
              catch { outcome = "unexpected" }
            check(outcome == expected, name + " error")
            if expected == nil {
                check(focused && reads == 2 && writes == [NSRange(location: 3, length: 4)], name + " fresh target effect")
            } else {
                check(writes.isEmpty, name + " no mutation")
            }
            if expected == "match" || cancellation == "before" { check(!focused, name + " no focus side effect") }
        }
        scenario("success")
        scenario("ambiguous", initial: "café café", expected: "match")
        scenario("not found", text: "missing", expected: "match")
        scenario("source changed", later: "x café", expected: "changed")
        scenario("canonical source changed", initial: "🧪 café", later: "🧪 cafe\u{301}", expected: "changed")
        scenario("cancel before", cancellation: "before", expected: "cancelled")
        scenario("cancel after focus", cancellation: "focus", expected: "cancelled")
        scenario("cancel during readback", cancellation: "read", expected: "cancelled")
        scenario("focus failure", fault: "focus", expected: "focus")
        scenario("validation failure", fault: "validate", expected: "validate")
        scenario("write failure", fault: "write", expected: "write")
        print("SelectionOperation: \(checks) checks, \(failures) failures")
        if failures != 0 { exit(1) }
    }
}
