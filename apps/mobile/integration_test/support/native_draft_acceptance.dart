import 'dart:convert';
import 'package:http/http.dart' as http;

// Cumulative real gateway evidence, never a replacement for UI/owner assertions.
class NativeDraftSnapshot {
  NativeDraftSnapshot(Map value, this.cloudAttempts)
    : state = Map<String, dynamic>.from(value) {
    for (final key in counters) {
      final count = state[key];
      if (count is! int || count < 0) throw StateError('Invalid $key counter.');
    }
    if (cloudAttempts < 0 || state['requests'] is! List) {
      throw StateError('Missing Cloud or request trace evidence.');
    }
    final trace = state['requests'] as List;
    if (trace.length > 256 ||
        trace.any(
          (row) =>
              row is! Map ||
              row['sequence'] is! int ||
              row['sequence'] <= 0 ||
              row['method'] is! String,
        )) {
      throw StateError('Invalid bounded request trace.');
    }
  }
  final Map<String, dynamic> state;
  final int cloudAttempts;
  static const counters = [
    'applicationMessageCount',
    'requestSequence',
    'threadStartAttemptCount',
    'threadCount',
    'turnStartCount',
    'turnCount',
    'threadResumeCount',
  ];
  int count(String key) => state[key] as int;
  List<String> methodsSince(NativeDraftSnapshot after) {
    final start = count('requestSequence'),
        end = after.count('requestSequence');
    if (end < start) throw StateError('Request sequence decreased.');
    final trace = after.state['requests'] as List;
    if (trace.length > 256) {
      throw StateError('Request trace exceeds its bound.');
    }
    final window = trace
        .where(
          (row) =>
              row is Map && row['sequence'] is int && row['sequence'] > start,
        )
        .toList();
    if (window.length != end - start) {
      throw StateError('Request trace gap or overflow.');
    }
    return List.generate(window.length, (i) {
      final row = window[i] as Map;
      if (row['sequence'] != start + i + 1 || row['method'] is! String) {
        throw StateError('Request trace is incomplete or out of order.');
      }
      return row['method'] as String;
    });
  }

  void _delta(NativeDraftSnapshot after, Map<String, int> expected) {
    if (after.cloudAttempts != cloudAttempts) {
      throw StateError('Desktop flow attempted Cloud HTTP.');
    }
    for (final entry in expected.entries) {
      if (after.count(entry.key) - count(entry.key) != entry.value) {
        throw StateError('Unexpected ${entry.key} delta.');
      }
    }
  }

  void expectQuiet(NativeDraftSnapshot after) {
    methodsSince(after);
    _delta(after, {for (final key in counters) key: 0});
  }

  void expectPicker(NativeDraftSnapshot after) {
    final methods = methodsSince(after);
    if (methods.join(',') != 'project/quickLocations,project/listDirectory') {
      throw StateError('Picker did not use exactly the two allowed reads.');
    }
    _delta(after, {
      for (final key in counters)
        key: key == 'applicationMessageCount' || key == 'requestSequence'
            ? 2
            : 0,
    });
  }

  void expectPromotion(
    NativeDraftSnapshot after, {
    required String thread,
    required bool project,
  }) {
    final methods = methodsSince(after);
    _delta(after, {
      'threadStartAttemptCount': 1,
      'threadCount': 1,
      'turnStartCount': 1,
      'turnCount': 1,
    });
    if (thread.isEmpty ||
        methods.where((m) => m == 'thread/start').length != 1 ||
        methods.where((m) => m == 'turn/start').length != 1 ||
        (after.state['lastTurn'] as Map?)?['threadId'] != thread) {
      throw StateError('Missing matching real first-turn promotion.');
    }
    final shape = after.state['lastThreadStartShape'];
    if (shape is! Map ||
        shape['cwdPresent'] != project ||
        shape['cwdIsRoot'] != project ||
        shape['djlScope'] != (project ? 'project' : 'studio')) {
      throw StateError('Actual thread/start shape does not match the entry.');
    }
  }
}

Future<NativeDraftSnapshot> nativeDraftSnapshot(int cloudAttempts) async {
  final response = await http.get(Uri.parse('http://127.0.0.1:8852/qa/state'));
  if (response.statusCode != 200) {
    throw StateError('Gateway state unavailable.');
  }
  return NativeDraftSnapshot(jsonDecode(response.body) as Map, cloudAttempts);
}

Future<void> nativeDraftStartBarrier(String action) async {
  if (!{'arm', 'release'}.contains(action)) throw ArgumentError.value(action);
  final response = await http.post(
    Uri.parse('http://127.0.0.1:8852/qa/thread-start/$action'),
  );
  if (response.statusCode != 200 ||
      (jsonDecode(response.body) as Map)['ok'] != true) {
    throw StateError('Real thread/start reply barrier refused $action.');
  }
}
