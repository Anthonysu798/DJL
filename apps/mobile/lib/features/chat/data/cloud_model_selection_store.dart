import 'package:flutter/foundation.dart';
import '../../../core/security/credential_store.dart';

class CloudModelSelectionStore extends ChangeNotifier {
  CloudModelSelectionStore(this._credentials);
  final CredentialStore _credentials;
  static const _key = 'djl.cloud.selectedModelID';
  Future<void> _tail = Future<void>.value();
  String? _value;
  bool _loaded = false, _dirty = false, _disposed = false;
  int _generation = 0;
  int get generation => _generation;
  bool get dirty => _dirty;
  String? get value => _value;

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<T> _serialized<T>(Future<T> Function() action) {
    final result = _tail.then((_) => action());
    _tail = result.then<void>((_) {}, onError: (Object _, StackTrace _) {});
    return result;
  }

  Future<void> _load() async {
    if (_loaded) return;
    final generation = _generation;
    final value = await _credentials.read(_key);
    if (generation != _generation) return;
    _value = value;
    _loaded = true;
    _notify();
  }

  Future<String?> read() => _serialized(() async {
    await _load();
    return _value;
  });
  Future<bool> _persist(int generation) async {
    if (generation != _generation) return false;
    await _credentials.write(_key, _value);
    if (generation != _generation) return false;
    _dirty = false;
    _notify();
    return true;
  }

  Future<bool> save(String? value, {required int generation}) =>
      _serialized(() async {
        if (generation != _generation) return false;
        await _load();
        if (generation != _generation) return false;
        if (_value == value && !_dirty) return true;
        _value = value;
        _dirty = true;
        _notify();
        return _persist(generation);
      });
  Future<void> clear() {
    final generation = ++_generation;
    _value = null;
    _loaded = true;
    _dirty = true;
    _notify();
    return _serialized(() async {
      await _persist(generation);
    });
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
