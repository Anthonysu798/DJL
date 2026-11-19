import 'dart:convert';
import 'package:flutter/material.dart';
import '../domain/desktop_composer.dart';
import '../../pairing/data/pairing_repository.dart';
import 'desktop_composer_controller.dart';

class DesktopComposerAttachments extends StatelessWidget {
  const DesktopComposerAttachments({super.key, required this.controller});
  final DesktopComposerController controller;
  @override
  Widget build(BuildContext context) => ConstrainedBox(
    constraints: const BoxConstraints(maxHeight: 170),
    child: SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (controller.contextScopeError != null)
            Text(
              controller.contextScopeError!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          if (controller.slots.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 8, right: 8),
              child: SizedBox(
                height: 60,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: controller.slots.length,
                  separatorBuilder: (_, _) => const SizedBox(width: 8),
                  itemBuilder: (context, index) {
                    final slot = controller.slots[index];
                    return SizedBox.square(
                      dimension: 60,
                      child: Stack(
                        fit: StackFit.expand,
                        children: [
                          DecoratedBox(
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(
                                color: slot.error == null
                                    ? Theme.of(
                                        context,
                                      ).colorScheme.outlineVariant
                                    : Theme.of(context).colorScheme.error,
                              ),
                            ),
                            child: slot.loading
                                ? const Center(
                                    child: SizedBox.square(
                                      dimension: 20,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                      ),
                                    ),
                                  )
                                : slot.error != null
                                ? const Icon(Icons.error_outline, size: 24)
                                : DesktopImagePreview(
                                    source: slot.image!.dataUrl,
                                    label: slot.image!.name,
                                    size: 60,
                                  ),
                          ),
                          Positioned(
                            top: 5,
                            right: 5,
                            child: IconButton(
                              tooltip: 'Remove image',
                              onPressed: () => controller.removeImage(slot.id),
                              constraints: const BoxConstraints.tightFor(
                                width: 18,
                                height: 18,
                              ),
                              padding: EdgeInsets.zero,
                              style: IconButton.styleFrom(
                                backgroundColor: Colors.black.withValues(
                                  alpha: .72,
                                ),
                                foregroundColor: Colors.white,
                                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                              ),
                              icon: const Icon(Icons.close, size: 12),
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ),
            ),
          for (final slot in controller.slots)
            if (slot.error != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  slot.error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
          if (controller.contexts.isNotEmpty)
            Wrap(
              spacing: 6,
              runSpacing: 4,
              children: [
                for (final mention in controller.contexts)
                  InputChip(
                    label: Text(
                      mention.token,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    tooltip: mention.path,
                    onDeleted: () => controller.removeContext(mention.key),
                  ),
              ],
            ),
        ],
      ),
    ),
  );
}

class DesktopImagePreview extends StatelessWidget {
  const DesktopImagePreview({
    super.key,
    required this.source,
    this.label = 'Attached image',
    this.size = 100,
  });
  final String? source;
  final String label;
  final double size;
  @override
  Widget build(BuildContext context) {
    Widget fallback() => Center(
      child: Text(
        source?.startsWith('data:') == false
            ? 'Desktop image: $source'
            : 'Image preview unavailable',
        maxLines: 3,
        overflow: TextOverflow.ellipsis,
      ),
    );
    final value = source;
    Widget child = fallback();
    if (value != null &&
        value.startsWith('data:image') &&
        utf8.encode(value).length <= desktopImageByteLimit) {
      try {
        final bytes = UriData.parse(value).contentAsBytes();
        child = Image.memory(
          bytes,
          fit: BoxFit.cover,
          cacheWidth: 200,
          semanticLabel: label,
          errorBuilder: (_, _, _) => fallback(),
        );
      } catch (_) {
        /* A malformed history image must not break chat rendering. */
      }
    } else if (value != null &&
        {'http', 'https'}.contains(Uri.tryParse(value)?.scheme)) {
      child = Image.network(
        value,
        fit: BoxFit.cover,
        cacheWidth: 200,
        semanticLabel: label,
        errorBuilder: (_, _, _) => fallback(),
      );
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: SizedBox(width: size, height: size, child: child),
    );
  }
}

class DesktopMessageAttachments extends StatelessWidget {
  const DesktopMessageAttachments({super.key, required this.item});
  final RemoteJson item;
  @override
  Widget build(BuildContext context) {
    final parts = (item['content'] as List? ?? []).whereType<Map>();
    final images = parts.where(desktopIsImage);
    final mentions = <String>{
      for (final part in parts)
        if (part['type'] == 'skill' && part['name'] is String)
          '\$${part['name']}',
      for (final part in parts)
        if (part['type'] == 'mention' && part['name'] is String)
          '@${part['name']}',
      for (final path
          in (item['fileMentions'] as List? ?? []).whereType<String>())
        '@$path',
    };
    if (images.isEmpty && mentions.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Wrap(
        spacing: 6,
        runSpacing: 6,
        children: [
          for (final part in images)
            DesktopImagePreview(
              source:
                  part['_previewUrl'] as String? ?? desktopImageSource(part),
            ),
          for (final mention in mentions) Chip(label: Text(mention)),
        ],
      ),
    );
  }
}
