import 'remote_transport.dart';
import '../../pairing/data/pairing_repository.dart';
import '../../../l10n/l10n.dart';

/// Composer discovery is read-only and bound to the Mac that opened the picker.
class DesktopComposerRepository {
  DesktopComposerRepository(this.transport, {this.cwd})
    : _mac = transport.macDeviceId;
  final RemoteTransport transport;
  final String? cwd, _mac;
  String? get _cwd => cwd?.trim().isNotEmpty == true ? cwd!.trim() : null;
  Future<RemoteJson> _call(String method, RemoteJson params) async {
    if (transport.macDeviceId != _mac) {
      throw StateError(appStrings.desktopContextPickerStale);
    }
    final result = await transport.request(method, params);
    if (transport.macDeviceId != _mac) {
      throw StateError(appStrings.desktopContextPickerStale);
    }
    return result;
  }

  List<RemoteJson> _skills(RemoteJson value) {
    final data = value['data'], direct = value['skills'];
    if (data is! List && direct is! List) {
      throw FormatException(appStrings.desktopNoSkillList);
    }
    final collected = <RemoteJson>[];
    if (data is List) {
      for (final raw in data.whereType<Map>()) {
        if (raw['skills'] is List) {
          collected.addAll(
            (raw['skills'] as List).whereType<Map>().map(
              (v) => Map<String, dynamic>.from(v),
            ),
          );
        } else if (raw['name'] is String) {
          collected.add(Map<String, dynamic>.from(raw));
        }
      }
    }
    if (collected.isEmpty && direct is List) {
      collected.addAll(
        direct.whereType<Map>().map((v) => Map<String, dynamic>.from(v)),
      );
    }
    return collected;
  }

  Future<List<RemoteJson>> skills({bool forceReload = false}) async {
    final params = <String, dynamic>{
      if (_cwd != null) 'cwds': [_cwd],
      if (forceReload) 'forceReload': true,
    };
    RemoteJson result;
    try {
      result = await _call('skills/list', params);
    } on RemoteRpcException catch (e) {
      if (_cwd == null ||
          !{-32600, -32602}.contains(e.code) ||
          !RegExp(
            'invalid|unknown field|unrecognized field|missing field|expected|cwds',
            caseSensitive: false,
          ).hasMatch(e.message)) {
        rethrow;
      }
      result = await _call('skills/list', {
        'cwd': _cwd,
        if (forceReload) 'forceReload': true,
      });
    }
    final collected = _skills(result);
    if (_cwd != null) {
      try {
        collected.addAll(
          _skills(
            await _call('skills/list', {if (forceReload) 'forceReload': true}),
          ),
        );
      } catch (_) {
        // The scoped list remains usable if optional global discovery is unavailable.
        if (transport.macDeviceId != _mac) rethrow;
      }
    }
    final byName = <String, RemoteJson>{};
    for (final skill in collected) {
      final name = (skill['name'] as String? ?? '').trim();
      if (name.isEmpty) continue;
      final key = name.toLowerCase(), previous = byName[key];
      if (previous == null ||
          (previous['enabled'] == false && skill['enabled'] != false)) {
        byName[key] = {
          ...skill,
          'name': name,
          'enabled': skill['enabled'] != false,
        };
      }
    }
    return byName.values.toList()..sort(
      (a, b) => (a['name'] as String).toLowerCase().compareTo(
        (b['name'] as String).toLowerCase(),
      ),
    );
  }

  Future<List<RemoteJson>> plugins({bool forceReload = false}) async {
    final result = await _call('plugin/list', {
      if (_cwd != null) 'cwds': [_cwd],
      if (forceReload) 'forceReload': true,
    });
    if (result['marketplaces'] is! List) {
      throw FormatException(appStrings.desktopNoPluginList);
    }
    final byPath = <String, RemoteJson>{};
    for (final market in (result['marketplaces'] as List).whereType<Map>()) {
      final marketplace = (market['name'] as String? ?? '').trim();
      if (marketplace.isEmpty) continue;
      for (final item in (market['plugins'] as List? ?? []).whereType<Map>()) {
        final name = (item['name'] as String? ?? '').trim();
        if (name.isEmpty ||
            !(item['installed'] == true ||
                item['enabled'] == true ||
                item['installPolicy'] == 'INSTALLED_BY_DEFAULT')) {
          continue;
        }
        final path = 'plugin://$name@$marketplace',
            details = item['interface'] as Map? ?? {};
        byPath.putIfAbsent(
          path,
          () => {
            ...Map<String, dynamic>.from(item),
            'name': name,
            'path': path,
            'marketplaceName': marketplace,
            'displayName': details['displayName'] ?? name,
            'description': details['shortDescription'],
          },
        );
      }
    }
    return byPath.values.toList()..sort(
      (a, b) => (a['name'] as String).toLowerCase().compareTo(
        (b['name'] as String).toLowerCase(),
      ),
    );
  }

  Future<List<RemoteJson>> files(
    String query, {
    String? cancellationToken,
  }) async {
    final text = query.trim(), root = _cwd;
    if (text.isEmpty || root == null) return [];
    final result = await _call('fuzzyFileSearch', {
      'query': text,
      'roots': [root],
      'cancellationToken': cancellationToken?.trim().isNotEmpty == true
          ? cancellationToken!.trim()
          : null,
    });
    if (result['files'] is! List) {
      throw FormatException(appStrings.desktopNoFileMatches);
    }
    return (result['files'] as List).whereType<Map>().map((item) {
      final directory = (item['root'] as String? ?? root).trim().replaceFirst(
            RegExp(r'/+$'),
            '',
          ),
          path = (item['path'] as String).trim();
      final prefix = '$directory/';
      return <String, dynamic>{
        ...Map<String, dynamic>.from(item),
        'path': path.startsWith(prefix) ? path.substring(prefix.length) : path,
      };
    }).toList();
  }
}
