import 'package:flutter/material.dart';
import '../../../core/design/djl_icons.dart';
import '../../../core/design/djl_tokens.dart';
import '../domain/group_models.dart';
import 'agent_avatar.dart';
import 'groups_controller.dart';

/// Pick agents, optionally name the group, create it. Pops with the new
/// [Group].
class GroupCreateSheet extends StatefulWidget {
  const GroupCreateSheet({super.key, required this.controller});
  final GroupsController controller;

  @override
  State<GroupCreateSheet> createState() => _GroupCreateSheetState();
}

class _GroupCreateSheetState extends State<GroupCreateSheet> {
  final _name = TextEditingController();
  final _picked = <String>[];
  List<GroupAgent>? _agents;
  String? _error;
  bool _creating = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final agents = await widget.controller.agents();
      if (mounted) setState(() => _agents = agents);
    } catch (_) {
      if (mounted) {
        setState(() => _error = "Couldn't reach your Mac. Try again.");
      }
    }
  }

  /// The desktop's default: the first three names, then how many more.
  String get _suggested {
    final names = [
      for (final provider in _picked)
        _agents!.firstWhere((agent) => agent.provider == provider).name,
    ];
    final more = names.length - 3;
    return [...names.take(3), if (more > 0) '+$more'].join(', ');
  }

  Future<void> _create() async {
    setState(() {
      _creating = true;
      _error = null;
    });
    try {
      final name = _name.text.trim();
      final group = await widget.controller.create(
        name.isEmpty ? _suggested : name,
        _picked,
      );
      if (mounted) Navigator.pop(context, group);
    } catch (_) {
      if (mounted) {
        setState(() {
          _creating = false;
          _error = "Couldn't create the group. Try again.";
        });
      }
    }
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = DjlColors.of(context);
    final agents = _agents;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(
            DjlSpace.xl,
            0,
            DjlSpace.xl,
            DjlSpace.lg,
          ),
          children: [
            Text('New group', style: theme.textTheme.headlineMedium),
            const SizedBox(height: DjlSpace.xs),
            Text(
              'Choose who is in the chat.',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: colors.inkMuted,
              ),
            ),
            const SizedBox(height: DjlSpace.lg),
            if (agents == null && _error == null)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: DjlSpace.xxxl),
                child: Center(
                  child: SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
              ),
            if (agents != null)
              for (final agent in agents)
                _AgentTile(
                  agent: agent,
                  picked: _picked.contains(agent.provider),
                  onTap: !agent.ready || _creating
                      ? null
                      : () => setState(
                          () => _picked.contains(agent.provider)
                              ? _picked.remove(agent.provider)
                              : _picked.add(agent.provider),
                        ),
                ),
            if (agents != null) ...[
              const SizedBox(height: DjlSpace.lg),
              TextField(
                key: const Key('group-name'),
                controller: _name,
                enabled: !_creating,
                textCapitalization: TextCapitalization.sentences,
                maxLength: 80,
                decoration: InputDecoration(
                  labelText: 'Name (optional)',
                  hintText: _picked.isEmpty ? null : _suggested,
                  counterText: '',
                ),
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: DjlSpace.md),
              Text(
                _error!,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: colors.danger,
                ),
              ),
              if (agents == null)
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton(
                    onPressed: _load,
                    child: const Text('Try again'),
                  ),
                ),
            ],
            const SizedBox(height: DjlSpace.lg),
            FilledButton(
              key: const Key('group-create'),
              onPressed: _picked.isEmpty || _creating ? null : _create,
              child: _creating
                  ? SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: colors.onInk,
                      ),
                    )
                  : Text(
                      _picked.isEmpty
                          ? 'Create group'
                          : _picked.length == 1
                          ? 'Create group with 1 agent'
                          : 'Create group with ${_picked.length} agents',
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AgentTile extends StatelessWidget {
  const _AgentTile({
    required this.agent,
    required this.picked,
    required this.onTap,
  });
  final GroupAgent agent;
  final bool picked;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = DjlColors.of(context);
    return Semantics(
      checked: picked,
      enabled: agent.ready,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(DjlRadius.md),
        child: Opacity(
          opacity: agent.ready ? 1 : .45,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: DjlSpace.sm),
            child: Row(
              children: [
                AgentAvatar(provider: agent.provider, size: 40),
                const SizedBox(width: DjlSpace.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(agent.name, style: theme.textTheme.titleMedium),
                      if (!agent.ready)
                        Text(
                          'Sign in on your Mac to use it',
                          style: theme.textTheme.bodySmall,
                        ),
                    ],
                  ),
                ),
                if (agent.ready)
                  Icon(
                    picked ? DjlIcons.checkCircleFill : DjlIcons.circle,
                    size: 24,
                    color: picked ? colors.ink : colors.inkFaint,
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
