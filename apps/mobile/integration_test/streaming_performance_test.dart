// Frame timings while a long answer streams into the paired-Mac chat. The Mac
// is an in-process fake so the run works in profile mode, where release rules
// block local relays; it measures the phone's own work (decode, controller,
// layout, paint), not the network. Run:
// `flutter drive --profile --driver=test_driver/integration_test.dart
//   --target=integration_test/streaming_performance_test.dart -d <device>`.
// The summary is printed as DJL_STREAM_PERF and saved in
// build/integration_response_data.json.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'support/paired_voice_fixture.dart'
    show VolatileVoiceCredentials, VoicePageMemoryStore;

const _thread = 'perf-thread', _turn = 'perf-turn', _item = 'perf-answer';

/// About 1,300 words of markdown, sent two words at a time every 16 ms.
List<String> _deltas() {
  const paragraph =
      'The phone keeps up with a long answer while it streams. **Bold words**, '
      '`inline code` and [a link](https://example.com) all render as they arrive.';
  final blocks = [
    for (var n = 0; n < 48; n++)
      n % 6 == 0
          ? '## Section ${n ~/ 6 + 1}'
          : n % 6 == 3
          ? '- first point $n\n- second point $n\n- third point $n'
          : paragraph,
  ];
  final words = blocks.join('\n\n').split(' ');
  return [
    for (var i = 0; i < words.length; i += 2)
      '${i == 0 ? '' : ' '}${words.skip(i).take(2).join(' ')}',
  ];
}

class _StreamingMac extends RemoteTransport {
  _StreamingMac(super.pairings);
  final events = StreamController<RemoteJson>.broadcast();
  final done = Completer<void>();
  @override
  bool get connected => true;
  @override
  String? get macDeviceId => 'perf-mac';
  @override
  Stream<RemoteJson> get messages => events.stream;
  @override
  Future<void> send(RemoteJson message) async {}

  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'turn/start') {
      unawaited(_stream());
      return {
        'turn': {'id': _turn, 'status': 'inProgress', 'items': []},
      };
    }
    if (method == 'thread/read' || method == 'thread/resume') {
      return {
        'thread': {'id': _thread, 'cwd': '/perf', 'turns': []},
      };
    }
    return {'data': []};
  }

  void _emit(String method, RemoteJson params) => events.add({
    'method': method,
    'params': {'threadId': _thread, 'turnId': _turn, ...params},
  });

  Future<void> _stream() async {
    await Future<void>.delayed(const Duration(milliseconds: 100));
    _emit('turn/started', {
      'turn': {'id': _turn, 'status': 'inProgress', 'items': []},
    });
    _emit('item/started', {
      'item': {'id': _item, 'type': 'agentMessage', 'text': ''},
    });
    final text = StringBuffer();
    for (final delta in _deltas()) {
      text.write(delta);
      _emit('item/agentMessage/delta', {'itemId': _item, 'delta': delta});
      await Future<void>.delayed(const Duration(milliseconds: 16));
    }
    _emit('item/completed', {
      'item': {'id': _item, 'type': 'agentMessage', 'text': text.toString()},
    });
    _emit('turn/completed', {
      'turn': {'id': _turn, 'status': 'completed', 'items': []},
    });
    done.complete();
  }

  @override
  Future<void> dispose() async => events.close();
}

Map<String, Object> _summary(List<FrameTiming> frames) {
  double ms(Duration value) => value.inMicroseconds / 1000;
  List<double> sorted(Iterable<double> values) => values.toList()..sort();
  double at(List<double> values, double p) => values.isEmpty
      ? 0
      : values[((values.length - 1) * p).round().clamp(0, values.length - 1)];
  final build = sorted(frames.map((f) => ms(f.buildDuration)));
  final raster = sorted(frames.map((f) => ms(f.rasterDuration)));
  final budget = 1000 / PlatformDispatcher.instance.displays.first.refreshRate;
  double round(double v) => (v * 100).round() / 100;
  return {
    'frames': frames.length,
    'frame_budget_ms': round(budget),
    'build_p50_ms': round(at(build, .5)),
    'build_p90_ms': round(at(build, .9)),
    'build_p99_ms': round(at(build, .99)),
    'build_max_ms': round(build.isEmpty ? 0 : build.last),
    'raster_p50_ms': round(at(raster, .5)),
    'raster_p90_ms': round(at(raster, .9)),
    'raster_p99_ms': round(at(raster, .99)),
    'frames_over_budget': frames
        .where(
          (f) => ms(f.buildDuration) > budget || ms(f.rasterDuration) > budget,
        )
        .length,
  };
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('streaming a long answer: frame timings', (tester) async {
    final pairs = PairingRepository(VolatileVoiceCredentials());
    final mac = _StreamingMac(pairs);
    const pair = Pairing({
      'macDeviceId': 'perf-mac',
      'macIdentityPublicKey': 'perf-public-pin',
    });
    final desktop =
        DesktopController(
            pairs,
            connection: mac,
            localStore: VoicePageMemoryStore(VolatileVoiceCredentials()),
          )
          ..active = pair
          ..trusted = [pair]
          ..state = 'connected'
          ..model = 'perf'
          ..models = [
            {
              'id': 'perf',
              'model': 'perf',
              'displayName': 'Perf model',
              'djlProvider': 'codex',
            },
          ];
    await desktop.threadList.attach('perf-mac');
    desktop.thread = {'id': _thread, 'cwd': '/perf', 'turns': []};
    await tester.pumpWidget(
      MaterialApp(
        theme: djlTheme(Brightness.light),
        home: DesktopChatPage(controller: desktop),
      ),
    );
    await tester.pumpAndSettle();

    final frames = <FrameTiming>[];
    void collect(List<FrameTiming> timings) => frames.addAll(timings);
    binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;
    SchedulerBinding.instance.addTimingsCallback(collect);
    final started = DateTime.now();
    unawaited(desktop.send('Write a long answer'));
    await mac.done.future.timeout(const Duration(minutes: 2));
    final elapsed = DateTime.now().difference(started);
    await Future<void>.delayed(const Duration(seconds: 1));
    SchedulerBinding.instance.removeTimingsCallback(collect);
    binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fadePointers;
    await tester.pumpAndSettle();

    final answer = desktop.timeline.lastWhere(
      (row) => row['text']?.toString().contains('Section 8') == true,
      orElse: () => const {},
    );
    expect(answer, isNotEmpty, reason: 'The streamed answer must land.');
    final summary = {
      ..._summary(frames),
      'stream_seconds': elapsed.inMilliseconds / 1000,
      'deltas': _deltas().length,
      'platform': Platform.operatingSystem,
    };
    debugPrint('DJL_STREAM_PERF ${jsonEncode(summary)}');
    binding.reportData = {...?binding.reportData, 'streaming': summary};
    expect(frames, isNotEmpty);
    await tester.pumpWidget(const SizedBox());
    desktop.dispose();
  });
}
