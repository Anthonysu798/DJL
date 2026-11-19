import 'package:flutter/material.dart';
import '../domain/subagent_action.dart';

import '../../../core/design/djl_icons.dart';

class SubagentActionCard extends StatefulWidget {
  const SubagentActionCard({
    super.key,
    required this.action,
    required this.changes,
    required this.resolve,
    required this.metadataState,
    required this.onOpen,
    required this.hydrate,
  });
  final SubagentAction action;
  final Listenable changes;
  final SubagentChild Function(SubagentChild) resolve;
  final String? Function(String) metadataState;
  final Future<void> Function(SubagentChild) onOpen;
  final Future<void> Function() hydrate;
  @override
  State<SubagentActionCard> createState() => _SubagentActionCardState();
}

class _SubagentActionCardState extends State<SubagentActionCard> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) widget.hydrate();
    });
  }

  void _details(SubagentChild original) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => FractionallySizedBox(
        heightFactor: .85,
        child: ListenableBuilder(
          listenable: widget.changes,
          builder: (context, _) {
            final child = widget.resolve(original);
            final state = widget.metadataState(child.thread);
            return ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Text(
                  child.label,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                if (child.role != null) Text('Role: ${child.role}'),
                Text('Status: ${child.status}'),
                Text('Thread: ${child.thread}'),
                if (child.agentId != null) Text('Agent: ${child.agentId}'),
                if (child.model != null)
                  Text(
                    '${child.requestedModel ? 'Requested model' : 'Model'}: ${child.model}',
                  ),
                if (state != null && !child.hasIdentity) Text(state),
                if (child.prompt ?? widget.action.prompt
                    case final prompt?) ...[
                  const SizedBox(height: 16),
                  const Text('Instructions'),
                  SelectableText(prompt),
                ],
                if (child.message case final message?) ...[
                  const SizedBox(height: 16),
                  const Text('Latest update'),
                  SelectableText(message),
                ],
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: () {
                    Navigator.pop(context);
                    widget.onOpen(original);
                  },
                  child: const Text('Open child chat'),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final action = widget.action;
    return Card(
      child: ExpansionTile(
        initiallyExpanded: true,
        title: Text(action.title),
        subtitle: Text(action.status),
        leading: const Icon(DjlIcons.branch),
        children: [
          if (action.children.isEmpty)
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text('Child identity unavailable'),
            ),
          for (final original in action.children)
            Builder(
              builder: (context) {
                final child = widget.resolve(original),
                    state = widget.metadataState(original.thread);
                return Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 8, 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        child.label,
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                      if (child.role != null && child.role != child.label)
                        Text(child.role!),
                      Text(child.status),
                      if (child.model != null)
                        Text(
                          '${child.requestedModel ? 'Requested model' : 'Model'}: ${child.model}',
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      if (!child.hasIdentity)
                        Text(state ?? 'Agent identity unknown'),
                      Wrap(
                        spacing: 8,
                        children: [
                          TextButton(
                            onPressed: () => widget.onOpen(original),
                            child: const Text('Open child chat'),
                          ),
                          TextButton(
                            onPressed: () => _details(original),
                            child: const Text('Agent details'),
                          ),
                        ],
                      ),
                      if (child.prompt ?? action.prompt case final prompt?)
                        ExpansionTile(
                          tilePadding: EdgeInsets.zero,
                          title: const Text('Instructions'),
                          children: [
                            Align(
                              alignment: Alignment.centerLeft,
                              child: SelectableText(prompt),
                            ),
                          ],
                        ),
                      if (child.message case final message?)
                        ExpansionTile(
                          tilePadding: EdgeInsets.zero,
                          title: const Text('Latest update'),
                          children: [
                            Align(
                              alignment: Alignment.centerLeft,
                              child: SelectableText(message),
                            ),
                          ],
                        ),
                    ],
                  ),
                );
              },
            ),
        ],
      ),
    );
  }
}
