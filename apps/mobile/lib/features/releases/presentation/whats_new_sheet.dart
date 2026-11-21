import 'package:flutter/material.dart';
import '../../settings/domain/appearance.dart';

import '../../../core/design/djl_icons.dart';

import '../../../core/design/djl_tokens.dart';

const whatsNewNotes = <String, List<String>>{
  '1.0.0': [
    'A calmer black and white design.',
    'Group chats: talk to several agents at once and watch them reply live.',
    'Send files and photos in a group chat.',
    'Chats go straight to DJL on your Mac.',
  ],
  '0.1.0': [
    'DJL on iOS and Android.',
    'Switch between DJL Cloud and a paired Mac.',
    'Saved conversations, streaming replies, and desktop tools.',
    'Browse Studio and project chats from your phone.',
  ],
};

class WhatsNewSheet extends StatelessWidget {
  const WhatsNewSheet({
    super.key,
    required this.version,
    required this.onDismiss,
  });
  final String version;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context), colors = theme.colorScheme;
    final secondary = colors.onSurfaceVariant;
    final body = theme.textTheme.bodyLarge!.copyWith(fontSize: 15, height: 1.2);
    final buttonHeight = (MediaQuery.textScalerOf(context).scale(15) * 1.2 + 16)
        .clamp(56.0, double.infinity);
    return FractionallySizedBox(
      heightFactor: 1,
      child: Stack(
        children: [
          ListView(
            padding: EdgeInsets.fromLTRB(
              24,
              24,
              24,
              64 + buttonHeight + 48 + MediaQuery.paddingOf(context).bottom,
            ),
            children: [
              Semantics(
                header: true,
                child: Text(
                  "What's New",
                  style: theme.textTheme.headlineMedium!.copyWith(
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                    height: 1.2,
                  ),
                ),
              ),
              const SizedBox(height: 10),
              Text(
                'DJL $version',
                style: theme.textTheme.bodyMedium!.copyWith(
                  fontSize: 14,
                  height: 4 / 3,
                  fontFamily: DjlAppearance.of(context).font.codeFamily,
                  color: secondary,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                "Here's what's new in DJL.",
                style: body.copyWith(color: secondary),
              ),
              const SizedBox(height: 24),
              for (final item in whatsNewNotes[version]!) ...[
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Icon(
                        DjlIcons.arrowRight,
                        size: 11,
                        color: secondary,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(child: Text(item, style: body)),
                  ],
                ),
                const SizedBox(height: 12),
              ],
              const SizedBox(height: 12),
              Text(
                "We'll only show this once for each app version.",
                style: theme.textTheme.bodySmall!.copyWith(
                  fontSize: 11,
                  color: secondary,
                ),
              ),
            ],
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                IgnorePointer(
                  child: Container(
                    height: 64,
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [
                          colors.surface.withValues(alpha: 0),
                          colors.surface,
                        ],
                      ),
                    ),
                  ),
                ),
                ColoredBox(
                  color: colors.surface,
                  child: SafeArea(
                    top: false,
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
                      child: SizedBox(
                        width: double.infinity,
                        child: TextButton(
                          style: TextButton.styleFrom(
                            minimumSize: const Size(48, 56),
                            foregroundColor: Colors.black,
                            backgroundColor: Colors.white,
                            shape: const StadiumBorder(),
                            textStyle: body.copyWith(
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          onPressed: onDismiss,
                          child: const Text('Got It'),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: Center(
              child: Semantics(
                container: true,
                excludeSemantics: true,
                label: 'Dismiss release notes',
                button: true,
                onTap: onDismiss,
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: onDismiss,
                  child: SizedBox(
                    width: 76,
                    height: 24,
                    child: Align(
                      alignment: Alignment.topCenter,
                      child: Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Container(
                          width: 36,
                          height: 5,
                          decoration: BoxDecoration(
                            color: DjlColors.of(context).inkFaint,
                            borderRadius: BorderRadius.circular(3),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
