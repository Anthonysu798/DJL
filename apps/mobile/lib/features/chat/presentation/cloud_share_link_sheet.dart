import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';
import '../../settings/domain/appearance.dart';

import '../../../core/design/djl_icons.dart';

class CloudShareLinkSheet extends StatefulWidget {
  const CloudShareLinkSheet({super.key, required this.url});

  final String url;

  @override
  State<CloudShareLinkSheet> createState() => _CloudShareLinkSheetState();
}

class _CloudShareLinkSheetState extends State<CloudShareLinkSheet> {
  bool _copied = false, _sharing = false;
  String? _error;

  Future<void> _copy() async {
    await Clipboard.setData(ClipboardData(text: widget.url));
    if (mounted) setState(() => _copied = true);
  }

  Future<void> _share(BuildContext anchor) async {
    if (_sharing) return;
    final box = anchor.findRenderObject()! as RenderBox;
    final origin = box.localToGlobal(Offset.zero) & box.size;
    setState(() {
      _sharing = true;
      _error = null;
    });
    try {
      await SharePlus.instance.share(
        ShareParams(uri: Uri.parse(widget.url), sharePositionOrigin: origin),
      );
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Could not open sharing. Try again.');
      }
    } finally {
      if (mounted) setState(() => _sharing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(12),
    );
    return SizedBox(
      height: MediaQuery.sizeOf(context).height * .5,
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Share link created',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 16),
              Text(
                "Anyone with the link can read this chat as it is now. Messages you send later aren't shared.",
                style: TextStyle(fontSize: 14, color: scheme.onSurfaceVariant),
              ),
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: scheme.surfaceContainerLow,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  widget.url,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontFamily: DjlAppearance.of(context).font.codeFamily,
                    fontSize: 12,
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _copy,
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size(0, 52),
                        shape: shape,
                      ),
                      icon: Icon(
                        _copied ? DjlIcons.check : DjlIcons.copy,
                        size: 18,
                      ),
                      label: Text(_copied ? 'Copied' : 'Copy link'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Builder(
                      builder: (anchor) => FilledButton.icon(
                        onPressed: _sharing ? null : () => _share(anchor),
                        style: FilledButton.styleFrom(
                          minimumSize: const Size(0, 52),
                          shape: shape,
                        ),
                        icon: const Icon(DjlIcons.share, size: 18),
                        label: const Text('Share'),
                      ),
                    ),
                  ),
                ],
              ),
              if (_error != null) ...[
                const SizedBox(height: 16),
                Text(_error!, style: TextStyle(color: scheme.error)),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
