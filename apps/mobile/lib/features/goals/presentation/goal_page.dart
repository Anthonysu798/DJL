import 'dart:async';
import 'package:flutter/material.dart';
import '../domain/thread_goal.dart';
import 'goal_controller.dart';

class GoalPage extends StatefulWidget {
  const GoalPage({
    super.key,
    required this.controller,
    required this.isRunning,
    this.initialDraft,
    this.onObjectiveSubmitted,
  });
  final GoalController controller;
  final bool Function() isRunning;
  final String? initialDraft;
  final ValueChanged<String>? onObjectiveSubmitted;
  @override
  State<GoalPage> createState() => _GoalPageState();
}

class _GoalPageState extends State<GoalPage> {
  final _objective = TextEditingController(), _budget = TextEditingController();
  bool _editing = false, _newGoal = false;
  String? _validation;
  @override
  void initState() {
    super.initState();
    if (widget.initialDraft != null) {
      _objective.text = widget.initialDraft!;
      _editing = true;
      _newGoal = true;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(widget.controller.refresh());
    });
  }

  @override
  void dispose() {
    _objective.dispose();
    _budget.dispose();
    super.dispose();
  }

  void _edit({required bool fresh}) {
    _objective.text = fresh ? '' : widget.controller.goal?.objective ?? '';
    _budget.text = fresh
        ? ''
        : widget.controller.goal?.tokenBudget?.toString() ?? '';
    setState(() {
      _editing = true;
      _newGoal = fresh;
      _validation = null;
    });
  }

  Future<bool> _confirm(String title, String body, String action) async =>
      (await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(title),
          content: Text(body),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(action),
            ),
          ],
        ),
      )) ==
      true;
  Future<void> _save() async {
    final c = widget.controller, existing = c.goal;
    final text = _objective.text.trim(), raw = _budget.text.trim();
    final number = int.tryParse(raw);
    if (text.isEmpty || raw.isNotEmpty && (number == null || number <= 0)) {
      setState(
        () => _validation = text.isEmpty
            ? 'Describe the goal first.'
            : 'Token budget must be a positive whole number.',
      );
      return;
    }
    final fresh = _newGoal || existing == null;
    if (fresh && existing != null && existing.status != GoalStatus.complete) {
      if (!await _confirm(
            'Replace the current goal?',
            'This objective is not complete. Replacing it starts a new goal and resets its usage accounting.',
            'Replace goal',
          ) ||
          !mounted) {
        return;
      }
    }
    final budget = raw.isEmpty
        ? (existing?.tokenBudget != null
              ? const GoalBudgetUpdate.clear()
              : const GoalBudgetUpdate.keep())
        : GoalBudgetUpdate.set(number!);
    FocusManager.instance.primaryFocus?.unfocus();
    if (await c.save(text, startNew: fresh, budget: budget) && mounted) {
      widget.onObjectiveSubmitted?.call(text);
      setState(() {
        _editing = false;
        _newGoal = false;
        _validation = null;
      });
    }
  }

  Future<void> _clear() async {
    if (await _confirm(
          'Clear this goal?',
          'The desktop stops pursuing this objective and clears its progress accounting.',
          'Clear goal',
        ) &&
        mounted) {
      await widget.controller.clear();
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) {
      final c = widget.controller, goal = c.goal;
      final editing = _editing || goal == null;
      return Scaffold(
        appBar: AppBar(
          title: const Text('Goal'),
          actions: [
            IconButton(
              tooltip: 'Reload goal',
              onPressed: c.busy || !c.connected ? null : c.refresh,
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              if (c.busy) const LinearProgressIndicator(),
              if (c.error != null)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Text(
                    c.error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
              if (_validation != null)
                Text(
                  _validation!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              if (!c.connected)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 12),
                  child: Text(
                    'Showing the last known goal. Reconnect to manage it.',
                  ),
                ),
              if (editing) ...[
                Text(
                  _newGoal || goal == null ? 'New goal' : 'Edit goal',
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: 12),
                const Text(
                  'Describe the outcome, how to verify it, and what must not regress.',
                ),
                const SizedBox(height: 16),
                TextField(
                  key: const Key('goal_objective'),
                  controller: _objective,
                  minLines: 3,
                  maxLines: 8,
                  decoration: const InputDecoration(labelText: 'Objective'),
                ),
                const SizedBox(height: 16),
                TextField(
                  key: const Key('goal_budget'),
                  controller: _budget,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Token budget (optional)',
                    helperText: 'Leave empty for no token budget.',
                  ),
                ),
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: c.busy || !c.connected || !c.supported
                      ? null
                      : _save,
                  child: Text(
                    _newGoal || goal == null ? 'Start goal' : 'Save goal',
                  ),
                ),
                if (goal != null)
                  TextButton(
                    onPressed: c.busy
                        ? null
                        : () => setState(() => _editing = false),
                    child: const Text('Cancel editing'),
                  ),
              ] else ...[
                Row(
                  children: [
                    const Icon(Icons.track_changes),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        goal.status.label,
                        style: Theme.of(context).textTheme.headlineSmall,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                SelectableText(
                  goal.objective,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 16),
                Text(
                  goal.tokenBudget == null
                      ? c.elapsed(running: widget.isRunning())
                      : goal.usage,
                ),
                if (goal.tokenBudget != null)
                  Text(
                    '${ThreadGoal.formatTokens(goal.remainingTokens ?? 0)} tokens remaining',
                  ),
                if (goal.status == GoalStatus.active)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 16),
                    child: Text(
                      'The desktop keeps working toward this goal when the chat is idle, until it completes, pauses, or reaches a limit.',
                    ),
                  ),
                const SizedBox(height: 16),
                if (goal.status == GoalStatus.active)
                  OutlinedButton.icon(
                    onPressed: c.busy || !c.connected ? null : c.pause,
                    icon: const Icon(Icons.pause),
                    label: const Text('Pause goal'),
                  ),
                if (goal.status.isResumable)
                  OutlinedButton.icon(
                    onPressed: c.busy || !c.connected ? null : c.resume,
                    icon: const Icon(Icons.play_arrow),
                    label: const Text('Resume goal'),
                  ),
                OutlinedButton.icon(
                  onPressed: c.busy || !c.connected || !c.supported
                      ? null
                      : () => _edit(fresh: goal.status == GoalStatus.complete),
                  icon: const Icon(Icons.edit_outlined),
                  label: Text(
                    goal.status == GoalStatus.complete
                        ? 'New goal'
                        : 'Edit objective',
                  ),
                ),
                TextButton.icon(
                  onPressed: c.busy || !c.connected ? null : _clear,
                  icon: const Icon(Icons.delete_outline),
                  label: const Text('Clear goal'),
                ),
              ],
            ],
          ),
        ),
      );
    },
  );
}
