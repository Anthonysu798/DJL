import 'dart:convert';

class SseFrame {
  const SseFrame(this.event, this.data, this.id);
  final String event;
  final String data;
  final String? id;
}

/// Byte-oriented WHATWG framing: UTF8 is decoded only after a complete line.
class SseParser {
  final _line = <int>[];
  final _data = <String>[];
  String _event = '';
  String? _id;
  bool _cr = false;

  List<SseFrame> feed(List<int> bytes) {
    final frames = <SseFrame>[];
    for (final byte in bytes) {
      if (_cr) {
        _cr = false;
        if (byte == 10) continue;
      }
      if (byte == 10 || byte == 13) {
        _cr = byte == 13;
        final line = utf8.decode(_line, allowMalformed: true);
        _line.clear();
        if (line.isEmpty) {
          if (_data.isNotEmpty) {
            frames.add(
              SseFrame(
                _event.isEmpty ? 'message' : _event,
                _data.join('\n'),
                _id,
              ),
            );
          }
          _event = '';
          _id = null;
          _data.clear();
        } else if (!line.startsWith(':')) {
          final colon = line.indexOf(':');
          final field = colon < 0 ? line : line.substring(0, colon);
          var value = colon < 0 ? '' : line.substring(colon + 1);
          if (value.startsWith(' ')) value = value.substring(1);
          switch (field) {
            case 'data':
              _data.add(value);
            case 'event':
              _event = value;
            case 'id':
              if (!value.contains('\u0000')) _id = value;
          }
        }
      } else {
        _line.add(byte);
      }
    }
    return frames;
  }
}
