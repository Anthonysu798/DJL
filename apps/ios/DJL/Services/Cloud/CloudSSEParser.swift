// FILE: CloudSSEParser.swift
// Purpose: Incremental text/event-stream parser that survives frames split across network chunks.
// Layer: Service
// Exports: CloudSSEFrame, CloudSSEParser
// Depends on: Foundation
//
// Follows the WHATWG event-stream rules the API needs: `event:`, `data:` (multi-line joined by \n),
// `id:`, comment lines (`:` heartbeats) ignored, LF / CRLF / CR line endings, blank line dispatches.

import Foundation

nonisolated struct CloudSSEFrame: Equatable, Sendable {
    var event: String
    var data: String
    var id: String?
}

nonisolated struct CloudSSEParser: Sendable {
    private var buffer: [UInt8] = []
    private var event = ""
    private var dataLines: [String] = []
    private var id: String?
    private var sawField = false
    private var pendingCR = false

    init() {}

    /// Feeds raw bytes and returns every frame completed by them.
    mutating func feed<Bytes: Sequence>(_ bytes: Bytes) -> [CloudSSEFrame] where Bytes.Element == UInt8 {
        var frames: [CloudSSEFrame] = []
        for byte in bytes {
            if pendingCR {
                pendingCR = false
                if byte == 0x0A { continue } // CRLF: the CR already ended the line.
            }
            switch byte {
            case 0x0A:
                if let frame = endLine() { frames.append(frame) }
            case 0x0D:
                pendingCR = true
                if let frame = endLine() { frames.append(frame) }
            default:
                buffer.append(byte)
            }
        }
        return frames
    }

    mutating func feed(_ text: String) -> [CloudSSEFrame] {
        feed(Array(text.utf8))
    }

    private mutating func endLine() -> CloudSSEFrame? {
        let line = String(decoding: buffer, as: UTF8.self)
        buffer.removeAll(keepingCapacity: true)

        if line.isEmpty {
            defer { resetFrame() }
            guard sawField, !dataLines.isEmpty else { return nil }
            return CloudSSEFrame(
                event: event.isEmpty ? "message" : event,
                data: dataLines.joined(separator: "\n"),
                id: id
            )
        }
        if line.hasPrefix(":") { return nil } // Heartbeat / comment.

        let field: Substring
        var value: Substring
        if let colon = line.firstIndex(of: ":") {
            field = line[..<colon]
            value = line[line.index(after: colon)...]
            if value.hasPrefix(" ") { value = value.dropFirst() }
        } else {
            field = Substring(line)
            value = ""
        }

        sawField = true
        switch field {
        case "event": event = String(value)
        case "data": dataLines.append(String(value))
        case "id": id = String(value)
        default: break
        }
        return nil
    }

    private mutating func resetFrame() {
        event = ""
        dataLines = []
        id = nil
        sawField = false
    }
}
