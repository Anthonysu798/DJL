import 'dart:typed_data';
import '../../pairing/data/pairing_repository.dart';

class ProjectLocation {
  const ProjectLocation(this.id, this.label, this.path);
  final String id, label, path;
  factory ProjectLocation.fromJson(RemoteJson value) => ProjectLocation(
    value['id'] as String,
    value['label'] as String,
    value['path'] as String,
  );
}

class ProjectDirectory {
  const ProjectDirectory(this.name, this.path, this.isSymlink);
  final String name, path;
  final bool isSymlink;
  factory ProjectDirectory.fromJson(RemoteJson value) => ProjectDirectory(
    value['name'] as String,
    value['path'] as String,
    value['isSymlink'] == true,
  );
}

class ProjectListing {
  ProjectListing.fromJson(RemoteJson value)
    : path = value['path'] as String,
      parentPath = value['parentPath'] as String?,
      entries = (value['entries'] as List)
          .map(
            (e) =>
                ProjectDirectory.fromJson(Map<String, dynamic>.from(e as Map)),
          )
          .toList();
  final String path;
  final String? parentPath;
  final List<ProjectDirectory> entries;
}

class WorkspaceTextFile {
  const WorkspaceTextFile({
    required this.path,
    required this.name,
    required this.byteLength,
    required this.mtimeMs,
    required this.content,
    this.encoding = 'utf-8',
    this.lineCount,
  });
  final String path, name, content;
  final int byteLength;
  final String encoding;
  final int? lineCount;
  final num? mtimeMs;
}

class WorkspaceImage {
  const WorkspaceImage({
    required this.path,
    required this.name,
    required this.mimeType,
    required this.byteLength,
    required this.mtimeMs,
    required this.previewDimension,
    required this.bytes,
  });
  final String path, name, mimeType;
  final int byteLength;
  final num? mtimeMs;
  final int? previewDimension;
  final Uint8List bytes;
}

class CheckpointPreview {
  CheckpointPreview.fromJson(
    RemoteJson value, {
    required this.threadId,
    required this.turnId,
    required this.cwd,
    required this.macId,
    required this.sessionId,
    required this.connectionRevision,
  }) : canRestore = value['canRestore'] == true,
       ref = value['checkpointRef'] as String? ?? '',
       commit = value['commit'] as String?,
       affectedFiles = List<String>.from(value['affectedFiles'] as List? ?? []),
       stagedFiles = List<String>.from(value['stagedFiles'] as List? ?? []),
       untrackedFiles = List<String>.from(
         value['untrackedFiles'] as List? ?? [],
       );
  final String threadId, turnId, cwd, ref;
  final String? commit, macId, sessionId;
  final int connectionRevision;
  final bool canRestore;
  final List<String> affectedFiles, stagedFiles, untrackedFiles;
  CheckpointConfirmation? confirm({required bool userConfirmed}) =>
      userConfirmed && canRestore && ref.isNotEmpty
      ? CheckpointConfirmation._(this)
      : null;
}

class CheckpointConfirmation {
  const CheckpointConfirmation._(this.preview);
  final CheckpointPreview preview;
}
