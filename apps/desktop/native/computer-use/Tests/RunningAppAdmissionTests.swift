import Foundation

struct Failure: Error { let code: String; let message: String }
func fail(_ code: String, _ message: String) throws -> Never { throw Failure(code: code, message: message) }
func getpid() -> pid_t { 999 }
func geteuid() -> UInt32 { 501 }
struct Target { let pid: pid_t; let bundle: String }
struct Sample { var bundle: String? = "com.djl.fixture"; var terminated = false }
enum Model {
    static var clock: UInt64 = 0
    static var queriedPids: [pid_t] = []
    static var samples: [Sample?] = [Sample()]
    static var lookups = 0, identityReads = 0, sleeps = 0, bundleReads = 0, terminationReads = 0
    static var identity = 7, identityAvailable = true, cancelled = false
    static var ownerUserID: UInt32 = 501
    static var onLookup: (() -> Void)?, onSleep: (() -> Void)?, onIdentity: (() -> Void)?, onBundle: (() -> Void)?
    static func reset() { clock = 0; queriedPids = []; samples = [Sample()]; lookups = 0; identityReads = 0; sleeps = 0; bundleReads = 0; terminationReads = 0; identity = 7; ownerUserID = 501; identityAvailable = true; cancelled = false; onLookup = nil; onSleep = nil; onIdentity = nil; onBundle = nil }
}
struct ProcessIdentity: Equatable {
    let value: Int
    let ownerUserID: UInt32
    init(_ pid: pid_t) throws { Model.queriedPids.append(pid); Model.identityReads += 1; Model.onIdentity?(); guard Model.identityAvailable else { try fail("target-unavailable", "Unavailable") }; value = Model.identity; ownerUserID = Model.ownerUserID }
}
final class NSRunningApplication {
    private let sample: Sample
    var bundleIdentifier: String? { Model.bundleReads += 1; Model.onBundle?(); return sample.bundle }
    var isTerminated: Bool { Model.terminationReads += 1; return sample.terminated }
    init?(processIdentifier: pid_t) {
        Model.queriedPids.append(processIdentifier)
        let index = Model.lookups; Model.lookups += 1; Model.onLookup?()
        guard let sample = Model.samples[min(index, Model.samples.count - 1)] else { return nil }
        self.sample = sample
    }
}
struct DispatchTime {
    let uptimeNanoseconds: UInt64
    static func now() -> Self { Self(uptimeNanoseconds: Model.clock) }
}
enum Thread {
    static func sleep(forTimeInterval seconds: Double) { Model.sleeps += 1; guard Model.sleeps < 1000 else { fatalError("Admission did not terminate") }; Model.clock += UInt64(seconds * 1_000_000_000); Model.onSleep?() }
}
struct TestFailure: Error { let message: String }
var cases = 0, assertions = 0, failures = 0
func expect(_ value: Bool, _ message: String) throws { assertions += 1; if !value { throw TestFailure(message: message) } }
let target = Target(pid: 123, bundle: "com.djl.fixture")
func admit() throws -> RunningApplicationBinding { try admitRunningApplication(target, isCancelled: { Model.cancelled }) }
func denied(_ code: String) throws {
    do { _ = try admit(); throw TestFailure(message: "Admission should be denied") }
    catch let error as Failure { try expect(error.code == code, "Expected \(code), got \(error.code)") }
}
func run(_ name: String, _ body: () throws -> Void) {
    Model.reset(); cases += 1
    do { try body(); try expect(Model.queriedPids.allSatisfy { $0 == target.pid }, "Queried an unrelated PID") } catch { failures += 1; print("FAIL \(name): \(error)") }
}
run("immediate fresh match") { let result = try admit(); try expect(result.identity.value == 7 && result.app.bundleIdentifier == target.bundle, "Wrong binding"); try expect(Model.sleeps == 0, "Fresh metadata must not wait") }
run("transient missing metadata recovers") { Model.samples = [nil, nil, Sample()]; let result = try admit(); try expect(result.identity.value == 7, "Identity changed"); try expect(Model.lookups == 3 && Model.sleeps == 2, "Must retry fresh lookup") }
run("missing bundle is unknown until refreshed") { Model.samples = [Sample(bundle: nil), Sample()]; _ = try admit(); try expect(Model.lookups == 2, "Must re-read missing bundle") }
run("permanent absence has bounded monotonic deadline") { Model.samples = [nil]; try denied("target-unavailable"); try expect(Model.clock >= 100_000_000 && Model.clock <= 102_000_000, "Timeout not bounded") }
run("different bundle is rejected without waiting") { Model.samples = [Sample(bundle: "com.other")]; try denied("target-unavailable"); try expect(Model.sleeps == 0, "Must not retry explicit mismatch") }
run("terminated app rejected") { Model.samples = [Sample(terminated: true)]; try denied("target-unavailable"); try expect(Model.sleeps == 0, "Terminated app must not wait") }
run("missing kernel identity is not retried") { Model.identityAvailable = false; try denied("target-unavailable"); try expect(Model.lookups == 0, "No app lookup without kernel identity") }
run("PID replacement during wait") { Model.samples = [nil, Sample()]; Model.onSleep = { Model.identity = 8 }; try denied("target-unavailable"); try expect(Model.lookups == 1, "Do not retarget a reused PID") }
run("PID replacement during metadata call") { Model.onLookup = { Model.identity = 8 }; try denied("target-unavailable") }
run("Stop before admission") { Model.cancelled = true; try denied("cancelled"); try expect(Model.lookups == 0 && Model.identityReads == 0, "No OS reads after Stop") }
run("Stop between attempts") { Model.samples = [nil, Sample()]; Model.onSleep = { Model.cancelled = true }; try denied("cancelled"); try expect(Model.lookups == 1, "No lookup after Stop") }
run("Stop during metadata read") { Model.onLookup = { Model.cancelled = true }; try denied("cancelled") }
run("slow metadata success past deadline") { Model.onLookup = { Model.clock += 101_000_000 }; try denied("target-unavailable") }
run("slow kernel identity past deadline") { Model.onIdentity = { if Model.identityReads == 1 { Model.clock += 101_000_000 } }; try denied("target-unavailable"); try expect(Model.lookups == 0, "No lookup after expired pin") }
run("a prior binding cannot replace a fresh lookup") { let retained = try admit(); Model.samples = [nil]; Model.lookups = 0; try denied("target-unavailable"); try expect(retained.app.bundleIdentifier == target.bundle, "Prior binding still retained by caller") }
run("Stop during initial kernel pin") { Model.onIdentity = { Model.cancelled = true }; try denied("cancelled"); try expect(Model.lookups == 0, "No lookup after Stop during pin") }
run("kernel metadata becomes unknown during app lookup") { Model.onLookup = { Model.identityAvailable = false }; try denied("target-unavailable") }
run("Stop after lookup skips further app properties") { Model.onLookup = { Model.cancelled = true }; try denied("cancelled"); try expect(Model.bundleReads == 0 && Model.terminationReads == 0, "Read app properties after Stop") }
run("Stop after bundle read skips termination property") { Model.onBundle = { Model.cancelled = true }; try denied("cancelled"); try expect(Model.terminationReads == 0, "Read another app property after Stop") }
run("cross-user target rejected before app lookup") { Model.ownerUserID = 502; try denied("target-unavailable"); try expect(Model.lookups == 0, "Must reject ownership before LaunchServices lookup") }
run("credential change during metadata invalidates binding") { Model.onBundle = { Model.ownerUserID = 502 }; try denied("target-unavailable"); try expect(Model.lookups == 1, "No retarget after owner change") }
print("Running app admission: \(cases) cases / \(assertions) assertions; \(failures) failures")
exit(failures == 0 ? 0 : 1)
