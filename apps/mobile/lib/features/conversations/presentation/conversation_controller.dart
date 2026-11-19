import 'package:flutter/foundation.dart';
import '../../chat/data/cloud_repository.dart';
import '../../chat/domain/cloud_models.dart';

class ConversationController extends ChangeNotifier {
  ConversationController(this.repository);
  final CloudRepository repository;
  List<Conversation> items = [];
  bool loading = false, archived = false;
  String? error, cursor;
  String query = '';
  int _generation = 0, _ownerGeneration = 0;
  bool _disposed = false;
  bool _current(int owner, int revision) =>
      !_disposed &&
      owner == _ownerGeneration &&
      revision == repository.client.revision;

  Future<void> refresh({bool more = false}) async {
    if (_disposed) return;
    final generation = ++_generation;
    final owner = _ownerGeneration, revision = repository.client.revision;
    bool current() => _current(owner, revision) && generation == _generation;
    loading = true;
    error = null;
    notifyListeners();
    try {
      final response = query.isEmpty
          ? await repository.list(
              cursor: more ? cursor : null,
              archived: archived,
            )
          : await repository.search(query);
      if (!current()) return;
      final rows = query.isEmpty
          ? response['conversations'] as List
          : (response['results'] as List)
                .map((r) => (r as Json)['conversation'])
                .toList();
      final next = rows.map((r) => Conversation.fromJson(r as Json));
      items = more
          ? [...items, ...next.where((n) => !items.any((i) => i.id == n.id))]
          : next.toList();
      cursor = response['nextCursor'] as String?;
    } catch (e) {
      if (current()) error = e.toString();
    } finally {
      if (current()) {
        loading = false;
        notifyListeners();
      }
    }
  }

  Future<void> update(Conversation item, Json patch) =>
      _mutate(() => repository.update(item.id, patch));

  Future<void> delete(Conversation item) =>
      _mutate(() => repository.delete(item.id));

  Future<void> _mutate(Future<void> Function() save) async {
    if (_disposed) return;
    final owner = _ownerGeneration, revision = repository.client.revision;
    try {
      await save();
      if (_current(owner, revision)) await refresh();
    } catch (e) {
      if (!_current(owner, revision)) return;
      error = e.toString();
      notifyListeners();
    }
  }

  void clear() {
    if (_disposed) return;
    _generation++;
    _ownerGeneration++;
    loading = false;
    items = [];
    cursor = null;
    error = null;
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    _ownerGeneration++;
    super.dispose();
  }
}
