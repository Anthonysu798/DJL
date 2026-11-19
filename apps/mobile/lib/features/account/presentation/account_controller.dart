import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import '../data/account_repository.dart';
import '../domain/account_snapshot.dart';

class AccountController extends ChangeNotifier {
  AccountController(this.repository) : _revision = repository.client.revision;
  final AccountRepository repository;
  final int _revision;
  AccountSnapshot? snapshot;
  String? error, _redemptionId;
  bool loading = false, busy = false, _disposed = false;
  bool get _current => !_disposed && repository.client.revision == _revision;
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<void> refresh() async {
    loading = true;
    error = null;
    _notify();
    try {
      final result = await repository.load();
      if (_current) snapshot = result;
    } catch (e) {
      if (_current) error = e.toString();
    } finally {
      if (_current) {
        loading = false;
        _notify();
      }
    }
  }

  Future<bool> redeem() async {
    if (busy || !_current) return false;
    busy = true;
    error = null;
    _redemptionId ??= const Uuid().v4();
    _notify();
    try {
      await repository.redeem(_redemptionId!);
      if (!_current) return false;
      _redemptionId = null;
      await refresh();
      return true;
    } catch (e) {
      if (_current) error = e.toString();
      return false;
    } finally {
      if (_current) {
        busy = false;
        _notify();
      }
    }
  }

  Future<bool> delete(String confirmation) async {
    if (confirmation.trim().toUpperCase() != 'DELETE' || busy || !_current) {
      return false;
    }
    busy = true;
    error = null;
    _notify();
    try {
      await repository.delete();
      return _current;
    } catch (e) {
      if (_current) error = e.toString();
      return false;
    } finally {
      if (_current) {
        busy = false;
        _notify();
      }
    }
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
