import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import '../../../core/design/djl_icons.dart';
import '../../../core/design/djl_tokens.dart';
import '../../attachments/presentation/attachment_preview_page.dart';
import '../domain/group_models.dart';
import 'groups_controller.dart';

/// A file picked in the composer, not sent yet.
class DraftAttachment {
  const DraftAttachment(this.key, this.name, this.mimeType, this.bytes);
  final String key, name, mimeType;
  final Uint8List bytes;
  bool get image => mimeType.toLowerCase().startsWith('image/');
}

/// Images in history download for their thumbnail only up to this size.
const _autoThumbnailBytes = 8 * 1024 * 1024;

/// The files waiting to go with the next message, above the composer.
class AttachmentDraftStrip extends StatelessWidget {
  const AttachmentDraftStrip({
    super.key,
    required this.drafts,
    required this.onRemove,
  });
  final List<DraftAttachment> drafts;
  final ValueChanged<DraftAttachment> onRemove;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 76,
    child: ListView.separated(
      key: const Key('group-attachment-drafts'),
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.fromLTRB(10, 10, 10, 2),
      itemCount: drafts.length,
      separatorBuilder: (_, _) => const SizedBox(width: DjlSpace.sm),
      itemBuilder: (context, index) {
        final draft = drafts[index];
        return Stack(
          clipBehavior: Clip.none,
          children: [
            _Tile(
              name: draft.name,
              mimeType: draft.mimeType,
              sizeBytes: draft.bytes.length,
              bytes: draft.image ? draft.bytes : null,
              compact: true,
              onTap: () => AttachmentPreviewPage.show(
                context,
                name: draft.name,
                mimeType: draft.mimeType,
                load: () async => draft.bytes,
              ),
            ),
            Positioned(
              top: -6,
              right: -6,
              child: Semantics(
                button: true,
                label: 'Remove ${draft.name}',
                child: GestureDetector(
                  onTap: () => onRemove(draft),
                  child: Container(
                    width: 22,
                    height: 22,
                    decoration: BoxDecoration(
                      color: DjlColors.of(context).ink,
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: DjlColors.of(context).surface,
                        width: 1.5,
                      ),
                    ),
                    child: Icon(
                      DjlIcons.close,
                      size: 12,
                      color: DjlColors.of(context).onInk,
                    ),
                  ),
                ),
              ),
            ),
          ],
        );
      },
    ),
  );
}

/// The files on a sent message. Tapping one previews it.
class MessageAttachments extends StatelessWidget {
  const MessageAttachments({
    super.key,
    required this.attachments,
    required this.controller,
    this.progress,
  });
  final List<GroupAttachment> attachments;
  final GroupsController controller;
  final ValueListenable<double>? progress;

  @override
  Widget build(BuildContext context) {
    final images = attachments.where((a) => a.image).toList();
    final files = attachments.where((a) => !a.image).toList();
    void open(GroupAttachment attachment) => AttachmentPreviewPage.show(
      context,
      name: attachment.name,
      mimeType: attachment.mimeType,
      load: () => controller.attachmentBytes(attachment),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (images.isNotEmpty)
          Wrap(
            alignment: WrapAlignment.end,
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final image in images)
                _ImageThumb(
                  key: ValueKey('thumb-${image.key}'),
                  attachment: image,
                  controller: controller,
                  size: images.length == 1 ? 200 : 116,
                  onTap: () => open(image),
                ),
            ],
          ),
        if (images.isNotEmpty && files.isNotEmpty) const SizedBox(height: 6),
        for (final file in files)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: _Tile(
              name: file.name,
              mimeType: file.mimeType,
              sizeBytes: file.sizeBytes,
              onTap: () => open(file),
            ),
          ),
        if (progress != null)
          ValueListenableBuilder<double>(
            valueListenable: progress!,
            builder: (context, value, _) => Padding(
              padding: const EdgeInsets.only(top: 2, bottom: 4),
              child: SizedBox(
                width: 140,
                child: Semantics(
                  label: 'Sending files',
                  value: '${(value * 100).round()}%',
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(2),
                    child: LinearProgressIndicator(
                      value: value,
                      minHeight: 3,
                      color: DjlColors.of(context).ink,
                      backgroundColor: DjlColors.of(context).surfaceSunken,
                    ),
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _ImageThumb extends StatefulWidget {
  const _ImageThumb({
    super.key,
    required this.attachment,
    required this.controller,
    required this.size,
    required this.onTap,
  });
  final GroupAttachment attachment;
  final GroupsController controller;
  final double size;
  final VoidCallback onTap;

  @override
  State<_ImageThumb> createState() => _ImageThumbState();
}

class _ImageThumbState extends State<_ImageThumb> {
  Future<Uint8List>? _bytes;

  @override
  void initState() {
    super.initState();
    if (widget.attachment.sizeBytes <= _autoThumbnailBytes) {
      _bytes = widget.controller.attachmentBytes(widget.attachment);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = DjlColors.of(context);
    final placeholder = ColoredBox(
      color: colors.surfaceRaised,
      child: Icon(DjlIcons.image, color: colors.inkFaint),
    );
    return Semantics(
      button: true,
      label: 'Image ${widget.attachment.name}',
      child: GestureDetector(
        onTap: widget.onTap,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(DjlRadius.md),
          child: SizedBox.square(
            dimension: widget.size,
            child: _bytes == null
                ? placeholder
                : FutureBuilder<Uint8List>(
                    future: _bytes,
                    builder: (context, snapshot) => snapshot.data == null
                        ? placeholder
                        : Image.memory(
                            snapshot.data!,
                            fit: BoxFit.cover,
                            cacheWidth:
                                (widget.size *
                                        MediaQuery.devicePixelRatioOf(context))
                                    .round(),
                            gaplessPlayback: true,
                            errorBuilder: (_, _, _) => placeholder,
                          ),
                  ),
          ),
        ),
      ),
    );
  }
}

/// A file as a card: its icon (or a thumbnail), name, kind and size.
class _Tile extends StatelessWidget {
  const _Tile({
    required this.name,
    required this.mimeType,
    required this.sizeBytes,
    required this.onTap,
    this.bytes,
    this.compact = false,
  });
  final String name, mimeType;
  final int sizeBytes;
  final Uint8List? bytes;
  final bool compact;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = DjlColors.of(context);
    final text = Theme.of(context).textTheme;
    final badge = ClipRRect(
      borderRadius: BorderRadius.circular(DjlRadius.sm),
      child: SizedBox.square(
        dimension: 40,
        child: bytes != null
            ? Image.memory(bytes!, fit: BoxFit.cover, cacheWidth: 120)
            : ColoredBox(
                color: colors.surfaceSunken,
                child: Icon(
                  attachmentIcon(name, mimeType),
                  size: 22,
                  color: colors.ink,
                ),
              ),
      ),
    );
    return Semantics(
      button: true,
      label: '$name, ${attachmentKindLabel(name, mimeType)}',
      excludeSemantics: true,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          width: compact ? 196 : 240,
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: colors.surfaceRaised,
            borderRadius: BorderRadius.circular(DjlRadius.md),
            border: Border.all(color: colors.hairline),
          ),
          child: Row(
            children: [
              badge,
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: text.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                        color: colors.ink,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${attachmentKindLabel(name, mimeType)} · '
                      '${formatByteSize(sizeBytes)}',
                      maxLines: 1,
                      style: text.bodySmall,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
