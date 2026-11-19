import 'dart:async';
import 'package:flutter/foundation.dart';
import '../../chat/domain/cloud_models.dart';
import '../data/notification_repository.dart';
import '../domain/cloud_notification.dart';

class NotificationController extends ChangeNotifier {
  NotificationController(this.repository)
    : _revision = repository.client.revision;
  final NotificationRepository repository;
  final int _revision;
  List<CloudNotification> items = [];
  String? cursor, error;
  int unreadCount = 0;
  bool loading = false, _disposed = false;
  CloudNotification? banner;
  Timer? _poll, _dismiss;
  final _seen = <String>{};
  bool _foreground = false,
      _alerts = true,
      _initialLoad = true,
      _loadedOlder = false;
  String? _activeConversation;
  int _generation = 0;
  bool get _current => !_disposed && repository.client.revision == _revision;
  bool _valid(int generation) => _current && generation == _generation;
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void configure({
    required bool foreground,
    required bool alerts,
    String? activeConversation,
  }) {
    if (_disposed) return;
    _alerts = alerts;
    _activeConversation = activeConversation;
    if (!alerts || banner?.conversationId == activeConversation) {
      dismissBanner();
    }
    foreground = foreground && _current;
    if (_foreground == foreground) return;
    _foreground = foreground;
    _poll?.cancel();
    _poll = null;
    if (!foreground) {
      _generation++;
      loading = false;
      dismissBanner();
      return;
    }
    unawaited(refresh());
    _poll = Timer.periodic(const Duration(seconds: 15), (_) {
      if (_current) {
        unawaited(refresh());
      } else {
        configure(foreground: false, alerts: _alerts);
      }
    });
  }

  void dismissBanner() {
    _dismiss?.cancel();
    _dismiss = null;
    if (banner == null) return;
    banner = null;
    _notify();
  }

  Future<void> refresh({bool more = false}) async {
    if (!_current || loading || (more && cursor == null)) return;
    final generation = _generation;
    loading = true;
    error = null;
    _notify();
    try {
      final response = await repository.page(cursor: more ? cursor : null);
      if (!_valid(generation)) return;
      final next = (response['notifications'] as List)
          .map((j) => CloudNotification.fromJson(j as Json))
          .toList();
      final fresh = next
          .where((item) => item.unread && !_seen.contains(item.id))
          .toList();
      items = more
          ? [
              ...items,
              ...next.where((n) => !items.any((old) => old.id == n.id)),
            ]
          : [
              ...next,
              if (_loadedOlder)
                ...items.where((old) => !next.any((item) => item.id == old.id)),
            ];
      if (more || !_loadedOlder) cursor = response['nextCursor'] as String?;
      if (more) _loadedOlder = true;
      unreadCount = response['unreadCount'] as int;
      if (!more) {
        if (!_initialLoad && _foreground && _alerts) {
          final item = fresh
              .where((item) => item.conversationId != _activeConversation)
              .firstOrNull;
          if (item != null) {
            _dismiss?.cancel();
            banner = item;
            _dismiss = Timer(const Duration(seconds: 6), dismissBanner);
          }
        }
        _initialLoad = false;
      }
      _seen.addAll(next.map((item) => item.id));
      if (_foreground) {
        final displayed = fresh.where(
          (item) => item.conversationId == _activeConversation,
        );
        await _markIds(displayed.map((item) => item.id).take(30).toList());
      }
    } catch (e) {
      if (_valid(generation)) error = e.toString();
    } finally {
      if (_valid(generation)) {
        loading = false;
        _notify();
      }
    }
  }

  Future<void> markRead(CloudNotification? item) async {
    final ids = item == null
        ? items.where((n) => n.unread).map((n) => n.id).toList()
        : [item.id];
    await _markIds(ids.take(30).toList());
  }

  Future<void> _markIds(List<String> ids) async {
    if (ids.isEmpty || !_current) return;
    final generation = _generation;
    try {
      final count = await repository.markRead(ids);
      if (!_valid(generation)) return;
      unreadCount = count;
      items = items.map((n) => ids.contains(n.id) ? n.read() : n).toList();
    } catch (e) {
      if (_valid(generation)) error = e.toString();
    }
    _notify();
  }

  @override
  void dispose() {
    _disposed = true;
    _poll?.cancel();
    _dismiss?.cancel();
    super.dispose();
  }
}
