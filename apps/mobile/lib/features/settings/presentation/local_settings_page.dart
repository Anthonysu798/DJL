import 'package:flutter/material.dart';
import '../../../core/presentation/djl_frosted.dart';
import '../../desktop/presentation/desktop_controller.dart';
import 'settings_controller.dart';
import 'settings_controls.dart';
import 'settings_group.dart';
import 'device_name_sheet.dart';
import 'paired_usage_card.dart';
import 'archived_chats_page.dart';
import 'about_djl_page.dart';

import '../../../core/design/djl_icons.dart';
import '../../../l10n/l10n.dart';

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

  /// Null hides the DJL Cloud section (builds without Cloud sign-in).
  final VoidCallback? onCloud;
  final VoidCallback onMyMacs;
  final Widget taskStatus;
  final Widget? remoteNotifications;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final background = scheme.brightness == Brightness.dark
        ? Colors.black
        : scheme.surfaceContainerLow;
    final top = MediaQuery.paddingOf(context).top;
    final l10n = context.l10n;
    return Scaffold(
      backgroundColor: background,
      body: Stack(
        children: [
          CustomScrollView(
            slivers: [
              SliverToBoxAdapter(
                child: Padding(
                  padding: EdgeInsets.fromLTRB(20, top + 68, 20, 8),
                  child: Semantics(
                    header: true,
                    child: Text(
                      l10n.settingsTitle,
                      style: settingsTextStyle(
                        context,
                        34,
                        weight: FontWeight.w700,
                        color: scheme.onSurface,
                      ),
                    ),
                  ),
                ),
              ),
              SliverToBoxAdapter(
                child: SafeArea(
                  top: false,
                  bottom: false,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (onCloud case final onCloud?)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 0, 16, 0),
                          child: SettingsGroup(
                            title: 'DJL Cloud',
                            children: [
                              SettingsLinkRow(
                                title: signedIn
                                    ? l10n.settingsOpenCloudChat
                                    : l10n.settingsSignInCloud,
                                subtitle: email ?? l10n.settingsCloudSubtitle,
                                leading: const Icon(DjlIcons.cloud),
                                onTap: onCloud,
                              ),
                            ],
                          ),
                        ),
                      SettingsControls(
                        controller: controller,
                        taskStatus: SettingsGroup(
                          title: l10n.settingsDevicePermissions,
                          // Dividers start under the text, past the icon tile.
                          dividerIndent: 62,
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
                          title: l10n.settingsDevice,
                          children: [
                            DeviceNameTile(desktop: desktop),
                            ListTile(
                              leading: const Icon(DjlIcons.laptop),
                              title: Text(l10n.settingsMyMacs),
                              trailing: const Icon(DjlIcons.chevronRight),
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
                child: SizedBox(
                  height: MediaQuery.paddingOf(context).bottom + 16,
                ),
              ),
            ],
          ),
          // Content fades out under the status bar instead of a solid bar.
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            height: top + 24,
            child: IgnorePointer(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [background, background.withValues(alpha: 0)],
                  ),
                ),
              ),
            ),
          ),
          Positioned(
            top: top + 8,
            left: 16,
            child: const DjlGlassBackButton(key: Key('settings.back')),
          ),
        ],
      ),
    );
  }
}
