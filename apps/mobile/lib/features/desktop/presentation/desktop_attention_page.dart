import 'package:flutter/material.dart';
import '../domain/desktop_attention.dart';
import 'desktop_attention_list.dart';
import 'desktop_controller.dart';

class DesktopAttentionPage extends StatefulWidget {
  const DesktopAttentionPage({
    super.key,
    required this.controller,
    required this.isCurrent,
  });
  final DesktopController controller;
  final bool Function() isCurrent;

  @override
  State<DesktopAttentionPage> createState() => _DesktopAttentionPageState();
}

class _DesktopAttentionPageState extends State<DesktopAttentionPage> {
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      leading: const BackButton(key: Key('attention.back')),
      title: const Text('Attention'),
    ),
    body: SafeArea(
      top: false,
      child: ListenableBuilder(
        listenable: widget.controller,
        builder: (context, _) {
          if (!widget.isCurrent()) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  'Connection changed. Go back to reopen Attention.',
                  textAlign: TextAlign.center,
                ),
              ),
            );
          }
          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                child: TextField(
                  key: const Key('attention.search'),
                  controller: _search,
                  autocorrect: false,
                  textCapitalization: TextCapitalization.none,
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(
                    hintText: 'Search attention',
                    prefixIcon: Icon(Icons.search),
                  ),
                ),
              ),
              Expanded(
                child: ListView(
                  key: const Key('attention.list'),
                  padding: const EdgeInsets.fromLTRB(10, 0, 10, 24),
                  keyboardDismissBehavior:
                      ScrollViewKeyboardDismissBehavior.onDrag,
                  children: [
                    DesktopAttentionList(
                      items: filterDesktopAttention(
                        widget.controller.attentionItems,
                        _search.text,
                      ),
                      isFiltering: _search.text.trim().isNotEmpty,
                      onOpen: (item) {
                        if (!mounted ||
                            !widget.isCurrent() ||
                            ModalRoute.of(context)?.isCurrent != true) {
                          return;
                        }
                        Navigator.of(context).pop(item);
                      },
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    ),
  );
}
