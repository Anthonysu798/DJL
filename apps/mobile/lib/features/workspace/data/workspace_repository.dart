import 'dart:convert';
import '../../desktop/data/remote_transport.dart';
import '../../pairing/data/pairing_repository.dart';
import '../domain/workspace_models.dart';
import '../domain/response_change_set.dart';
import '../../../l10n/l10n.dart';

class ProjectRepository {
  ProjectRepository(this.transport)
    : _owner = (
        transport.macDeviceId,
        transport.sessionId,
        transport.connectionRevision,
      );
  final RemoteTransport transport;
  final (String?, String?, int) _owner;
  void _checkOwner() {
    if (_owner !=
        (
          transport.macDeviceId,
          transport.sessionId,
          transport.connectionRevision,
        )) {
      throw StateError(appStrings.workspaceDesktopChangedPicker);
    }
  }

  Future<RemoteJson> _call(String method, RemoteJson params) async {
    _checkOwner();
    final result = await transport.request(method, params);
    _checkOwner();
    return result;
  }

  Future<List<ProjectLocation>> quickLocations() async =>
      ((await _call('project/quickLocations', {}))['locations'] as List)
          .map(
            (e) =>
                ProjectLocation.fromJson(Map<String, dynamic>.from(e as Map)),
          )
          .toList();
  Future<ProjectListing> listDirectory(String path) async =>
      ProjectListing.fromJson(
        await _call('project/listDirectory', {'path': path, 'limit': 200}),
      );
  Future<List<ProjectDirectory>> search(String root, String query) async =>
      ((await _call('project/searchDirectories', {
                'path': root,
                'query': query,
                'limit': 80,
              }))['entries']
              as List)
          .map(
            (e) =>
                ProjectDirectory.fromJson(Map<String, dynamic>.from(e as Map)),
          )
          .toList();
  Future<String> createDirectory(String parent, String name) async =>
      (await _call('project/createDirectory', {
            'parentPath': parent,
            'name': name,
          }))['path']
          as String;
}

class WorkspaceRepository {
  WorkspaceRepository(
    this.transport, {
    required this.cwd,
    required this.threadId,
  }) : connectionIdentity = (
         transport.macDeviceId,
         transport.sessionId,
         transport.connectionRevision,
       );
  final RemoteTransport transport;
  final String cwd, threadId;
  final (String?, String?, int) connectionIdentity;
  String? get _macId => connectionIdentity.$1;
  bool get isCurrent =>
      connectionIdentity ==
      (
        transport.macDeviceId,
        transport.sessionId,
        transport.connectionRevision,
      );
  Future<RemoteJson> _call(String method, RemoteJson params) async {
    if (!isCurrent) {
      throw StateError(appStrings.workspaceDesktopChanged);
    }
    if (cwd.trim().isEmpty) {
      throw StateError(appStrings.workspaceChooseWorkspaceFirst);
    }
    final result = await transport.request(method, {...params, 'cwd': cwd});
    if (!isCurrent) {
      throw StateError(appStrings.workspaceDesktopChanged);
    }
    return result;
  }

  Future<WorkspaceTextFile> readTextFile(
    String path, {
    WorkspaceTextFile? cached,
  }) async {
    final value = await _call('workspace/readFile', {
      'path': path,
      'includeContent': true,
      if (cached != null) ...{
        'ifByteLength': cached.byteLength,
        'ifMtimeMs': ?cached.mtimeMs,
      },
    });
    final content = value['notModified'] == true
        ? cached?.content
        : value['content'] as String?;
    if (content == null) {
      throw StateError(appStrings.workspaceNoTextInPreview);
    }
    return WorkspaceTextFile(
      path: value['path'] as String? ?? path,
      name: value['fileName'] as String? ?? path,
      byteLength: value['byteLength'] as int,
      mtimeMs: value['mtimeMs'] as num?,
      content: content,
      encoding: value['encoding'] as String? ?? cached?.encoding ?? 'utf-8',
      lineCount:
          value['lineCount'] as int? ??
          (value['notModified'] == true ? cached?.lineCount : null),
    );
  }

