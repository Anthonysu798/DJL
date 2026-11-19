import 'dart:async';
import 'dart:convert';
import '../../../core/security/credential_store.dart';

class CloudComposerDraftStore {
  CloudComposerDraftStore(this._credentials);
  final CredentialStore _credentials;
  static const _key = 'cloud.composer.drafts.v1';
  Map<String, Map<String, String>> _drafts = {};
  Future<void> _tail = Future<void>.value();
  bool _loaded = false, _dirty = false;
  int _generation = 0;
  int get generation => _generation;
  bool get dirty => _dirty;

  Future<T> _serialized<T>(Future<T> Function() action) {
    final result = _tail.then((_) => action());
    _tail = result.then<void>((_) {}, onError: (Object _, StackTrace _) {});
    return result;
  }

  Future<void> _load() async {
    if (_loaded) return;
    final generation = _generation;
    final raw = await _credentials.read(_key);
    if (generation != _generation) return;
    final next = <String, Map<String, String>>{};
    if (raw != null) {
      try {
        final value = jsonDecode(raw);
        if (value is! Map<String, dynamic>) throw const FormatException();
        for (final entry in value.entries) {
          if (entry.value is! Map<String, dynamic>) {
            throw const FormatException();
          }
          final drafts = entry.value as Map<String, dynamic>;
          if (drafts.values.any((text) => text is! String)) {
            throw const FormatException();
          }
          next[entry.key] = drafts.cast<String, String>();
        }
      } catch (_) {
        throw const FormatException('Saved Cloud drafts could not be read.');
      }
    }
    _drafts = next;
    _loaded = true;
  }

  Future<String> read(String account, String conversation) =>
      _serialized(() async {
        await _load();
        return _drafts[account]?[conversation] ?? '';
      });

  bool _put(String account, String conversation, String text) {
    if ((_drafts[account]?[conversation] ?? '') == text) return false;
    if (text.isEmpty) {
      final drafts = _drafts[account];
      drafts?.remove(conversation);
      if (drafts?.isEmpty == true) _drafts.remove(account);
    } else {
      (_drafts[account] ??= {})[conversation] = text;
    }
    return true;
  }

  Future<bool> _persist(int generation) async {
    if (generation != _generation) return false;
    await _credentials.write(
      _key,
      _drafts.isEmpty ? null : jsonEncode(_drafts),
    );
    if (generation != _generation) return false;
    _dirty = false;
    return true;
  }

  Future<bool> _change(int generation, bool Function() edit) =>
      _serialized(() async {
        if (generation != _generation) return false;
        await _load();
        if (generation != _generation) return false;
        final changed = edit();
        if (!changed && !_dirty) return true;
        _dirty = true;
        return _persist(generation);
      });

  Future<bool> save(
    String account,
    String conversation,
    String text, {
    required int generation,
  }) => _change(generation, () => _put(account, conversation, text));

  Future<bool> move(
    String account,
    String from,
    String to, {
    required int generation,
  }) => _change(generation, () {
    final text = _drafts[account]?[from] ?? '';
    if (text.isEmpty || from == to) return false;
    final removed = _put(account, from, '');
    final saved = _put(account, to, text);
    return removed || saved;
  });

  Future<bool> flush({required int generation}) => _serialized(() async {
    if (generation != _generation) return false;
    await _load();
    return _persist(generation);
  });

  Future<void> clearAll() {
    final generation = ++_generation;
    _drafts = {};
    _loaded = true;
    _dirty = true;
    return _serialized(() async {
      await _persist(generation);
    });
  }
}
