import 'dart:convert';
import 'dart:typed_data';
import '../../pairing/data/pairing_repository.dart';

const desktopImageByteLimit = 12000000;

class DesktopComposerImage {
  const DesktopComposerImage({
    required this.id,
    required this.name,
    required this.dataUrl,
  });
  final String id, name, dataUrl;
  Uint8List get bytes =>
      base64Decode(dataUrl.substring(dataUrl.indexOf(',') + 1));
  RemoteJson toJson() => {'id': id, 'name': name, 'dataUrl': dataUrl};
  factory DesktopComposerImage.fromJson(RemoteJson value) {
    final url = value['dataUrl'] as String;
    if (!url.startsWith('data:image/') ||
        !url.contains(';base64,') ||
        utf8.encode(url).length > desktopImageByteLimit) {
      throw const FormatException('Invalid saved composer image.');
    }
    return DesktopComposerImage(
      id: value['id'] as String,
      name: value['name'] as String,
      dataUrl: url,
    );
  }
}

enum DesktopContextKind { file, skill, plugin }

class DesktopComposerContext {
  const DesktopComposerContext({
    required this.kind,
    required this.id,
    required this.name,
    this.path,
  });
  final DesktopContextKind kind;
  final String id, name;
  final String? path;
  String get key => '${kind.name}:$id';
  String get token => switch (kind) {
    DesktopContextKind.file => '@$path',
    DesktopContextKind.skill => '\$$name',
    DesktopContextKind.plugin => '@$name',
  };
  RemoteJson toJson() => {
    'kind': kind.name,
    'id': id,
    'name': name,
    if (path != null) 'path': path,
  };
  factory DesktopComposerContext.fromJson(RemoteJson value) =>
      DesktopComposerContext(
        kind: DesktopContextKind.values.byName(value['kind'] as String),
        id: value['id'] as String,
        name: value['name'] as String,
        path: value['path'] as String?,
      );
}

class DesktopComposerDraft {
  DesktopComposerDraft({
    this.text = '',
    this.cwd,
    List<DesktopComposerImage> images = const [],
    List<DesktopComposerContext> contexts = const [],
  }) : images = List.unmodifiable(images),
       contexts = List.unmodifiable(contexts);
  final String text;
  final String? cwd;
  final List<DesktopComposerImage> images;
  final List<DesktopComposerContext> contexts;
  bool get isEmpty => text.trim().isEmpty && images.isEmpty && contexts.isEmpty;
  DesktopComposerDraft copyWith({
    String? text,
    List<DesktopComposerImage>? images,
    List<DesktopComposerContext>? contexts,
  }) => DesktopComposerDraft(
    text: text ?? this.text,
    cwd: cwd,
    images: images ?? this.images,
    contexts: contexts ?? this.contexts,
  );
  RemoteJson toJson() => {
    'text': text,
    if (cwd != null) 'cwd': cwd,
    'images': images.map((v) => v.toJson()).toList(),
    'contexts': contexts.map((v) => v.toJson()).toList(),
  };
  factory DesktopComposerDraft.fromJson(RemoteJson value) =>
      DesktopComposerDraft(
        text: value['text'] as String? ?? '',
        cwd: value['cwd'] as String?,
        images: (value['images'] as List? ?? [])
            .map(
              (v) => DesktopComposerImage.fromJson(
                Map<String, dynamic>.from(v as Map),
              ),
            )
            .toList(),
        contexts: (value['contexts'] as List? ?? [])
            .map(
              (v) => DesktopComposerContext.fromJson(
                Map<String, dynamic>.from(v as Map),
              ),
            )
            .toList(),
      );

  // Remove only the successfully sent snapshot; edits made while sending remain drafts.
  DesktopComposerDraft without(DesktopComposerDraft sent) =>
      DesktopComposerDraft(
        text: text == sent.text ? '' : text,
        cwd: cwd,
        images: images
            .where(
              (v) => !sent.images.any(
                (old) => old.id == v.id && old.dataUrl == v.dataUrl,
              ),
            )
            .toList(),
        contexts: contexts
            .where((v) => !sent.contexts.any((old) => old.key == v.key))
            .toList(),
      );

