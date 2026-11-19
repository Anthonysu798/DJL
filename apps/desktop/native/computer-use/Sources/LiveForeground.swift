import ApplicationServices
import Darwin

// Exact installed SDK ABI: GetFrontProcess returns OSErr/SInt16;
// GetProcessPID returns OSStatus/SInt32. No cached NSWorkspace fallback.
private typealias ReadFrontProcess = @convention(c) (UnsafeMutablePointer<ProcessSerialNumber>) -> Int16
private typealias ResolveFrontPid = @convention(c) (UnsafePointer<ProcessSerialNumber>, UnsafeMutablePointer<pid_t>) -> Int32
enum LiveForeground {
    private static let services = dlopen("/System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework/HIServices", RTLD_NOW | RTLD_LOCAL)
    private static let read = services.flatMap { dlsym($0, "GetFrontProcess") }.map { unsafeBitCast($0, to: ReadFrontProcess.self) }
    private static let resolve = services.flatMap { dlsym($0, "GetProcessPID") }.map { unsafeBitCast($0, to: ResolveFrontPid.self) }
    static func pid() -> pid_t? {
        guard let read = read, let resolve = resolve else { return nil }
        var psn = ProcessSerialNumber(highLongOfPSN: 0, lowLongOfPSN: 0), pid: pid_t = 0
        guard read(&psn) == 0, resolve(&psn, &pid) == 0, pid > 0 else { return nil }
        return pid
    }
}
