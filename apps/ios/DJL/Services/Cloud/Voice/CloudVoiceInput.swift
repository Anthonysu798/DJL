import Foundation
import Observation

@MainActor protocol CloudVoiceDriver: AnyObject {
    func prepare(locale: Locale) async throws
    func start() throws
    func stop() async throws -> String?
    func cancel()
}

@MainActor @Observable final class CloudVoiceInput {
    enum State: Equatable { case idle, preparing, recording, stopping, failed(String) }
    private(set) var state: State = .idle
    @ObservationIgnored private let driver: any CloudVoiceDriver
    @ObservationIgnored private var revision = 0
    @ObservationIgnored private var preparation: Task<Void, Error>?
    @ObservationIgnored private var timeLimit: Task<Void, Never>?

    init(driver: (any CloudVoiceDriver)? = nil) { self.driver = driver ?? AppleCloudVoiceDriver() }
    var isBusy: Bool { state == .preparing || state == .recording || state == .stopping }

    func start(locale: Locale) async {
        guard !isBusy else { return }
        revision += 1
        let generation = revision
        state = .preparing
        let task = Task { try await driver.prepare(locale: locale) }
        preparation = task
        do {
            try await task.value
            guard revision == generation, !Task.isCancelled else { return }
            try driver.start()
            state = .recording
            timeLimit = Task { [weak self] in
                try? await Task.sleep(for: .seconds(60))
                guard !Task.isCancelled else { return }
                self?.cancel()
            }
        } catch {
            guard revision == generation else { return }
            driver.cancel()
            state = .failed(error.localizedDescription)
        }
        if revision == generation { preparation = nil }
    }

    func stop() async -> String? {
        guard state == .recording else { return nil }
        let generation = revision
        timeLimit?.cancel(); timeLimit = nil
        state = .stopping
        do {
            let text = try await driver.stop()
            guard revision == generation else { return nil }
            state = .idle
            return text
        } catch {
            guard revision == generation else { return nil }
            driver.cancel()
            state = .failed(error.localizedDescription)
            return nil
        }
    }

    func cancel() {
        let active = isBusy
        revision += 1
        preparation?.cancel(); preparation = nil
        timeLimit?.cancel(); timeLimit = nil
        if active { driver.cancel() }
        state = .idle
    }
}
