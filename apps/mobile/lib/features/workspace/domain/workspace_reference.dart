/// Markdown workspace links use Mac paths, file URLs, and optional line suffixes.
({String path, bool image})? workspaceReference(String href) {
  final withoutLine = href
      .split('#')
      .first
      .replaceFirst(RegExp(r':\d+(?::\d+)?$'), '');
  final uri = Uri.tryParse(withoutLine);
  if (uri == null ||
      (!{'', 'file'}.contains(uri.scheme)) ||
      (uri.scheme == 'file' &&
          uri.host.isNotEmpty &&
          uri.host != 'localhost')) {
    return null;
  }
  var path = Uri.decodeComponent(
    uri.path,
  ).replaceFirst(RegExp(r':\d+(?::\d+)?$'), '');
  if (path.trim().isEmpty) {
    return null;
  }
  final image = RegExp(
    r'\.(png|jpe?g|gif|webp|svg|heic|heif)$',
    caseSensitive: false,
  ).hasMatch(path);
  return (path: path, image: image);
}
