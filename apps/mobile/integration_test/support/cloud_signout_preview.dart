// Disposable presentation only: MockClient, memory credentials and no OS grants.
import 'package:flutter/material.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/core/presentation/cloud_chrome.dart';
import 'package:djl_mobile/features/account/presentation/account_page.dart';
import '../../test/features/cloud_account_confirmation_test.dart'
    show AccountFixture;

void main() {
  runApp(const _CloudSignOutPreview());
}

class _CloudSignOutPreview extends StatefulWidget {
  const _CloudSignOutPreview();
  @override
  State<_CloudSignOutPreview> createState() => _CloudSignOutPreviewState();
}

class _CloudSignOutPreviewState extends State<_CloudSignOutPreview> {
  bool _dark = false;
  int _signOuts = 0;

  void _open(BuildContext context) {
    final fixture = AccountFixture();
    showModalBottomSheet<void>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: false,
      barrierColor: Colors.black.withValues(alpha: .18),
      backgroundColor: cloudGroupedBackground(context),
      clipBehavior: Clip.antiAlias,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(38)),
      ),
      constraints: BoxConstraints(
        maxHeight:
            MediaQuery.sizeOf(context).height -
            MediaQuery.viewPaddingOf(context).top,
      ),
      builder: (sheetContext) => AccountPage(
        controller: fixture.controller,
        onSignOut: () async {
          setState(() => _signOuts++);
          Navigator.pop(sheetContext);
        },
        onMyMacs: () => Navigator.pop(sheetContext),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: djlTheme(Brightness.light),
    darkTheme: djlTheme(Brightness.dark),
    themeMode: _dark ? ThemeMode.dark : ThemeMode.light,
    home: Builder(
      builder: (context) => Scaffold(
        body: SafeArea(
          child: Column(
            children: [
              TextButton(
                onPressed: () => _open(context),
                child: const Text('Open Cloud Account fixture'),
              ),
              TextButton(
                onPressed: () => setState(() => _dark = !_dark),
                child: const Text('Fixture theme'),
              ),
              Text('Memory sign-outs: $_signOuts'),
            ],
          ),
        ),
      ),
    ),
  );
}
