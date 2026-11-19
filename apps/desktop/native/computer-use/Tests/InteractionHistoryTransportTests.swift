import Foundation
import Darwin

@main struct InteractionHistoryTransportTests {
    static func main() throws {
        if CommandLine.arguments.contains("--inherited") {
            precondition(HistoryPipe.accepts(3), "Node inherited fd3 accepted")
            print("HistoryPipe: Node-owned fd3 accepted"); return
        }
        var inversion: [Int32] = [0, 0]; precondition(pipe(&inversion) == 0)
        let controller = NSLock(), entered = DispatchSemaphore(value: 0), available = DispatchSemaphore(value: 0)
        let inversionWriter = try HistoryPipe(descriptor: inversion[1], failure: {})
        controller.lock()
        inversionWriter.setStatus(["test": "status"], current: { entered.signal(); return controller.withLock { true } })
        precondition(entered.wait(timeout: .now() + 1) == .success)
        DispatchQueue.global().async { _ = inversionWriter.available; available.signal() }
        let availableWhileAuthorityLocked = available.wait(timeout: .now() + 0.3) == .success
        controller.unlock()
        precondition(availableWhileAuthorityLocked, "authority callback must run outside pipe lock")
        inversionWriter.close(); Thread.sleep(forTimeInterval: 0.05); close(inversion[0])
        var descriptors: [Int32] = [0, 0]
        precondition(pipe(&descriptors) == 0)
        defer { close(descriptors[0]) }
        precondition(!HistoryPipe.accepts(descriptors[0]), "read-only pipe denied")
        precondition(HistoryPipe.accepts(descriptors[1]), "owned writable anonymous pipe accepted")
        precondition(!HistoryPipe.accepts(STDOUT_FILENO), "stdio denied")
        let stdoutAlias = dup(STDOUT_FILENO)
        precondition(stdoutAlias >= 0 && !HistoryPipe.accepts(stdoutAlias), "duplicated stdout denied")
        close(stdoutAlias)
        let stdoutFlags = fcntl(STDOUT_FILENO, F_GETFL)
        let file = open("/private/tmp/djl-cua-history-inert-file", O_CREAT | O_RDWR | O_TRUNC, 0o600)
        precondition(file >= 0 && !HistoryPipe.accepts(file), "regular file denied")
        close(file); unlink("/private/tmp/djl-cua-history-inert-file")
        let failed = DispatchSemaphore(value: 0)
        let writer = try HistoryPipe(descriptor: descriptors[1], failure: { failed.signal() })
        let lease = HistoryLease(epoch: "pipe-test", settings: try HistorySettings([
            "enabled": true, "paused": false, "interactionCaptureEnabled": true, "retentionDays": 7,
            "intervalSeconds": 30, "excludedBundleIds": [], "excludedDomains": []]))
        let now = Date().timeIntervalSince1970, clock = DispatchTime.now().uptimeNanoseconds
        for (name, deadline, sample) in [("expired Reader", clock, now), ("expired packet", clock + 1_000_000_000, now - 1.1), ("future packet", clock + 1_000_000_000, now + 1)] {
            precondition(!writer.enqueue(["navigation": name], lease: lease, time: HistoryAdmissionTime(deadline: deadline, capturedAt: sample), completion: { _ in }), "temporal admission rejects " + name)
        }
        precondition(writer.enqueue(["navigation": "fresh"], lease: lease, time: HistoryAdmissionTime(deadline: clock + 1_000_000_000, capturedAt: now), completion: { _ in }), "fresh navigation admitted by actual writer")
        precondition(writer.enqueue(["legacy": "unchanged"], lease: lease, completion: { _ in }), "existing callers without navigation time budget retain admission")
        precondition(fcntl(STDOUT_FILENO, F_GETFL) == stdoutFlags, "stdout flags unchanged")
        precondition(!writer.enqueue(["text": String(repeating: "x", count: 192 * 1024)], lease: lease, completion: { _ in }), "oversized JSON frame denied")
        var accepted = 0, rejected = 0
        for _ in 0..<200 {
            if writer.enqueue(["event": ["text": String(repeating: "x", count: 30_000)]], lease: lease, completion: { _ in }) { accepted += 1 } else { rejected += 1 }
        }
        precondition(accepted > 0 && rejected > 0, "unread pipe has bounded rejection")
        precondition(writer.pendingBytes <= 262_144 && writer.pendingRecords <= 16, "bounded history queue")
        lease.revoke(); writer.discardRevoked()
        // A different process/socketpair case covers close while idle; close the reader here to force EPIPE.
        close(descriptors[0]); descriptors[0] = -1
        precondition(failed.wait(timeout: .now() + 3) == .success, "peer close revokes without blocking control")
        writer.close()
        var idle: [Int32] = [0, 0]; precondition(pipe(&idle) == 0)
        let idleFailure = DispatchSemaphore(value: 0)
        let idleWriter = try HistoryPipe(descriptor: idle[1], failure: { idleFailure.signal() })
        close(idle[0])
        precondition(idleFailure.wait(timeout: .now() + 2) == .success, "idle peer close detected without any record")
        idleWriter.close()
        var stream: [Int32] = [0, 0]; precondition(pipe(&stream) == 0)
        let streamWriter = try HistoryPipe(descriptor: stream[1], failure: { fatalError("unexpected stream failure") })
        let streamLease = HistoryLease(epoch: "framing", settings: lease.settings)
        let readDone = DispatchSemaphore(value: 0), writeDone = DispatchSemaphore(value: 0)
        let readerFD = stream[0]
        Thread {
            var accumulated = Data(), buffer = [UInt8](repeating: 0, count: 997)
            while accumulated.filter({ $0 == 10 }).count < 3 {
                let size = Darwin.read(readerFD, &buffer, buffer.count)
                precondition(size > 0, "framing reader")
                accumulated.append(contentsOf: buffer.prefix(size))
            }
            let lines = accumulated.split(separator: 10)
            precondition(lines.count == 3)
            for (index, line) in lines.enumerated() {
                let object = try! JSONSerialization.jsonObject(with: Data(line)) as! [String: Any]
                precondition(object["index"] as? Int == index && (object["text"] as? String)?.count == 70_000, "partial JSONL writes retain order/content")
            }
            readDone.signal()
        }.start()
        for index in 0..<3 {
            precondition(streamWriter.enqueue(["index": index, "text": String(repeating: "x", count: 70_000)], lease: streamLease, completion: { success in precondition(success); writeDone.signal() }))
        }
        precondition(readDone.wait(timeout: .now() + 4) == .success)
        for _ in 0..<3 { precondition(writeDone.wait(timeout: .now() + 1) == .success) }
        streamWriter.close(); Thread.sleep(forTimeInterval: 0.05); close(readerFD)
        print("InteractionHistoryTransport: descriptor, bounded backpressure and peer-close assertions passed")
    }
}
