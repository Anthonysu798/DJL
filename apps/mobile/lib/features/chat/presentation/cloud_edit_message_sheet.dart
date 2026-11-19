import 'package:flutter/material.dart';

class CloudEditMessageSheet extends StatefulWidget {
  const CloudEditMessageSheet({super.key, required this.original});

  final String original;

  @override
  State<CloudEditMessageSheet> createState() => _CloudEditMessageSheetState();
}

class _CloudEditMessageSheetState extends State<CloudEditMessageSheet> {
  late final _text = TextEditingController(text: widget.original);

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
    child: DraggableScrollableSheet(
      initialChildSize: .5,
      minChildSize: .5,
      maxChildSize: 1,
      snap: true,
      expand: false,
      builder: (context, scroll) => SafeArea(
        top: false,
        child: LayoutBuilder(
          builder: (context, bounds) => SingleChildScrollView(
            controller: scroll,
            physics: const AlwaysScrollableScrollPhysics(),
            child: SizedBox(
              height: bounds.maxHeight,
              child: Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 4,
                      vertical: 4,
                    ),
                    child: Row(
                      children: [
                        TextButton(
                          onPressed: () => Navigator.pop(context),
                          child: const Text(
                            'Cancel',
                            style: TextStyle(fontSize: 17),
                          ),
                        ),
                        const Expanded(
                          child: Text(
                            'Edit message',
                            textAlign: TextAlign.center,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 17,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        ValueListenableBuilder(
                          valueListenable: _text,
                          builder: (context, value, _) => TextButton(
                            onPressed: value.text.trim().isEmpty
                                ? null
                                : () => Navigator.pop(context, value.text),
                            child: const Text(
                              'Send',
                              style: TextStyle(
                                fontSize: 17,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  Expanded(
                    child: TextField(
                      controller: _text,
                      maxLines: null,
                      expands: true,
                      textAlignVertical: TextAlignVertical.top,
                      style: const TextStyle(fontSize: 15, height: 1.2),
                      decoration: const InputDecoration(
                        filled: false,
                        border: InputBorder.none,
                        enabledBorder: InputBorder.none,
                        focusedBorder: InputBorder.none,
                        contentPadding: EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 8,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
