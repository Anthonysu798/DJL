import Foundation
struct Missing: Error {}
struct ProcessIdentity: Equatable {
    let startSeconds: UInt64, startMicroseconds: UInt64
    let executable: URL
    let ownerUserID: UInt32
    init(seconds: UInt64 = 7, microseconds: UInt64 = 11, executable: String = "/owned/app", user: UInt32 = 501) { startSeconds=seconds; startMicroseconds=microseconds; self.executable=URL(fileURLWithPath:executable); ownerUserID=user }
    init(_ pid: pid_t) throws { guard let value=Model.current else { throw Missing() }; self=value }
}
var errno: Int32 = 0
let ESRCH: Int32 = 3
enum Model {
    static var current: ProcessIdentity? = ProcessIdentity()
    static var killResult: Int32 = 0, error: Int32 = 0
    static func kill(_ pid: pid_t, _ signal: Int32) -> Int32 { errno=error; return killResult }
}
//__PRODUCTION_FUNCTION__

@main struct GenerationTests {
 static func main() {
    let original=ProcessIdentity();var checks=0,failures=0
    func check(_ condition: Bool,_ message: String){checks+=1;if !condition{failures+=1;print("FAIL: \(message)")}}
    check(!processReplacedOrExited(20,original),"same generation remains live")
    Model.current=ProcessIdentity(user:502);check(Model.current != original,"credential change invalidates full identity")
    check(!processReplacedOrExited(20,original),"credential change alone does not prove process death")
    Model.current=ProcessIdentity(seconds:8);check(processReplacedOrExited(20,original),"start-second change is replacement")
    Model.current=ProcessIdentity(microseconds:12);check(processReplacedOrExited(20,original),"start-microsecond change is replacement")
    Model.current=ProcessIdentity(executable:"/owned/other");check(processReplacedOrExited(20,original),"executable change is replacement")
    Model.current=nil;Model.killResult=0;check(!processReplacedOrExited(20,original),"unknown kernel metadata on a live PID is not death")
    Model.killResult = -1;Model.error=3;check(processReplacedOrExited(20,original),"ESRCH proves exit")
    Model.error=1;check(!processReplacedOrExited(20,original),"permission failure is not exit")
    print("Process generation retirement: \(checks-failures)/\(checks) checks passed");exit(failures == 0 ? 0:1)
 }
}
