/// A legacy paired ChatGPT return, separate from DJL Cloud conversation links.
Uri? pairedLoginCallback(Uri uri) {
  if (uri.scheme.toLowerCase() != 'djl' ||
      !uri.hasAuthority ||
      uri.host != 'auth' ||
      uri.userInfo.isNotEmpty ||
      uri.hasPort ||
      uri.hasFragment ||
      uri.path.toLowerCase() != '/gpt/callback' ||
      uri.toString().split('?').first.contains('%')) {
    return null;
  }
  return uri;
}