  Future<WorkspaceImage> readImage(
    String path, {
    WorkspaceImage? cached,
  }) async {
    final value = await _call('workspace/readImage', {
      'path': path,
      'includeData': true,
      'maxPixelDimension': 1600,
      if (cached != null) ...{
        'ifByteLength': cached.byteLength,
        'ifMtimeMs': ?cached.mtimeMs,
        'ifPreviewMaxPixelDimension': ?cached.previewDimension,
      },
    });
    final bytes = value['notModified'] == true
        ? cached?.bytes
        : (value['dataBase64'] is String
              ? base64Decode(value['dataBase64'] as String)
              : null);
    if (bytes == null) {
      throw StateError(appStrings.workspaceNoImageInPreview);
    }
    return WorkspaceImage(
      path: value['path'] as String? ?? path,
      name: value['fileName'] as String? ?? path,
      mimeType: value['mimeType'] as String,
      byteLength: value['byteLength'] as int,
      mtimeMs: value['mtimeMs'] as num?,
      previewDimension: value['previewMaxPixelDimension'] as int?,
      bytes: bytes,
    );
  }

  Future<ResponseUndoPreview> revertPatchPreview(String forwardPatch) async =>
      ResponseUndoPreview(
        await _call('workspace/revertPatchPreview', {
          'forwardPatch': forwardPatch,
        }),
      );
  Future<ResponseUndoResult> revertPatchApply(String forwardPatch) async =>
      ResponseUndoResult(
        await _call('workspace/revertPatchApply', {
          'forwardPatch': forwardPatch,
        }),
      );
  Future<ResponseUndoPreview> revertPatchBatchPreview(
    List<ResponsePatch> patches,
  ) async => ResponseUndoPreview(
    await _call('workspace/revertPatchBatchPreview', {
      'patches': patches.map((p) => p.toJson()).toList(),
    }),
  );
  Future<ResponseUndoResult> revertPatchBatchApply(
    List<ResponsePatch> patches,
  ) async => ResponseUndoResult(
    await _call('workspace/revertPatchBatchApply', {
      'patches': patches.map((p) => p.toJson()).toList(),
    }),
  );

  Future<RemoteJson> capture({
    required String kind,
    String? turnId,
    String? messageId,
  }) => _call('workspace/checkpointCapture', {
    'threadId': threadId,
    'checkpointKind': kind,
    'turnId': ?turnId,
    'messageId': ?messageId,
  });
  Future<RemoteJson> copyStart(String messageId, String turnId) =>
      _call('workspace/checkpointCopy', {
        'threadId': threadId,
        'sourceCheckpointKind': 'messageStart',
        'sourceMessageId': messageId,
        'targetCheckpointKind': 'turnStart',
        'targetTurnId': turnId,
      });
  Future<String> checkpointDiff(String turnId) async =>
      (await _call('workspace/checkpointDiff', {
            'threadId': threadId,
            'fromCheckpointKind': 'turnStart',
            'fromTurnId': turnId,
            'toCheckpointKind': 'turnEnd',
            'toTurnId': turnId,
          }))['diff']
          as String;
  Future<CheckpointPreview> previewRestore(String turnId) async =>
      CheckpointPreview.fromJson(
        await _call('workspace/checkpointRestorePreview', {
          'threadId': threadId,
          'targetCheckpointKind': 'turnStart',
          'targetTurnId': turnId,
        }),
        threadId: threadId,
        turnId: turnId,
        cwd: cwd,
        macId: _macId,
        sessionId: connectionIdentity.$2,
        connectionRevision: connectionIdentity.$3,
      );
  Future<RemoteJson> restore(CheckpointConfirmation confirmation) async {
    final preview = confirmation.preview;
    if (preview.threadId != threadId ||
        preview.cwd != cwd ||
        (preview.macId, preview.sessionId, preview.connectionRevision) !=
            connectionIdentity) {
      throw StateError(appStrings.workspaceRestorePreviewOtherWorkspace);
    }
    return _call('workspace/checkpointRestoreApply', {
      'threadId': threadId,
      'targetTurnId': preview.turnId,
      'targetCheckpointRef': preview.ref,
      'expectedTargetCommit': ?preview.commit,
      'confirmDestructiveRestore': true,
    });
  }
}
