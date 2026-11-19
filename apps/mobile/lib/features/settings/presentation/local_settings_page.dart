import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/cupertino.dart';
import '../../../core/presentation/djl_glass.dart';
import '../../desktop/presentation/desktop_controller.dart';
import 'settings_controller.dart';
import 'settings_controls.dart';
import 'settings_group.dart';
import 'device_name_sheet.dart';
import 'paired_usage_card.dart';
import 'archived_chats_page.dart';
import 'about_djl_page.dart';

class LocalSettingsPage extends StatelessWidget {
  const LocalSettingsPage({
    super.key,
    required this.controller,
    required this.desktop,
    required this.signedIn,
    required this.onCloud,
    required this.taskStatus,
    required this.onMyMacs,
    this.email,
    this.remoteNotifications,
  });
  final SettingsController controller;
  final DesktopController desktop;
  final bool signedIn;
  final String? email;
  final VoidCallback onCloud, onMyMacs;
  final Widget taskStatus;
  final Widget? remoteNotifications;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final background = scheme.brightness == Brightness.dark
        ? Colors.black
        : scheme.surfaceContainerLow;
    final inlineStyle = settingsTextStyle(
      context,
      17,
      weight: FontWeight.w600,
      color: scheme.onSurface,
    );
    final largeStyle = settingsTextStyle(
      context,
      34,
      weight: FontWeight.w700,
      color: scheme.onSurface,
    );
    final doneStyle = settingsTextStyle(context, 17, color: scheme.onSurface);
    final width = MediaQuery.sizeOf(context).width;
    Size measure(
      String label,
      TextStyle style, {
      double maxWidth = double.infinity,
    }) {
      final painter = TextPainter(
        text: TextSpan(text: label, style: style),
        textDirection: Directionality.of(context),
        textScaler: MediaQuery.textScalerOf(context),
      )..layout(maxWidth: maxWidth);
      final size = painter.size;
      painter.dispose();
      return size;
    }

    final doneText = measure('Done', doneStyle);
    final doneWidth = math.max(64.0, doneText.width + 24);
    final doneHeight = math.max(36.0, doneText.height + 14);
    final inlineTitle = measure('Settings', inlineStyle, maxWidth: width - 32);
    final largeTitle = measure('Settings', largeStyle, maxWidth: width - 32);
    // Keep the source's centered title when it fits beside the actual scaled
    // action. At larger sizes, give the complete title a separate header row.
    final sameRow = inlineTitle.width + 2 * (doneWidth + 28) <= width;
    final toolbarHeight = sameRow
        ? math.max(44.0, math.max(doneHeight, inlineTitle.height) + 8)
        : doneHeight + inlineTitle.height + 24;
    final doneTop = sameRow ? (toolbarHeight - doneHeight) / 2 : 8.0;
    final expandedHeight = math.max(
      106.0,
      doneTop + doneHeight + largeTitle.height + 20,
    );
    return Scaffold(
      backgroundColor: background,
      body: CustomScrollView(
        slivers: [
          SliverAppBar(
            pinned: true,
            automaticallyImplyLeading: false,
            backgroundColor: background,
            surfaceTintColor: Colors.transparent,
            expandedHeight: expandedHeight,
            toolbarHeight: toolbarHeight,
            flexibleSpace: LayoutBuilder(
              builder: (context, constraints) {
                final height =
                    constraints.maxHeight - MediaQuery.paddingOf(context).top;
                final large =
                    height >= doneTop + doneHeight + largeTitle.height + 16;
                return SafeArea(
                  bottom: false,
                  child: Stack(
                    children: [
                      Positioned(
                        top: doneTop,
                        right: 20,
                        child: SizedBox(
                          width: doneWidth,
                          height: doneHeight,
                          child: DjlGlassSurface(
                            radius: 999,
                            useNativeView: false,
                            child: TextButton(
                              style: TextButton.styleFrom(
                                foregroundColor: scheme.onSurface,
                                backgroundColor:
                                    scheme.brightness == Brightness.dark
                                    ? scheme.surfaceContainerLow
                                    : scheme.surface,
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 12,
                                  vertical: 7,
                                ),
                                textStyle: doneStyle,
                              ),
                              onPressed: () => Navigator.pop(context),
                              child: const Text('Done'),
                            ),
                          ),
                        ),
                      ),
                      if (large)
                        Positioned(
                          left: 16,
                          right: 16,
                          bottom: 8,
                          child: Text('Settings', style: largeStyle),
                        )
                      else
                        Positioned(
                          left: sameRow ? doneWidth + 28 : 16,
                          right: sameRow ? doneWidth + 28 : 16,
                          top: sameRow
                              ? (toolbarHeight - inlineTitle.height) / 2
                              : doneTop + doneHeight + 8,
                          child: Text(
                            'Settings',
                            textAlign: TextAlign.center,
                            style: inlineStyle,
                          ),
                        ),
                    ],
                  ),
                );
              },
            ),
          ),
          SliverToBoxAdapter(
            child: SafeArea(
              top: false,
              bottom: false,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 0),
                    child: SettingsGroup(
                      title: 'DJL Cloud',
                      children: [
                        SettingsLinkRow(
                          title: signedIn
                              ? 'Open DJL Cloud chat'
                              : 'Sign in to DJL Cloud',
                          subtitle:
                              email ??
                              'Chat, images, and background tasks without your Mac',
                          leading: const Icon(CupertinoIcons.cloud),
                          onTap: onCloud,
                        ),
                      ],
                    ),
                  ),
                  SettingsControls(
                    controller: controller,
                    taskStatus: SettingsGroup(
                      title: 'Device permissions',
                      children: [taskStatus, ?remoteNotifications],
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: PairedUsageCard(controller: desktop.usage),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: SettingsArchivedChatsCard(desktop: desktop),
                  ),
                  const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 16),
                    child: LocalAboutCard(),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: SettingsGroup(
                      title: 'Device',
                      children: [
                        DeviceNameTile(desktop: desktop),
                        ListTile(
                          leading: const Icon(Icons.laptop_mac),
                          title: const Text('My Macs'),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: onMyMacs,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          SliverToBoxAdapter(
            child: SizedBox(height: MediaQuery.paddingOf(context).bottom + 16),
          ),
        ],
      ),
    );
  }
}