  List<RemoteJson> input({
    String imageUrlKey = 'url',
    bool skills = true,
    bool plugins = true,
  }) {
    if (images.length > 4) {
      throw const FormatException('Choose at most four images.');
    }
    for (final c in contexts) {
      if (c.id.trim().isEmpty ||
          c.name.trim().isEmpty ||
          c.kind != DesktopContextKind.skill &&
              c.path?.trim().isNotEmpty != true) {
        throw const FormatException(
          'A selected context is incomplete. Remove it and select it again.',
        );
      }
    }
    final lower = text.toLowerCase();
    final missing = contexts
        .where((context) {
          final token = context.token;
          if (context.kind == DesktopContextKind.file) {
            final bounded = RegExp(
              r'''(?:^|[\s"'(\[{<])''' +
                  RegExp.escape(token) +
                  r'''(?=$|[\s"',;:!?)}\]>]|\.(?=\s|$))''',
              caseSensitive: false,
            );
            return !bounded.hasMatch(text);
          }
          // Keep Swift's substring/slash compatibility only for skill/plugin tokens.
          return !lower.contains(token.toLowerCase()) &&
              !(token.startsWith('\$') &&
                  lower.contains('/${token.substring(1)}'.toLowerCase()));
        })
        .map((context) => context.token)
        .toSet()
        .toList();
    final trimmed = text.trim();
    final legacy = [
      if (trimmed.isNotEmpty) trimmed,
      if (missing.isNotEmpty) missing.join(' '),
    ].join('\n\n');
    return [
      for (final image in images) {'type': 'image', imageUrlKey: image.dataUrl},
      if (legacy.isNotEmpty) {'type': 'text', 'text': legacy},
      if (skills)
        for (final c in contexts.where(
          (c) => c.kind == DesktopContextKind.skill,
        ))
          {
            'type': 'skill',
            'id': c.id.trim(),
            if (c.name.trim().isNotEmpty) 'name': c.name.trim(),
            if (c.path?.trim().isNotEmpty == true) 'path': c.path!.trim(),
          },
      if (plugins)
        for (final c in contexts.where(
          (c) => c.kind == DesktopContextKind.plugin,
        ))
          {'type': 'mention', 'name': c.name.trim(), 'path': c.path!.trim()},
    ];
  }
}

/// Source-compatible URL aliases, including nested image_url objects in history.
String? desktopImageSource(Map value, [int depth = 0]) {
  if (depth > 4) return null;
  for (final key in ['url', 'image_url', 'imageUrl', 'path']) {
    final result = value[key];
    if (result is String && result.trim().isNotEmpty) return result.trim();
    if (result is Map) {
      final nested = desktopImageSource(result, depth + 1);
      if (nested != null) return nested;
    }
  }
  for (final result in value.values.whereType<Map>()) {
    final nested = desktopImageSource(result, depth + 1);
    if (nested != null) return nested;
  }
  return null;
}

bool desktopIsImage(Map part) =>
    {'image', 'localimage', 'inputimage', 'outputimage'}.contains(
      part['type']?.toString().toLowerCase().replaceAll(RegExp('[^a-z]'), ''),
    );

// Bound persisted inline history without discarding safe source paths or other content.
RemoteJson desktopHistoryItem(RemoteJson item) {
  dynamic sanitize(dynamic value) {
    if (value is String &&
        value.toLowerCase().startsWith('data:image') &&
        utf8.encode(value).length > desktopImageByteLimit) {
      return null;
    }
    if (value is Map) {
      return value.map((key, v) => MapEntry(key.toString(), sanitize(v)));
    }
    if (value is List) return value.map(sanitize).toList();
    return value;
  }

  final result = Map<String, dynamic>.from(sanitize(item) as Map);
  if (result['type'] == 'agentMessage' &&
      result['text'] is! String &&
      result['content'] is List) {
    final parts = (result['content'] as List).whereType<Map>().where(
      (part) =>
          {'text', 'outputText', 'output_text'}.contains(part['type']) &&
          part['text'] is String,
    );
    if (parts.isNotEmpty) {
      result['text'] = parts.map((part) => part['text'] as String).join('\n');
    }
  }
  return result;
}

RemoteJson desktopMergeUserEcho(RemoteJson local, RemoteJson incoming) {
  final previous = (local['content'] as List? ?? [])
      .whereType<Map>()
      .where(desktopIsImage)
      .toList();
  final content = <dynamic>[];
  var imageIndex = 0;
  for (final raw in (incoming['content'] as List? ?? [])) {
    if (raw is! Map || !desktopIsImage(raw)) {
      content.add(raw);
      continue;
    }
    final old = imageIndex < previous.length ? previous[imageIndex] : null;
    imageIndex++;
    final preview =
        old?['_previewUrl'] as String? ??
        (old == null ? null : desktopImageSource(old));
    content.add(<String, dynamic>{
      ...Map<String, dynamic>.from(raw),
      if (desktopImageSource(raw)?.startsWith('data:image') != true &&
          preview?.startsWith('data:image') == true)
        '_previewUrl': preview,
    });
  }
  return {
    ...incoming,
    if (incoming['fileMentions'] == null && local['fileMentions'] is List)
      'fileMentions': local['fileMentions'],
    'content': content,
  };
}
