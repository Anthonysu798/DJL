// FILE: CodexService+DesktopTerminal.swift
// Purpose: Attaches phone terminals to the shells DJL desktop runs for a thread and mirrors their output over the relay.
// Layer: Service Extension
// Exports: CodexService desktop terminal APIs
// Depends on: CodexService, CodexService+Terminal, DJLTerminalModels

import Foundation

extension CodexService {
    static let desktopTerminalEventMethod = "djl/terminal/event"
    static let desktopTerminalOfflineMessage = "Device offline"
    static let desktopTerminalAckFlushBytes = 65_536
    static let desktopTerminalAckFlushNanoseconds: UInt64 = 150_000_000

    func desktopTerminalBinding(for terminalId: String) -> DesktopTerminalBinding? {
        desktopTerminalBindings[terminalId]
    }

    // Attaches to (or lets the desktop create) the thread terminal and seeds the
    // phone buffer from the desktop's history so the view starts in sync.
    func openDesktopTerminal(
        terminalId: String,
        threadId: String,
        cwd: String?,
        cols: Int,
        rows: Int
    ) async throws {
        let binding = DesktopTerminalBinding(
            threadId: threadId,
            terminalId: DesktopTerminalBinding.desktopTerminalId(forPhoneTerminalId: terminalId)
        )
        desktopTerminalBindings[terminalId] = binding
        desktopTerminalsAwaitingReattach.remove(terminalId)
        desktopTerminalPendingAckBytes.removeValue(forKey: terminalId)
        let instanceId = UUID().uuidString
        setTerminalSnapshot(DJLTerminalSnapshot(
            terminalId: terminalId,
            instanceId: instanceId,
            status: .starting,
            buffer: "",
            bufferData: Data(),
            cwd: cwd ?? "",
            cols: cols,
            rows: rows,
            errorMessage: nil,
            resizeSupported: true
        ), for: terminalId)

        var params: [String: JSONValue] = [
            "threadId": .string(threadId),
            "terminalId": .string(binding.terminalId),
            "cols": .integer(cols),
            "rows": .integer(rows),
        ]
        if let cwd, !cwd.isEmpty {
            params["cwd"] = .string(cwd)
        }

        do {
            let response = try await sendRequest(method: "djl/terminal/open", params: .object(params))
            guard isCurrentTerminalInstance(instanceId, terminalId: terminalId) else { return }
            guard let snapshotObject = response.result?.objectValue?["snapshot"]?.objectValue else {
                throw CodexServiceError.invalidResponse("The desktop did not return a terminal snapshot.")
            }
            applyDesktopTerminalSnapshot(snapshotObject, phoneTerminalId: terminalId, instanceId: instanceId)
        } catch {
            if isCurrentTerminalInstance(instanceId, terminalId: terminalId) {
                let message = desktopTerminalErrorText(error)
                updateTerminalSnapshot(for: terminalId) { snapshot in
                    snapshot.status = .error
                    snapshot.errorMessage = message
                }
            }
            throw error
        }
    }

    func writeDesktopTerminalInput(_ data: Data, terminalId: String) async throws {
        guard let binding = desktopTerminalBindings[terminalId], !data.isEmpty else { return }
        _ = try await sendRequest(
            method: "djl/terminal/write",
            params: .object([
                "threadId": .string(binding.threadId),
                "terminalId": .string(binding.terminalId),
                "data": .string(String(decoding: data, as: UTF8.self)),
            ])
        )
    }

    func resizeDesktopTerminal(terminalId: String, cols: Int, rows: Int) async throws {
        guard let binding = desktopTerminalBindings[terminalId] else { return }
        _ = try await sendRequest(
            method: "djl/terminal/resize",
            params: .object([
                "threadId": .string(binding.threadId),
                "terminalId": .string(binding.terminalId),
                "cols": .integer(cols),
                "rows": .integer(rows),
            ])
        )
    }

