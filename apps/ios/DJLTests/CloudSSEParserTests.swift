import XCTest
@testable import DJL

final class CloudSSEParserTests: XCTestCase {
    func testParsesEventDataAndId() {
        var parser = CloudSSEParser()
        let frames = parser.feed("event: text.delta\nid: 4\ndata: {\"a\":1}\n\n")
        XCTAssertEqual(frames, [CloudSSEFrame(event: "text.delta", data: "{\"a\":1}", id: "4")])
    }

    func testFrameSplitAcrossChunksIsReassembled() {
        var parser = CloudSSEParser()
        XCTAssertEqual(parser.feed("event: sta"), [])
        XCTAssertEqual(parser.feed("tus\ndata: {\"sta"), [])
        XCTAssertEqual(parser.feed("tus\":\"ok\"}\n"), [])
        XCTAssertEqual(parser.feed("\n"), [CloudSSEFrame(event: "status", data: "{\"status\":\"ok\"}", id: nil)])
    }

    func testMultibyteCharacterSplitAcrossChunks() {
        var parser = CloudSSEParser()
        let bytes = Array("data: 京都\n\n".utf8)
        // Split inside the three-byte encoding of 京.
        XCTAssertEqual(parser.feed(bytes[0..<7]), [])
        XCTAssertEqual(parser.feed(bytes[7...]), [CloudSSEFrame(event: "message", data: "京都", id: nil)])
    }

    func testHeartbeatCommentsAreIgnored() {
        var parser = CloudSSEParser()
        XCTAssertEqual(parser.feed(": ping\n\n: ping\n\n"), [])
        XCTAssertEqual(parser.feed("data: x\n\n"), [CloudSSEFrame(event: "message", data: "x", id: nil)])
    }

    func testMultipleDataLinesJoinWithNewline() {
        var parser = CloudSSEParser()
        XCTAssertEqual(parser.feed("data: a\ndata: b\n\n"), [CloudSSEFrame(event: "message", data: "a\nb", id: nil)])
    }

    func testCRLFAndCRLineEndings() {
        var parser = CloudSSEParser()
        XCTAssertEqual(parser.feed("event: e\r\ndata: 1\r"), [])
        // The CR ends the line; a following LF must not be treated as a second (blank) line.
        XCTAssertEqual(parser.feed("\n\r\n"), [CloudSSEFrame(event: "e", data: "1", id: nil)])
    }

    func testSeveralFramesInOneChunk() {
        var parser = CloudSSEParser()
        let frames = parser.feed("data: 1\n\ndata: 2\n\n")
        XCTAssertEqual(frames.map(\.data), ["1", "2"])
    }
}
