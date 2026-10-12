@preconcurrency import AVFoundation
import Speech

@MainActor final class AppleCloudVoiceDriver: CloudVoiceDriver {
    private var engine: AVAudioEngine?
    private var fallback: SFSpeechAudioBufferRecognitionRequest?
    private var recognition: SFSpeechRecognitionTask?
    private var recognizer: SFSpeechRecognizer?
    private var transcript = ""
    private var modern: AnyObject?
    private var revision = 0

    func prepare(locale: Locale) async throws {
        revision += 1
        let generation = revision
        guard await AVAudioApplication.requestRecordPermission() else { throw CloudVoiceFailure.permissionDenied }
        try Task.checkCancellation()
        guard revision == generation else { throw CancellationError() }
        if #available(iOS 26, *), SpeechTranscriber.isAvailable,
           let supported = await SpeechTranscriber.supportedLocale(equivalentTo: locale) {
            let capture = AnalyzerVoiceCapture(locale: supported)
            modern = capture
            try await capture.prepare()
            try Task.checkCancellation()
            guard revision == generation else { throw CancellationError() }
            return
        }
        let permission = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
        try Task.checkCancellation()
        guard revision == generation else { throw CancellationError() }
        guard permission == .authorized else { throw CloudVoiceFailure.permissionDenied }
        guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable, recognizer.supportsOnDeviceRecognition else { throw CloudVoiceFailure.unavailable }
        self.recognizer = recognizer
    }

    func start() throws {
        transcript = ""
        if #available(iOS 26, *), let modern = modern as? AnalyzerVoiceCapture { try modern.start(); return }
        guard let recognizer else { throw CloudVoiceFailure.unavailable }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        fallback = request
        let generation = revision
        recognition = recognizer.recognitionTask(with: request) { [weak self] result, _ in
            let value = result?.bestTranscription.formattedString
            Task { @MainActor in
                guard let self, self.revision == generation, let value else { return }
                self.transcript = value
            }
        }
        let engine = AVAudioEngine()
        self.engine = engine
        try configureAudio()
        let input = engine.inputNode
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in request.append(buffer) }
        engine.prepare()
        try engine.start()
    }

    func stop() async throws -> String? {
        if #available(iOS 26, *), let capture = modern as? AnalyzerVoiceCapture {
            let value = try await capture.stop()
            modern = nil
            return value
        }
        let generation = revision
        engine?.stop(); engine?.inputNode.removeTap(onBus: 0); engine = nil
        fallback?.endAudio()
        try? await Task.sleep(for: .milliseconds(600))
        guard revision == generation else { return nil }
        let value = transcript
        cancel()
        return value
    }

    func cancel() {
        revision += 1
        if #available(iOS 26, *), let capture = modern as? AnalyzerVoiceCapture { capture.cancel() }
        modern = nil
        engine?.stop(); engine?.inputNode.removeTap(onBus: 0); engine = nil
        recognition?.cancel(); recognition = nil
        fallback = nil; recognizer = nil; transcript = ""
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

@MainActor private func configureAudio() throws {
    try AVAudioSession.sharedInstance().setCategory(.record, mode: .measurement, options: [.duckOthers])
    try AVAudioSession.sharedInstance().setActive(true)
}

@available(iOS 26, *) @MainActor private final class AnalyzerVoiceCapture {
    private let transcriber: SpeechTranscriber
    private let analyzer: SpeechAnalyzer
    private let engine = AVAudioEngine()
    private var input: AsyncStream<AnalyzerInput>.Continuation?
    private var results: Task<Void, Error>?
    private var text = ""
    private var format: AVAudioFormat?
    private var hasTap = false
    private var analysis: Task<Void, Error>?
    private var cancelled = false

    init(locale: Locale) {
        transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
        analyzer = SpeechAnalyzer(modules: [transcriber])
    }
    func prepare() async throws {
        do {
            if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) { try await request.downloadAndInstall() }
            try Task.checkCancellation()
            guard !cancelled else { throw CancellationError() }
            guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else { throw CloudVoiceFailure.unavailable }
            self.format = format
            try await analyzer.prepareToAnalyze(in: format)
            try Task.checkCancellation()
        } catch is CancellationError { throw CancellationError() }
        catch { throw CloudVoiceFailure.assetsUnavailable }
    }
    func start() throws {
        guard !cancelled, let format else { throw CloudVoiceFailure.unavailable }
        try configureAudio()
        let pair = AsyncStream<AnalyzerInput>.makeStream(bufferingPolicy: .bufferingNewest(8))
        input = pair.continuation
        results = Task { [weak self, transcriber] in
            for try await result in transcriber.results {
                guard let self, !self.cancelled else { return }
                self.text += String(result.text.characters)
            }
        }
        let analyzer = analyzer
        analysis = Task { try await analyzer.start(inputSequence: pair.stream) }
        let inputNode = engine.inputNode
        let source = inputNode.outputFormat(forBus: 0)
        guard let converter = AVAudioConverter(from: source, to: format) else { throw CloudVoiceFailure.unavailable }
        let sink = VoiceAudioSink(converter: converter, format: format, continuation: pair.continuation)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: source) { buffer, _ in sink.append(buffer) }
        hasTap = true
        engine.prepare(); try engine.start()
    }
    func stop() async throws -> String? {
        stopCapture()
        try await analysis?.value
        try await analyzer.finalizeAndFinishThroughEndOfInput()
        try await results?.value
        guard !cancelled else { return nil }
        let value = text
        results = nil; text = ""
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        return value
    }
    func cancel() {
        cancelled = true
        stopCapture()
        analysis?.cancel(); analysis = nil
        results?.cancel(); results = nil; text = ""
        let analyzer = analyzer
        Task { await analyzer.cancelAndFinishNow() }
    }
    private func stopCapture() {
        engine.stop()
        if hasTap { engine.inputNode.removeTap(onBus: 0); hasTap = false }
        input?.finish(); input = nil
    }
}

/// Converts within the audio callback; only independent buffers leave the engine's tap.
@available(iOS 26, *) nonisolated private final class VoiceAudioSink: @unchecked Sendable {
    private let converter: AVAudioConverter
    private let format: AVAudioFormat
    private let continuation: AsyncStream<AnalyzerInput>.Continuation
    init(converter: AVAudioConverter, format: AVAudioFormat, continuation: AsyncStream<AnalyzerInput>.Continuation) {
        self.converter = converter; self.format = format; self.continuation = continuation
    }
    func append(_ source: AVAudioPCMBuffer) {
        let capacity = AVAudioFrameCount(ceil(Double(source.frameLength) * format.sampleRate / source.format.sampleRate)) + 32
        guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return }
        var supplied = false
        var error: NSError?
        converter.convert(to: output, error: &error) { _, status in
            if supplied { status.pointee = .noDataNow; return nil }
            supplied = true; status.pointee = .haveData; return source
        }
        if error == nil, output.frameLength > 0 { continuation.yield(AnalyzerInput(buffer: output)) }
    }
}