    // Detaches only: the desktop keeps its shell running.
    func closeDesktopTerminal(terminalId: String) async {
        guard let binding = desktopTerminalBindings.removeValue(forKey: terminalId) else { return }
        desktopTerminalsAwaitingReattach.remove(terminalId)
        desktopTerminalPendingAckBytes.removeValue(forKey: terminalId)
        updateTerminalSnapshot(for: terminalId) { snapshot in
            snapshot.status = .closed
            snapshot.errorMessage = nil
        }
        _ = try? await sendRequest(
            method: "djl/terminal/close",
            params: .object([
                "threadId": .string(binding.threadId),
                "terminalId": .string(binding.terminalId),
            ])
        )
    }

    func listDesktopTerminalIds(threadId: String) async throws -> [String] {
        let response = try await sendRequest(
            method: "djl/terminal/list",
            params: .object(["threadId": .string(threadId)])
        )
        let ids = response.result?.objectValue?["terminals"]?.arrayValue ?? []
        return ids.compactMap { $0.stringValue }
            .map(DesktopTerminalBinding.phoneTerminalId(forDesktopTerminalId:))
    }

    // Terminal events arrive for every desktop session the phone attached to.
    func handleDesktopTerminalEvent(_ params: IncomingParamsObject?) {
        guard let params,
              let threadId = params["threadId"]?.stringValue,
              let desktopTerminalId = params["terminalId"]?.stringValue,
              let type = params["type"]?.stringValue,
              let phoneTerminalId = phoneTerminalId(threadId: threadId, desktopTerminalId: desktopTerminalId) else {
            return
        }

        switch type {
        case "output":
            guard let text = params["data"]?.stringValue, !text.isEmpty else { return }
            let data = Data(text.utf8)
            let bytes = params["byteLength"]?.intValue ?? data.count
            updateTerminalSnapshot(for: phoneTerminalId) { snapshot in
                snapshot.appendOutput(data)
                if snapshot.status == .starting {
                    snapshot.status = .running
                }
            }
            queueDesktopTerminalAck(terminalId: phoneTerminalId, bytes: bytes)
        case "started", "restarted":
            guard let snapshotObject = params["snapshot"]?.objectValue else { return }
            applyDesktopTerminalSnapshot(
                snapshotObject,
                phoneTerminalId: phoneTerminalId,
                instanceId: UUID().uuidString
            )
        case "exited":
            updateTerminalSnapshot(for: phoneTerminalId) { snapshot in
                snapshot.status = .exited
                snapshot.errorMessage = nil
            }
        case "error":
            let message = params["message"]?.stringValue ?? "Terminal error"
            updateTerminalSnapshot(for: phoneTerminalId) { snapshot in
                snapshot.status = .error
                snapshot.errorMessage = message
            }
        case "cleared":
            updateTerminalSnapshot(for: phoneTerminalId) { snapshot in
                snapshot.buffer = ""
                snapshot.bufferData = Data()
            }
        default:
            break
        }
    }

    // Host presence: the desktop shells are unreachable, so show it and remember
    // which terminals to re-attach when the device comes back.
    func markDesktopTerminalsOffline() {
        desktopTerminalAckFlushTask?.cancel()
        desktopTerminalAckFlushTask = nil
        desktopTerminalPendingAckBytes.removeAll()
        for terminalId in desktopTerminalBindings.keys {
            let status = terminalSnapshot(for: terminalId).status
            guard status == .running || status == .starting else { continue }
            desktopTerminalsAwaitingReattach.insert(terminalId)
            updateTerminalSnapshot(for: terminalId) { snapshot in
                snapshot.status = .error
                snapshot.errorMessage = Self.desktopTerminalOfflineMessage
            }
        }
    }

