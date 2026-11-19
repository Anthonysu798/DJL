import Foundation
import Darwin

// Immutable temporal facts; no authority callback or lock acquisition at admission.
struct HistoryAdmissionTime {
    let deadline: UInt64, capturedAt: TimeInterval
    var valid: Bool {
        DispatchTime.now().uptimeNanoseconds < deadline && HistoryInputIdentity.freshSample(age: Date().timeIntervalSince1970 - capturedAt)
    }
}

// This writer never touches stdout or its lock. Only the explicitly inherited activity descriptor is owned.
final class HistoryPipe {
    private struct Frame {
        let data: Data, lease: HistoryLease?, current: () -> Bool, completion: (Bool) -> Void
        var offset = 0
    }
    private let lock = NSLock(), lane = DispatchQueue(label: "com.djl.history.pipe")
    private var frames: [Frame] = [], status: Frame?, bytes = 0, closed = false, activeRecord = false
    private var timer: DispatchSourceTimer?
    private let descriptor: Int32, failure: () -> Void
    var pendingBytes: Int { lock.withLock { bytes } }
    var pendingRecords: Int { lock.withLock { frames.count + (activeRecord ? 1 : 0) } }
    var available: Bool { lock.withLock { !closed } }
    static func accepts(_ fd: Int32) -> Bool {
        guard fd > 2 else { return false }
        let flags = fcntl(fd, F_GETFL)
        guard flags >= 0, flags & O_ACCMODE != O_RDONLY else { return false }
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_uid == geteuid() else { return false }
        let kind = info.st_mode & S_IFMT
        guard kind == S_IFIFO || kind == S_IFSOCK else { return false }
        for standard in [STDIN_FILENO, STDOUT_FILENO, STDERR_FILENO] {
            var other = stat()
            if fstat(standard, &other) == 0, info.st_dev == other.st_dev, info.st_ino == other.st_ino,
               info.st_mode & S_IFMT == other.st_mode & S_IFMT { return false }
        }
        if kind == S_IFSOCK {
            var type: Int32 = 0, size = socklen_t(MemoryLayout<Int32>.size)
            guard getsockopt(fd, SOL_SOCKET, SO_TYPE, &type, &size) == 0, type == SOCK_STREAM else { return false }
            var local = sockaddr(), remote = sockaddr()
            var localSize = socklen_t(MemoryLayout<sockaddr>.size), remoteSize = localSize
            guard getsockname(fd, &local, &localSize) == 0, getpeername(fd, &remote, &remoteSize) == 0,
                  local.sa_family == AF_UNIX, remote.sa_family == AF_UNIX else { return false }
            var uid = uid_t(0), gid = gid_t(0)
            guard getpeereid(fd, &uid, &gid) == 0, uid == geteuid() else { return false }
        }
        return true
    }
    init(descriptor: Int32, failure: @escaping () -> Void) throws {
        guard Self.accepts(descriptor) else { throw HistoryInvalid() }
        let flags = fcntl(descriptor, F_GETFL), descriptorFlags = fcntl(descriptor, F_GETFD)
        guard fcntl(descriptor, F_SETFL, flags | O_NONBLOCK) == 0,
              fcntl(descriptor, F_SETFD, descriptorFlags | FD_CLOEXEC) == 0 else { throw HistoryInvalid() }
        self.descriptor = descriptor; self.failure = failure
        let timer = DispatchSource.makeTimerSource(queue: lane)
        self.timer = timer
        timer.schedule(deadline: .now(), repeating: .milliseconds(25))
        timer.setEventHandler { [weak self] in self?.drain() }
        timer.resume()
    }
    func enqueue(_ object: [String: Any], lease: HistoryLease, time: HistoryAdmissionTime? = nil, completion: @escaping (Bool) -> Void) -> Bool {
        guard lease.valid, let data = Self.encode(object, limit: 192 * 1024) else { return false }
        return lock.withLock {
            guard !closed, lease.valid, time?.valid != false, frames.count + (activeRecord ? 1 : 0) < 16, bytes + data.count <= 256 * 1024 else { return false }
            frames.append(Frame(data: data, lease: lease, current: { lease.valid }, completion: completion))
            bytes += data.count; return true
        }
    }
    func setStatus(_ object: [String: Any], current: @escaping () -> Bool) {
        guard let data = Self.encode(object, limit: 1024) else { return }
        lock.withLock {
            guard !closed else { return }
            // A partial status is already the active frame; latest not-started status is coalesced.
            status = Frame(data: data, lease: nil, current: current, completion: { _ in })
        }
    }
    private static func encode(_ object: [String: Any], limit: Int) -> Data? {
        guard var data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]), data.count + 1 <= limit else { return nil }
        data.append(10); return data
    }
    func discardRevoked() { lane.async { [weak self] in self?.drain() } }
    private var active: Frame? // Writer lane only; bytes includes an active record until completion.
    private func drain() {
        guard available else { return }
        var polling = pollfd(fd: descriptor, events: Int16(POLLOUT), revents: 0)
        if poll(&polling, 1, 0) < 0 { if errno != EINTR { stop(failed: true) }; return }
        if polling.revents & Int16(POLLERR | POLLHUP | POLLNVAL) != 0 { stop(failed: true); return }
        var budget = 65_536
        while budget > 0, available {
            if active == nil {
                lock.withLock {
                    // Authority callbacks may take controller locks. Never invoke them under the pipe lock.
                    if let latest = status { status = nil; active = latest }
                    else if !frames.isEmpty { active = frames.removeFirst(); activeRecord = true }
                }
            }
            guard var frame = active else { return }
            if frame.offset == 0 && !frame.current() {
                if frame.lease != nil { lock.withLock { bytes -= frame.data.count; activeRecord = false } }
                active = nil; frame.completion(false); continue
            }
            let amount = min(budget, frame.data.count - frame.offset)
            let written = frame.data.withUnsafeBytes { pointer in
                Darwin.write(descriptor, pointer.baseAddress!.advanced(by: frame.offset), amount)
            }
            if written < 0 {
                if errno == EAGAIN || errno == EWOULDBLOCK { return }
                if errno == EINTR { budget -= 1; continue }
                stop(failed: true); return
            }
            guard written > 0 else { return }
            frame.offset += written; budget -= written; active = frame
            if frame.offset == frame.data.count {
                active = nil
                if frame.lease != nil { lock.withLock { bytes -= frame.data.count; activeRecord = false } }
                frame.completion(true)
            }
        }
    }
    private func stop(failed: Bool) {
        let pending: [Frame]? = lock.withLock {
            guard !closed else { return nil }
            closed = true
            let pending = frames; frames.removeAll(); status = nil; bytes = 0; activeRecord = false
            return pending
        }
        guard let pending = pending else { return }
        timer?.cancel(); timer = nil
        Darwin.close(descriptor)
        let previous = active; active = nil
        previous?.completion(false); pending.forEach { $0.completion(false) }
        if failed { failure() }
    }
    func close() { lane.async { [weak self] in self?.stop(failed: false) } }
}
