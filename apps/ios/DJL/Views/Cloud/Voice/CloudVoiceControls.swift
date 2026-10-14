import SwiftUI

struct CloudVoiceControls: View {
    @Bindable var voice: CloudVoiceInput
    let playback: CloudSpeechPlayback
    @Binding var draft: String

    var body: some View {
        Button {
            Task {
                if voice.state == .recording {
                    if let text = await voice.stop() { draft = CloudVoicePolicy.appendingTranscript(text, to: draft) }
                } else if voice.isBusy {
                    voice.cancel()
                } else {
                    playback.stop()
                    await voice.start(locale: .current)
                }
            }
        } label: {
            Group {
                if voice.state == .preparing || voice.state == .stopping { ProgressView().controlSize(.small) }
                else { Image(systemName: voice.state == .recording ? "stop.fill" : "mic") }
            }
            .frame(width: 34, height: 34)
            .foregroundStyle(voice.isBusy ? Color.accentColor : .primary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(voice.state == .recording ? "Finish dictation" : voice.isBusy ? "Cancel dictation" : "Dictate message")
        .accessibilityIdentifier("cloud.voice.dictate")
    }
}