    func reattachDesktopTerminalsIfNeeded() {
        guard isConnected, !desktopTerminalsAwaitingReattach.isEmpty else { return }
        let terminalIds = desktopTerminalsAwaitingReattach
        desktopTerminalsAwaitingReattach.removeAll()
        for terminalId in terminalIds {
            guard let binding = desktopTerminalBindings[terminalId] else { continue }
            let snapshot = terminalSnapshot(for: terminalId)
            Task { @MainActor [weak self] in
                try? await self?.openDesktopTerminal(
                    terminalId: terminalId,
                    threadId: binding.threadId,
                    cwd: snapshot.cwd.isEmpty ? nil : snapshot.cwd,
                    cols: snapshot.cols,
                    rows: snapshot.rows
                )
            }
        }
    }

    // MARK: - Helpers

    func applyDesktopTerminalSnapshot(
        _ object: [String: JSONValue],
        phoneTerminalId: String,
        instanceId: String
    ) {
        let current = terminalSnapshot(for: phoneTerminalId)
        let preamble = object["replayPreamble"]?.stringValue ?? ""
        let history = object["history"]?.stringValue ?? ""
        var snapshot = DJLTerminalSnapshot(
            terminalId: phoneTerminalId,
            instanceId: instanceId,
            status: Self.desktopTerminalStatus(object["status"]?.stringValue),
            buffer: "",
            bufferData: Data(),
            cwd: object["cwd"]?.stringValue ?? current.cwd,
            cols: current.cols,
            rows: current.rows,
            errorMessage: nil,
            resizeSupported: true
        )
        snapshot.appendOutput(Data((preamble + history).utf8))
        desktopTerminalPendingAckBytes.removeValue(forKey: phoneTerminalId)
        setTerminalSnapshot(snapshot, for: phoneTerminalId)
    }

    private static func desktopTerminalStatus(_ rawValue: String?) -> DJLTerminalStatus {
        switch rawValue {
        case "starting":
            return .starting
        case "exited":
            return .exited
        case "error":
            return .error
        default:
            return .running
        }
    }

    private func phoneTerminalId(threadId: String, desktopTerminalId: String) -> String? {
        desktopTerminalBindings.first { _, binding in
            binding.threadId == threadId && binding.terminalId == desktopTerminalId
        }?.key
    }

    // ACKs keep the desktop's output backpressure honest without a round trip
    // per chunk: flush on volume or shortly after the first unflushed byte.
    private func queueDesktopTerminalAck(terminalId: String, bytes: Int) {
        guard bytes > 0 else { return }
        desktopTerminalPendingAckBytes[terminalId, default: 0] += bytes
        if desktopTerminalPendingAckBytes.values.reduce(0, +) >= Self.desktopTerminalAckFlushBytes {
            flushDesktopTerminalAcks()
            return
        }
        guard desktopTerminalAckFlushTask == nil else { return }
        desktopTerminalAckFlushTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: Self.desktopTerminalAckFlushNanoseconds)
            guard !Task.isCancelled else { return }
            self?.desktopTerminalAckFlushTask = nil
            self?.flushDesktopTerminalAcks()
        }
    }

    func flushDesktopTerminalAcks() {
        desktopTerminalAckFlushTask?.cancel()
        desktopTerminalAckFlushTask = nil
        let pending = desktopTerminalPendingAckBytes
        desktopTerminalPendingAckBytes.removeAll()
        for (terminalId, bytes) in pending where bytes > 0 {
            guard let binding = desktopTerminalBindings[terminalId] else { continue }
            Task { @MainActor [weak self] in
                _ = try? await self?.sendRequest(
                    method: "djl/terminal/ack",
                    params: .object([
                        "threadId": .string(binding.threadId),
                        "terminalId": .string(binding.terminalId),
                        "bytes": .integer(bytes),
                    ])
                )
            }
        }
    }

    private func desktopTerminalErrorText(_ error: Error) -> String {
        if case CodexServiceError.rpcError(let rpcError) = error {
            return rpcError.message
        }
        if case CodexServiceError.disconnected = error {
            return Self.desktopTerminalOfflineMessage
        }
        return (error as? LocalizedError)?.errorDescription ?? String(describing: error)
    }
}
