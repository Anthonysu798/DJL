part of 'desktop_controller.dart';

/// Activity and Guardian review rows.
extension DesktopActivityRows on DesktopController {
  void _bindActivityDevice(String device) {
    if (activity.mac != device) {
      activity.bind(device);
      _hydratedActivityCache = null;
    }
    final data = threadList.data;
    if (threadList.macDeviceId != device ||
        active?.macDeviceId != device ||
        identical(_hydratedActivityCache, data)) {
      return;
    }
    // Hydrate once per loaded device cache, before live updates can replace rich rows.
    for (final entry in data.timelines.entries) {
      if (data.deleted.contains(entry.key)) continue;
      for (final row in entry.value) {
        final saved = DesktopActivity.fromRow(row);
        if (saved == null ||
            saved.thread != entry.key ||
            saved.mac.isNotEmpty && saved.mac != device) {
          continue;
        }
        activity.restore(row, thread: entry.key, turn: saved.turn);
      }
    }
    _hydratedActivityCache = data;
  }

  Set<String> get _knownActivityThreads => threadList.data.snapshots
      .map((row) => activityString(row['id']))
      .whereType<String>()
      .toSet();

  void _syncActivityRows() {
    if (activity.mac != active?.macDeviceId ||
        threadList.macDeviceId != null &&
            activity.mac != threadList.macDeviceId) {
      return;
    }
    for (final a in activity.items.values) {
      if (threadList.data.deleted.contains(a.thread)) continue;
      final rows = thread?['id'] == a.thread
          ? timeline
          : threadList.data.timelines.putIfAbsent(a.thread, () => []);
      final row = a.toRow();
      final index = rows.indexWhere(
        (old) =>
            old['id'] == row['id'] ||
            activityKind(old) != null &&
                old['id'] == a.item &&
                old['turnId'] == a.turn,
      );
      if (index < 0) {
        rows.add(row);
      } else {
        rows[index] = row;
      }
      threadList.data.timelines[a.thread] = List.of(rows);
    }
    threadList.scheduleSave();
  }

  bool _bindGuardianConnection() {
    final mac = transport.macDeviceId, session = transport.sessionId;
    final valid =
        connected &&
        mac != null &&
        mac.isNotEmpty &&
        session != null &&
        session.isNotEmpty &&
        active?.macDeviceId == mac;
    guardian.bind(valid ? mac : null, valid ? session : null);
    return valid;
  }

  void _syncGuardianRows() {
    final device = guardian.deviceId;
    if (device != null &&
        (active?.macDeviceId != device ||
            threadList.macDeviceId != null &&
                threadList.macDeviceId != device)) {
      return;
    }
    for (final entry in guardian.reviews.entries) {
      final id = entry.key.$1;
      if (threadList.data.deleted.contains(id)) continue;
      final rows = thread?['id'] == id
          ? timeline
          : threadList.data.timelines.putIfAbsent(id, () => []);
      final row = entry.value.toRow(id);
      final index = rows.indexWhere((item) => item['id'] == row['id']);
      if (index < 0) {
        rows.add(row);
      } else {
        rows[index] = row;
      }
      threadList.data.timelines[id] = List.of(rows);
    }
    threadList.scheduleSave();
  }

  void _clearGuardianAuthority() {
    guardian.bind(null, null);
    _syncGuardianRows();
  }

  Future<bool> approveGuardianRetry(String threadId, String reviewId) async {
    if (!_bindGuardianConnection()) {
      _syncGuardianRows();
      _notify();
      return false;
    }
    final mac = transport.macDeviceId!, session = transport.sessionId!;
    final generation = _connectGeneration,
        epoch = guardian.epoch,
        data = threadList.data;
    final event = guardian.consume(threadId, reviewId, mac, session);
    _syncGuardianRows();
    _notify();
    if (event == null) return false;
    bool current() =>
        !_disposed &&
        generation == _connectGeneration &&
        guardian.epoch == epoch &&
        connected &&
        transport.macDeviceId == mac &&
        active?.macDeviceId == mac &&
        transport.sessionId == session &&
        identical(threadList.data, data);
    try {
      final result = await transport.request(
        'thread/approveGuardianDeniedAction',
        {'threadId': threadId, 'event': event},
      );
      if (!current()) return false;
      if (result['success'] == false) {
        throw StateError(appStrings.desktopRetryApprovalUnacknowledged);
      }
      final applied = guardian.finish(
        threadId,
        reviewId,
        event: event,
        acknowledged: true,
      );
      _syncGuardianRows();
      _notify();
      return applied;
    } catch (_) {
      if (current()) {
        guardian.finish(threadId, reviewId, event: event, acknowledged: false);
        _syncGuardianRows();
        _notify();
      }
      return false;
    }
  }
}
