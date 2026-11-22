import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../../../core/design/djl_icons.dart';
import '../../../core/design/djl_tokens.dart';
import '../domain/group_models.dart';

/// Marks with their own brand colours, the only colour in the app. Every other
/// mark is drawn in one colour and follows the theme's ink.
const _colourAgents = {'claudeAgent', 'gemini'};
const _knownAgents = {
  'codex',
  'claudeAgent',
  'cursor',
  'grok',
  'kimi',
  'iflow',
  'qwen',
  'codebuddy',
  'pi',
  'gemini',
};

class AgentAvatar extends StatelessWidget {
  const AgentAvatar({super.key, required this.provider, this.size = 36});

  /// Null for a member that has since left the group.
  final String? provider;
  final double size;

  @override
  Widget build(BuildContext context) {
    final colors = DjlColors.of(context);
    final known = _knownAgents.contains(provider);
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: colors.surfaceRaised,
        shape: BoxShape.circle,
        border: Border.all(color: colors.hairline),
      ),
      alignment: Alignment.center,
      child: known
          ? SvgPicture.asset(
              'assets/agents/$provider.svg',
              width: size * .54,
              height: size * .54,
              excludeFromSemantics: true,
              colorFilter: _colourAgents.contains(provider)
                  ? null
                  : ColorFilter.mode(colors.ink, BlendMode.srcIn),
            )
          : Icon(DjlIcons.account, size: size * .56, color: colors.inkMuted),
    );
  }
}

/// Up to three overlapping avatars, for a group's identity.
class AgentAvatarStack extends StatelessWidget {
  const AgentAvatarStack({super.key, required this.members, this.size = 28});
  final List<GroupMember> members;
  final double size;

  @override
  Widget build(BuildContext context) {
    final shown = members.take(3).toList();
    final step = size * .68;
    return SizedBox(
      width: shown.isEmpty ? size : size + step * (shown.length - 1),
      height: size,
      child: Stack(
        children: [
          for (final (index, member) in shown.indexed)
            Positioned(
              left: step * index,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  // A ring in the page colour separates overlapping marks.
                  border: Border.all(
                    color: DjlColors.of(context).surface,
                    width: 1.5,
                    strokeAlign: BorderSide.strokeAlignOutside,
                  ),
                ),
                child: AgentAvatar(provider: member.provider, size: size),
              ),
            ),
        ],
      ),
    );
  }
}
