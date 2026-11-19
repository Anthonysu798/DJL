import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class AuthFormScaffold extends StatelessWidget {
  const AuthFormScaffold({
    super.key,
    required this.title,
    required this.children,
  });
  final String title;
  final List<Widget> children;
  @override
  Widget build(BuildContext context) {
    final background = CupertinoColors.systemGroupedBackground.resolveFrom(
      context,
    );
    final row = CupertinoColors.secondarySystemGroupedBackground.resolveFrom(
      context,
    );
    return Scaffold(
      backgroundColor: background,
      appBar: AppBar(
        backgroundColor: background,
        surfaceTintColor: Colors.transparent,
        centerTitle: true,
        toolbarHeight: 44,
        title: Text(
          title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w600,
            height: 1.2,
          ),
        ),
        leadingWidth: 64,
        leading: Padding(
          padding: const EdgeInsets.only(left: 16, right: 4),
          child: IconButton(
            tooltip: MaterialLocalizations.of(context).backButtonTooltip,
            onPressed: () => Navigator.maybePop(context),
            style: IconButton.styleFrom(
              backgroundColor: row,
              foregroundColor: Theme.of(context).colorScheme.onSurface,
            ),
            icon: const Icon(Icons.arrow_back_ios_new, size: 20),
          ),
        ),
      ),
      body: SafeArea(
        top: false,
        child: ListView(
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          padding: const EdgeInsets.fromLTRB(16, 56, 16, 24),
          children: children,
        ),
      ),
    );
  }
}

class AuthFieldGroup extends StatelessWidget {
  const AuthFieldGroup({super.key, required this.children});
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(26),
    child: ColoredBox(
      color: CupertinoColors.secondarySystemGroupedBackground.resolveFrom(
        context,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (var i = 0; i < children.length; i++) ...[
            if (i != 0)
              Divider(
                height: .5,
                thickness: .5,
                indent: 16,
                color: CupertinoColors.separator.resolveFrom(context),
              ),
            children[i],
          ],
        ],
      ),
    ),
  );
}

Widget authTextField({
  required Key fieldKey,
  required TextEditingController controller,
  required String placeholder,
  bool enabled = true,
  bool password = false,
  bool autofocus = false,
  FocusNode? focusNode,
  TextInputType? keyboard,
  Iterable<String>? autofillHints,
  List<TextInputFormatter>? inputFormatters,
}) => Builder(
  builder: (context) => ConstrainedBox(
    constraints: const BoxConstraints(minHeight: 52),
    child: TextField(
      key: fieldKey,
      controller: controller,
      enabled: enabled,
      obscureText: password,
      autofocus: autofocus,
      focusNode: focusNode,
      autocorrect: false,
      textCapitalization: TextCapitalization.none,
      keyboardType: keyboard,
      textInputAction: TextInputAction.newline,
      autofillHints: autofillHints,
      inputFormatters: inputFormatters,
      cursorColor: CupertinoColors.activeBlue.resolveFrom(context),
      style: const TextStyle(fontSize: 17, height: 1.2),
      decoration: InputDecoration(
        hintText: placeholder,
        hintStyle: TextStyle(
          color: CupertinoColors.placeholderText.resolveFrom(context),
        ),
        isDense: true,
        filled: false,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 15,
        ),
        border: InputBorder.none,
        enabledBorder: InputBorder.none,
        focusedBorder: InputBorder.none,
        disabledBorder: InputBorder.none,
      ),
    ),
  ),
);

class AuthFormButton extends StatelessWidget {
  const AuthFormButton({
    super.key,
    this.buttonKey,
    required this.title,
    required this.onPressed,
    this.busy = false,
  });
  final Key? buttonKey;
  final String title;
  final VoidCallback? onPressed;
  final bool busy;
  @override
  Widget build(BuildContext context) => Semantics(
    label: busy ? title : null,
    child: TextButton(
      key: buttonKey,
      onPressed: onPressed,
      style: TextButton.styleFrom(
        splashFactory: NoSplash.splashFactory,
        animationDuration: MediaQuery.disableAnimationsOf(context)
            ? Duration.zero
            : kThemeChangeDuration,
        foregroundColor: Theme.of(context).colorScheme.onSurface,
        disabledForegroundColor: CupertinoColors.tertiaryLabel.resolveFrom(
          context,
        ),
        minimumSize: const Size(double.infinity, 52),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        textStyle: Theme.of(context).textTheme.labelLarge?.copyWith(
          fontSize: 15,
          fontWeight: FontWeight.w600,
          height: 1.2,
        ),
      ),
      child: busy
          ? const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : Text(title, textAlign: TextAlign.center),
    ),
  );
}

class AuthFormFooter extends StatelessWidget {
  const AuthFormFooter(this.text, {super.key, this.error = false});
  final String text;
  final bool error;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
    child: Text(
      text,
      style: TextStyle(
        fontSize: 12,
        color: error
            ? CupertinoColors.systemRed.resolveFrom(context)
            : CupertinoColors.secondaryLabel.resolveFrom(context),
      ),
    ),
  );
}
