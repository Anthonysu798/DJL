import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_es.dart';
import 'app_localizations_fr.dart';
import 'app_localizations_ja.dart';
import 'app_localizations_ko.dart';
import 'app_localizations_zh.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('es'),
    Locale('fr'),
    Locale('ja'),
    Locale('ko'),
    Locale('zh'),
    Locale.fromSubtags(languageCode: 'zh', scriptCode: 'Hant'),
  ];

  /// The product name. Never translated.
  ///
  /// In en, this message translates to:
  /// **'DJL'**
  String get appName;

  /// No description provided for @commonCancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get commonCancel;

  /// No description provided for @commonTryAgain.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get commonTryAgain;

  /// No description provided for @chatUiAccessAskTitle.
  ///
  /// In en, this message translates to:
  /// **'Ask for approval'**
  String get chatUiAccessAskTitle;

  /// No description provided for @chatUiAccessAskDetail.
  ///
  /// In en, this message translates to:
  /// **'Always ask to edit external files and use the internet'**
  String get chatUiAccessAskDetail;

  /// No description provided for @chatUiAccessAutoTitle.
  ///
  /// In en, this message translates to:
  /// **'Approve for me'**
  String get chatUiAccessAutoTitle;

  /// No description provided for @chatUiAccessAutoDetail.
  ///
  /// In en, this message translates to:
  /// **'Only ask for actions detected as potentially unsafe'**
  String get chatUiAccessAutoDetail;

  /// No description provided for @chatUiAccessFullTitle.
  ///
  /// In en, this message translates to:
  /// **'Full access'**
  String get chatUiAccessFullTitle;

  /// No description provided for @chatUiAccessFullDetail.
  ///
  /// In en, this message translates to:
  /// **'Full computer access (elevated risk)'**
  String get chatUiAccessFullDetail;

  /// No description provided for @chatUiAccessHint.
  ///
  /// In en, this message translates to:
  /// **'Changes how Codex requests permission'**
  String get chatUiAccessHint;

  /// No description provided for @chatUiAccessFullConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Allow full desktop access?'**
  String get chatUiAccessFullConfirmTitle;

  /// No description provided for @chatUiAccessFullConfirmBody.
  ///
  /// In en, this message translates to:
  /// **'The agent can change files and run commands outside the workspace without asking for approval.'**
  String get chatUiAccessFullConfirmBody;

  /// No description provided for @chatUiAccessFullConfirm.
  ///
  /// In en, this message translates to:
  /// **'Allow full access'**
  String get chatUiAccessFullConfirm;

  /// No description provided for @chatUiAttentionNoMatches.
  ///
  /// In en, this message translates to:
  /// **'No matching attention items'**
  String get chatUiAttentionNoMatches;

  /// No description provided for @chatUiAttentionAllCaughtUp.
  ///
  /// In en, this message translates to:
  /// **'You\'re all caught up'**
  String get chatUiAttentionAllCaughtUp;

  /// No description provided for @chatUiAttentionNoMatchesHint.
  ///
  /// In en, this message translates to:
  /// **'Try a different project, chat, or status.'**
  String get chatUiAttentionNoMatchesHint;

  /// No description provided for @chatUiAttentionEmptyHint.
  ///
  /// In en, this message translates to:
  /// **'Approvals, agent questions, failed runs, and completed work will appear here.'**
  String get chatUiAttentionEmptyHint;

  /// No description provided for @chatUiAttentionNeedsYou.
  ///
  /// In en, this message translates to:
  /// **'NEEDS YOU'**
  String get chatUiAttentionNeedsYou;

  /// No description provided for @chatUiAttentionReadyToReview.
  ///
  /// In en, this message translates to:
  /// **'READY TO REVIEW'**
  String get chatUiAttentionReadyToReview;

  /// No description provided for @chatUiAgoNow.
  ///
  /// In en, this message translates to:
  /// **'now'**
  String get chatUiAgoNow;

  /// No description provided for @chatUiAgoMinutes.
  ///
  /// In en, this message translates to:
  /// **'{minutes}m ago'**
  String chatUiAgoMinutes(int minutes);

  /// No description provided for @chatUiAgoHours.
  ///
  /// In en, this message translates to:
  /// **'{hours}h ago'**
  String chatUiAgoHours(int hours);

  /// No description provided for @chatUiAgoDays.
  ///
  /// In en, this message translates to:
  /// **'{days}d ago'**
  String chatUiAgoDays(int days);

  /// No description provided for @chatUiAttentionTitle.
  ///
  /// In en, this message translates to:
  /// **'Attention'**
  String get chatUiAttentionTitle;

  /// No description provided for @chatUiAttentionConnectionChanged.
  ///
  /// In en, this message translates to:
  /// **'Connection changed. Go back to reopen Attention.'**
  String get chatUiAttentionConnectionChanged;

  /// No description provided for @chatUiAttentionSearch.
  ///
  /// In en, this message translates to:
  /// **'Search attention'**
  String get chatUiAttentionSearch;

  /// No description provided for @appSavedConnectionsUnreadable.
  ///
  /// In en, this message translates to:
  /// **'Saved desktop connection details could not be read. Your saved connections have been kept.'**
  String get appSavedConnectionsUnreadable;

  /// No description provided for @appRestoreMacsFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not restore saved Macs. Unlock your device and retry.'**
  String get appRestoreMacsFailed;

  /// No description provided for @appLinkedConversationFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not open the linked conversation. Check your connection and retry.'**
  String get appLinkedConversationFailed;

  /// No description provided for @appLinkedAccountUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Account details are still unavailable. Retry the linked conversation when they load.'**
  String get appLinkedAccountUnavailable;

  /// No description provided for @appAccountStillLoading.
  ///
  /// In en, this message translates to:
  /// **'Account details are still loading. Please try again.'**
  String get appAccountStillLoading;

  /// No description provided for @appRenameChat.
  ///
  /// In en, this message translates to:
  /// **'Rename chat'**
  String get appRenameChat;

  /// No description provided for @appRenameChatPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Title'**
  String get appRenameChatPlaceholder;

  /// No description provided for @appSave.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get appSave;

  /// No description provided for @appOpenNavigation.
  ///
  /// In en, this message translates to:
  /// **'Open navigation'**
  String get appOpenNavigation;

  /// No description provided for @appAccountUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Account details are unavailable.'**
  String get appAccountUnavailable;

  /// No description provided for @appRetryAccount.
  ///
  /// In en, this message translates to:
  /// **'Retry account'**
  String get appRetryAccount;

  /// No description provided for @appImages.
  ///
  /// In en, this message translates to:
  /// **'Images'**
  String get appImages;

  /// No description provided for @appNotifications.
  ///
  /// In en, this message translates to:
  /// **'Notifications'**
  String get appNotifications;

  /// No description provided for @appRetryLinkedConversation.
  ///
  /// In en, this message translates to:
  /// **'Retry linked conversation'**
  String get appRetryLinkedConversation;

  /// No description provided for @coreBack.
  ///
  /// In en, this message translates to:
  /// **'Back'**
  String get coreBack;

  /// No description provided for @coreMenu.
  ///
  /// In en, this message translates to:
  /// **'Menu'**
  String get coreMenu;

  /// No description provided for @coreChatActions.
  ///
  /// In en, this message translates to:
  /// **'Chat actions'**
  String get coreChatActions;

  /// No description provided for @coreSessionEnded.
  ///
  /// In en, this message translates to:
  /// **'Your session has ended. Please sign in again.'**
  String get coreSessionEnded;

  /// No description provided for @coreCloudRequestFailed.
  ///
  /// In en, this message translates to:
  /// **'DJL Cloud request failed ({status}).'**
  String coreCloudRequestFailed(int status);

  /// No description provided for @coreAccountChanged.
  ///
  /// In en, this message translates to:
  /// **'The account changed.'**
  String get coreAccountChanged;

  /// No description provided for @corePleaseSignIn.
  ///
  /// In en, this message translates to:
  /// **'Please sign in.'**
  String get corePleaseSignIn;

  /// No description provided for @coreNoAccessToken.
  ///
  /// In en, this message translates to:
  /// **'DJL Cloud returned no access token.'**
  String get coreNoAccessToken;

  /// No description provided for @coreCloudTimeout.
  ///
  /// In en, this message translates to:
  /// **'DJL Cloud took too long to respond.'**
  String get coreCloudTimeout;

  /// No description provided for @coreCloudUnreachable.
  ///
  /// In en, this message translates to:
  /// **'Could not reach DJL Cloud. Check your connection.'**
  String get coreCloudUnreachable;

  /// No description provided for @corePleaseSignInAgain.
  ///
  /// In en, this message translates to:
  /// **'Please sign in again.'**
  String get corePleaseSignInAgain;

  /// No description provided for @coreInvalidPushRegistration.
  ///
  /// In en, this message translates to:
  /// **'Invalid notification registration.'**
  String get coreInvalidPushRegistration;

  /// No description provided for @corePushNotAcknowledged.
  ///
  /// In en, this message translates to:
  /// **'Registration was not acknowledged.'**
  String get corePushNotAcknowledged;

  /// No description provided for @coreCloudResponseUnreadable.
  ///
  /// In en, this message translates to:
  /// **'This version could not read the DJL Cloud response.'**
  String get coreCloudResponseUnreadable;

  /// No description provided for @coreInvalidDesktopEnvelope.
  ///
  /// In en, this message translates to:
  /// **'Invalid or replayed desktop envelope.'**
  String get coreInvalidDesktopEnvelope;

  /// No description provided for @coreDesktopMessageUnauthenticated.
  ///
  /// In en, this message translates to:
  /// **'Could not authenticate the desktop message.'**
  String get coreDesktopMessageUnauthenticated;

  /// No description provided for @gitThreadChangedReopenAction.
  ///
  /// In en, this message translates to:
  /// **'Thread activity changed. Reopen this branch or worktree action.'**
  String get gitThreadChangedReopenAction;

  /// No description provided for @gitWaitForThread.
  ///
  /// In en, this message translates to:
  /// **'Wait until this thread finishes before changing branches or worktrees.'**
  String get gitWaitForThread;

  /// No description provided for @gitWaitForOperation.
  ///
  /// In en, this message translates to:
  /// **'Wait for the current Git operation to finish before changing branches or worktrees.'**
  String get gitWaitForOperation;

  /// No description provided for @gitNotRepositorySentence.
  ///
  /// In en, this message translates to:
  /// **'This folder is not a Git repository.'**
  String get gitNotRepositorySentence;

  /// No description provided for @gitNotRepository.
  ///
  /// In en, this message translates to:
  /// **'This folder is not a Git repository'**
  String get gitNotRepository;

  /// No description provided for @gitNoLongerRepository.
  ///
  /// In en, this message translates to:
  /// **'This folder is no longer a Git repository. Refresh before creating a branch or worktree.'**
  String get gitNoLongerRepository;

  /// No description provided for @gitContinue.
  ///
  /// In en, this message translates to:
  /// **'Continue'**
  String get gitContinue;

  /// No description provided for @gitOk.
  ///
  /// In en, this message translates to:
  /// **'OK'**
  String get gitOk;

  /// No description provided for @gitCreate.
  ///
  /// In en, this message translates to:
  /// **'Create'**
  String get gitCreate;

  /// No description provided for @gitClose.
  ///
  /// In en, this message translates to:
  /// **'Close'**
  String get gitClose;

  /// No description provided for @gitDone.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get gitDone;

  /// No description provided for @gitGenerating.
  ///
  /// In en, this message translates to:
  /// **'Generating…'**
  String get gitGenerating;

  /// No description provided for @gitGenerateMessage.
  ///
  /// In en, this message translates to:
  /// **'Generate message'**
  String get gitGenerateMessage;

  /// No description provided for @gitCommitAllTitle.
  ///
  /// In en, this message translates to:
  /// **'Commit all current changes'**
  String get gitCommitAllTitle;

  /// No description provided for @gitCommitPublishTitle.
  ///
  /// In en, this message translates to:
  /// **'Commit and publish changes'**
  String get gitCommitPublishTitle;

  /// No description provided for @gitCommitMessageLabel.
  ///
  /// In en, this message translates to:
  /// **'Commit message'**
  String get gitCommitMessageLabel;

  /// No description provided for @gitPublishBranchTitle.
  ///
  /// In en, this message translates to:
  /// **'Publish this branch?'**
  String get gitPublishBranchTitle;

  /// No description provided for @gitPublishCommitPushBody.
  ///
  /// In en, this message translates to:
  /// **'Commit all current changes and push this branch to its remote.'**
  String get gitPublishCommitPushBody;

  /// No description provided for @gitPublishFeatureBranchPrBody.
  ///
  /// In en, this message translates to:
  /// **'Prepare a feature branch, commit all changes, push the branch, and create a pull request on GitHub.'**
  String get gitPublishFeatureBranchPrBody;

  /// No description provided for @gitPublishCommitPrBody.
  ///
  /// In en, this message translates to:
  /// **'Commit all changes, push the branch, and create a pull request on GitHub.'**
  String get gitPublishCommitPrBody;

  /// No description provided for @gitCommitCreateSwitch.
  ///
  /// In en, this message translates to:
  /// **'Commit, Create & Switch'**
  String get gitCommitCreateSwitch;

  /// No description provided for @gitCreateManagedWorktree.
  ///
  /// In en, this message translates to:
  /// **'Create managed worktree'**
  String get gitCreateManagedWorktree;

  /// No description provided for @gitCreateWorktree.
  ///
  /// In en, this message translates to:
  /// **'Create worktree'**
  String get gitCreateWorktree;

  /// No description provided for @gitBranchName.
  ///
  /// In en, this message translates to:
  /// **'Branch name'**
  String get gitBranchName;

  /// No description provided for @gitBaseBranch.
  ///
  /// In en, this message translates to:
  /// **'Base branch'**
  String get gitBaseBranch;

  /// No description provided for @gitMoveCurrentChanges.
  ///
  /// In en, this message translates to:
  /// **'Move current changes'**
  String get gitMoveCurrentChanges;

  /// No description provided for @gitCopyCurrentChanges.
  ///
  /// In en, this message translates to:
  /// **'Copy current changes'**
  String get gitCopyCurrentChanges;

  /// No description provided for @gitLeaveChangesHere.
  ///
  /// In en, this message translates to:
  /// **'Leave changes here'**
  String get gitLeaveChangesHere;

  /// No description provided for @gitInitializeTitle.
  ///
  /// In en, this message translates to:
  /// **'Initialize Git?'**
  String get gitInitializeTitle;

  /// No description provided for @gitInitializeBody.
  ///
  /// In en, this message translates to:
  /// **'Create a Git repository in this workspace.'**
  String get gitInitializeBody;

  /// No description provided for @gitPushTitle.
  ///
  /// In en, this message translates to:
  /// **'Push branch?'**
  String get gitPushTitle;

  /// No description provided for @gitPushBody.
  ///
  /// In en, this message translates to:
  /// **'Push the committed changes to the configured remote.'**
  String get gitPushBody;

  /// No description provided for @gitLocalChangesNeedAttention.
  ///
  /// In en, this message translates to:
  /// **'Local changes need attention'**
  String get gitLocalChangesNeedAttention;

  /// No description provided for @gitUpdateRepositoryTitle.
  ///
  /// In en, this message translates to:
  /// **'Update repository?'**
  String get gitUpdateRepositoryTitle;

  /// No description provided for @gitDirtyAndBehindBody.
  ///
  /// In en, this message translates to:
  /// **'You have local changes and the remote branch moved ahead. Pull with rebase only if you\'re ready to reconcile those changes.'**
  String get gitDirtyAndBehindBody;

  /// No description provided for @gitPullBody.
  ///
  /// In en, this message translates to:
  /// **'Pull remote commits into this branch.'**
  String get gitPullBody;

  /// No description provided for @gitPullAndRebase.
  ///
  /// In en, this message translates to:
  /// **'Pull & Rebase'**
  String get gitPullAndRebase;

  /// No description provided for @gitUpdate.
  ///
  /// In en, this message translates to:
  /// **'Update'**
  String get gitUpdate;

  /// No description provided for @gitTransferChangesTitle.
  ///
  /// In en, this message translates to:
  /// **'Transfer changes'**
  String get gitTransferChangesTitle;

  /// No description provided for @gitTargetWorkspacePath.
  ///
  /// In en, this message translates to:
  /// **'Target workspace path'**
  String get gitTargetWorkspacePath;

  /// No description provided for @gitRemoveWorktreeTitle.
  ///
  /// In en, this message translates to:
  /// **'Remove this worktree?'**
  String get gitRemoveWorktreeTitle;

  /// No description provided for @gitRemoveWorktreeBody.
  ///
  /// In en, this message translates to:
  /// **'Remove the managed worktree for this branch. The desktop will refuse to remove the main checkout.'**
  String get gitRemoveWorktreeBody;

  /// No description provided for @gitDiscardTitle.
  ///
  /// In en, this message translates to:
  /// **'Discard local changes?'**
  String get gitDiscardTitle;

  /// No description provided for @gitDiscardBody.
  ///
  /// In en, this message translates to:
  /// **'Discard local file changes and reset this branch to its remote.'**
  String get gitDiscardBody;

  /// No description provided for @gitPrDraftTitle.
  ///
  /// In en, this message translates to:
  /// **'Pull request draft'**
  String get gitPrDraftTitle;

  /// No description provided for @gitCopyDraft.
  ///
  /// In en, this message translates to:
  /// **'Copy draft'**
  String get gitCopyDraft;

  /// No description provided for @gitCreatePrTitle.
  ///
  /// In en, this message translates to:
  /// **'Create pull request?'**
  String get gitCreatePrTitle;

  /// No description provided for @gitCreatePrBody.
  ///
  /// In en, this message translates to:
  /// **'The desktop will push this branch if needed, generate a title and description from the committed changes, and create the pull request on GitHub.'**
  String get gitCreatePrBody;

  /// No description provided for @gitNoChangesToShow.
  ///
  /// In en, this message translates to:
  /// **'There are no repository changes to show.'**
  String get gitNoChangesToShow;

  /// No description provided for @gitBranchSwitchFailed.
  ///
  /// In en, this message translates to:
  /// **'Branch Switch Failed'**
  String get gitBranchSwitchFailed;

  /// No description provided for @gitBranchOpenElsewhere.
  ///
  /// In en, this message translates to:
  /// **'Cannot switch branches: this branch is already open in another worktree.'**
  String get gitBranchOpenElsewhere;

  /// No description provided for @gitErrorTitle.
  ///
  /// In en, this message translates to:
  /// **'Git Error'**
  String get gitErrorTitle;

  /// No description provided for @gitOpenPr.
  ///
  /// In en, this message translates to:
  /// **'Open PR'**
  String get gitOpenPr;

  /// No description provided for @gitLoadingChanges.
  ///
  /// In en, this message translates to:
  /// **'Loading changes'**
  String get gitLoadingChanges;

  /// No description provided for @gitLoadingChangesEllipsis.
  ///
  /// In en, this message translates to:
  /// **'Loading changes…'**
  String get gitLoadingChangesEllipsis;

  /// No description provided for @gitChangesUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Changes unavailable'**
  String get gitChangesUnavailable;

  /// No description provided for @gitNoChanges.
  ///
  /// In en, this message translates to:
  /// **'No changes'**
  String get gitNoChanges;

  /// No description provided for @gitDesktopChanged.
  ///
  /// In en, this message translates to:
  /// **'Connected desktop changed. Reopen Git from its workspace.'**
  String get gitDesktopChanged;

  /// No description provided for @gitChooseWorkspace.
  ///
  /// In en, this message translates to:
  /// **'Choose a desktop workspace before using Git.'**
  String get gitChooseWorkspace;

  /// No description provided for @gitWorking.
  ///
  /// In en, this message translates to:
  /// **'Working…'**
  String get gitWorking;

  /// No description provided for @gitRetryStatus.
  ///
  /// In en, this message translates to:
  /// **'Retry Git status'**
  String get gitRetryStatus;

  /// No description provided for @gitWorktreeUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Worktree unavailable'**
  String get gitWorktreeUnavailable;

  /// No description provided for @gitActionsLabel.
  ///
  /// In en, this message translates to:
  /// **'Git actions'**
  String get gitActionsLabel;

  /// No description provided for @gitRefreshStatus.
  ///
  /// In en, this message translates to:
  /// **'Refresh Git status'**
  String get gitRefreshStatus;

  /// No description provided for @gitShowMenu.
  ///
  /// In en, this message translates to:
  /// **'Show menu'**
  String get gitShowMenu;

  /// No description provided for @gitInitializeRepository.
  ///
  /// In en, this message translates to:
  /// **'Initialize repository'**
  String get gitInitializeRepository;

  /// No description provided for @gitCreateBranch.
  ///
  /// In en, this message translates to:
  /// **'Create branch'**
  String get gitCreateBranch;

  /// No description provided for @gitTransferToWorkspace.
  ///
  /// In en, this message translates to:
  /// **'Transfer changes to workspace'**
  String get gitTransferToWorkspace;

  /// No description provided for @gitRemoveManagedWorktree.
  ///
  /// In en, this message translates to:
  /// **'Remove managed worktree'**
  String get gitRemoveManagedWorktree;

  /// No description provided for @gitGeneratePrDraft.
  ///
  /// In en, this message translates to:
  /// **'Generate PR draft'**
  String get gitGeneratePrDraft;

  /// No description provided for @gitCreatePullRequest.
  ///
  /// In en, this message translates to:
  /// **'Create pull request'**
  String get gitCreatePullRequest;

  /// No description provided for @gitCommitAndPushMenu.
  ///
  /// In en, this message translates to:
  /// **'Commit and push'**
  String get gitCommitAndPushMenu;

  /// No description provided for @gitCommitPushCreatePrMenu.
  ///
  /// In en, this message translates to:
  /// **'Commit, push and create PR'**
  String get gitCommitPushCreatePrMenu;

  /// No description provided for @gitDiscardAndReset.
  ///
  /// In en, this message translates to:
  /// **'Discard and reset to remote'**
  String get gitDiscardAndReset;

  /// No description provided for @gitWorktreeReady.
  ///
  /// In en, this message translates to:
  /// **'Worktree ready'**
  String get gitWorktreeReady;

  /// No description provided for @gitOpenChat.
  ///
  /// In en, this message translates to:
  /// **'Open chat'**
  String get gitOpenChat;

  /// No description provided for @gitOpenPullRequest.
  ///
  /// In en, this message translates to:
  /// **'Open pull request'**
  String get gitOpenPullRequest;

  /// No description provided for @gitDetachedHead.
  ///
  /// In en, this message translates to:
  /// **'Detached HEAD'**
  String get gitDetachedHead;

  /// No description provided for @gitNoUpstream.
  ///
  /// In en, this message translates to:
  /// **'No upstream branch'**
  String get gitNoUpstream;

  /// No description provided for @gitAheadBehind.
  ///
  /// In en, this message translates to:
  /// **'{ahead} ahead · {behind} behind'**
  String gitAheadBehind(int ahead, int behind);

  /// No description provided for @gitCommitChanges.
  ///
  /// In en, this message translates to:
  /// **'Commit changes'**
  String get gitCommitChanges;

  /// No description provided for @gitPush.
  ///
  /// In en, this message translates to:
  /// **'Push'**
  String get gitPush;

  /// No description provided for @gitPullTitle.
  ///
  /// In en, this message translates to:
  /// **'Pull changes?'**
  String get gitPullTitle;

  /// No description provided for @gitPull.
  ///
  /// In en, this message translates to:
  /// **'Pull'**
  String get gitPull;

  /// No description provided for @gitViewDiff.
  ///
  /// In en, this message translates to:
  /// **'View diff'**
  String get gitViewDiff;

  /// No description provided for @gitCurrentBranch.
  ///
  /// In en, this message translates to:
  /// **'Current Branch'**
  String get gitCurrentBranch;

  /// No description provided for @gitBranchFallback.
  ///
  /// In en, this message translates to:
  /// **'Branch'**
  String get gitBranchFallback;

  /// No description provided for @gitWriterModel.
  ///
  /// In en, this message translates to:
  /// **'Git writer model'**
  String get gitWriterModel;

  /// No description provided for @gitConnectCodexModel.
  ///
  /// In en, this message translates to:
  /// **'Connect a Codex model on your Mac to generate commit messages and PR drafts.'**
  String get gitConnectCodexModel;

  /// No description provided for @gitChangedFilesCount.
  ///
  /// In en, this message translates to:
  /// **'{count} changed files'**
  String gitChangedFilesCount(int count);

  /// No description provided for @gitActionInitialize.
  ///
  /// In en, this message translates to:
  /// **'Initialize Git'**
  String get gitActionInitialize;

  /// No description provided for @gitActionChanges.
  ///
  /// In en, this message translates to:
  /// **'Changes'**
  String get gitActionChanges;

  /// No description provided for @gitActionCommit.
  ///
  /// In en, this message translates to:
  /// **'Commit'**
  String get gitActionCommit;

  /// No description provided for @gitActionCommitAndPush.
  ///
  /// In en, this message translates to:
  /// **'Commit & Push'**
  String get gitActionCommitAndPush;

  /// No description provided for @gitActionCommitPushPr.
  ///
  /// In en, this message translates to:
  /// **'Commit, Push & PR'**
  String get gitActionCommitPushPr;

  /// No description provided for @gitActionCreatePr.
  ///
  /// In en, this message translates to:
  /// **'Create PR'**
  String get gitActionCreatePr;

  /// No description provided for @gitSectionSetup.
  ///
  /// In en, this message translates to:
  /// **'Setup'**
  String get gitSectionSetup;

  /// No description provided for @gitSectionWrite.
  ///
  /// In en, this message translates to:
  /// **'Write'**
  String get gitSectionWrite;

  /// No description provided for @gitStatusNotInitialized.
  ///
  /// In en, this message translates to:
  /// **'Git is not initialized'**
  String get gitStatusNotInitialized;

  /// No description provided for @gitStatusUpToDate.
  ///
  /// In en, this message translates to:
  /// **'Repository up to date'**
  String get gitStatusUpToDate;

  /// No description provided for @gitStatusAheadOnly.
  ///
  /// In en, this message translates to:
  /// **'Local branch ahead of remote'**
  String get gitStatusAheadOnly;

  /// No description provided for @gitStatusBehindOnly.
  ///
  /// In en, this message translates to:
  /// **'Remote branch ahead of local branch'**
  String get gitStatusBehindOnly;

  /// No description provided for @gitStatusDiverged.
  ///
  /// In en, this message translates to:
  /// **'Local and remote branches diverged'**
  String get gitStatusDiverged;

  /// No description provided for @gitStatusDirty.
  ///
  /// In en, this message translates to:
  /// **'Local repository has uncommitted changes'**
  String get gitStatusDirty;

  /// No description provided for @gitStatusDirtyAndBehind.
  ///
  /// In en, this message translates to:
  /// **'Local changes exist and remote branch moved ahead'**
  String get gitStatusDirtyAndBehind;

  /// No description provided for @gitStatusNoUpstream.
  ///
  /// In en, this message translates to:
  /// **'Branch not published yet'**
  String get gitStatusNoUpstream;

  /// No description provided for @gitStatusDetachedHead.
  ///
  /// In en, this message translates to:
  /// **'Current branch unavailable'**
  String get gitStatusDetachedHead;

  /// No description provided for @gitStatusUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Repository status unavailable'**
  String get gitStatusUnavailable;

  /// No description provided for @gitReviewLocalCommits.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 local commit} other{{count} local commits}}'**
  String gitReviewLocalCommits(int count);

  /// No description provided for @gitReviewTheCurrentBranch.
  ///
  /// In en, this message translates to:
  /// **'the current branch'**
  String get gitReviewTheCurrentBranch;

  /// No description provided for @gitReviewCreatingFrom.
  ///
  /// In en, this message translates to:
  /// **'You\'re creating \'{name}\' from {source}. Carry your local changes onto the new branch, or commit first and then create + switch.'**
  String gitReviewCreatingFrom(String name, String source);

  /// No description provided for @gitReviewCommitsStayPrefix.
  ///
  /// In en, this message translates to:
  /// **'{base} already has {commits} that are not on the remote. Those commits stay on {base}\'s history. {message}'**
  String gitReviewCommitsStayPrefix(
    String base,
    String commits,
    String message,
  );

  /// No description provided for @gitReviewFilesWithChanges.
  ///
  /// In en, this message translates to:
  /// **'Files with local changes:'**
  String get gitReviewFilesWithChanges;

  /// No description provided for @gitReviewMoreFiles.
  ///
  /// In en, this message translates to:
  /// **'+{count} more files'**
  String gitReviewMoreFiles(int count);

  /// No description provided for @gitReviewBringChangesTitle.
  ///
  /// In en, this message translates to:
  /// **'Bring local changes to \'{name}\'?'**
  String gitReviewBringChangesTitle(String name);

  /// No description provided for @gitReviewCarryToNewBranch.
  ///
  /// In en, this message translates to:
  /// **'Carry to New Branch'**
  String get gitReviewCarryToNewBranch;

  /// No description provided for @gitReviewCommitsStayTitle.
  ///
  /// In en, this message translates to:
  /// **'Local commits stay on {base}'**
  String gitReviewCommitsStayTitle(String base);

  /// No description provided for @gitReviewBranchCommitsStay.
  ///
  /// In en, this message translates to:
  /// **'{base} already has {commits} that are not on the remote. Creating \'{name}\' now starts the new branch from the current HEAD, but those commits stay in {base}\'s history.'**
  String gitReviewBranchCommitsStay(String base, String commits, String name);

  /// No description provided for @gitReviewCreateAnyway.
  ///
  /// In en, this message translates to:
  /// **'Create Anyway'**
  String get gitReviewCreateAnyway;

  /// No description provided for @gitReviewManagedWorktreeNoun.
  ///
  /// In en, this message translates to:
  /// **'a managed worktree'**
  String get gitReviewManagedWorktreeNoun;

  /// No description provided for @gitReviewQuotedName.
  ///
  /// In en, this message translates to:
  /// **'\'{name}\''**
  String gitReviewQuotedName(String name);

  /// No description provided for @gitReviewCopyTitle.
  ///
  /// In en, this message translates to:
  /// **'Copy local changes from the current branch'**
  String get gitReviewCopyTitle;

  /// No description provided for @gitReviewMoveTitle.
  ///
  /// In en, this message translates to:
  /// **'Move local changes from the current branch'**
  String get gitReviewMoveTitle;

  /// No description provided for @gitReviewVerbCopy.
  ///
  /// In en, this message translates to:
  /// **'copy'**
  String get gitReviewVerbCopy;

  /// No description provided for @gitReviewVerbMove.
  ///
  /// In en, this message translates to:
  /// **'move'**
  String get gitReviewVerbMove;

  /// No description provided for @gitReviewOnlyCurrentBranch.
  ///
  /// In en, this message translates to:
  /// **'Creating {target} can {verb} local changes only from the current branch. Switch the base branch to \'{current}\' or clean up local changes before creating the worktree.'**
  String gitReviewOnlyCurrentBranch(String target, String verb, String current);

  /// No description provided for @gitReviewCopiedInto.
  ///
  /// In en, this message translates to:
  /// **' Local changes will also be copied into {worktree}; ignored files stay here.'**
  String gitReviewCopiedInto(String worktree);

  /// No description provided for @gitReviewMovedInto.
  ///
  /// In en, this message translates to:
  /// **' Local changes will move into {worktree}; ignored files stay here.'**
  String gitReviewMovedInto(String worktree);

  /// No description provided for @gitReviewTheManagedWorktree.
  ///
  /// In en, this message translates to:
  /// **'the managed worktree'**
  String get gitReviewTheManagedWorktree;

  /// No description provided for @gitReviewTheNewWorktree.
  ///
  /// In en, this message translates to:
  /// **'the new worktree'**
  String get gitReviewTheNewWorktree;

  /// No description provided for @gitReviewWorktreeCommitsStay.
  ///
  /// In en, this message translates to:
  /// **'{base} already has {commits} that are not on the remote. Creating {target} from {from} starts from the current HEAD, but those commits stay in {base}\'s history too.{suffix}'**
  String gitReviewWorktreeCommitsStay(
    String base,
    String commits,
    String target,
    String from,
    String suffix,
  );

  /// No description provided for @gitBadgeOpenWorktree.
  ///
  /// In en, this message translates to:
  /// **'Open worktree'**
  String get gitBadgeOpenWorktree;

  /// No description provided for @gitBadgeOpenElsewhere.
  ///
  /// In en, this message translates to:
  /// **'Open elsewhere'**
  String get gitBadgeOpenElsewhere;

  /// No description provided for @gitActionCompleted.
  ///
  /// In en, this message translates to:
  /// **'Git action completed.'**
  String get gitActionCompleted;

  /// No description provided for @gitActionFailed.
  ///
  /// In en, this message translates to:
  /// **'{error} Refresh before retrying an action whose result is unknown.'**
  String gitActionFailed(String error);

  /// No description provided for @gitDismissMenu.
  ///
  /// In en, this message translates to:
  /// **'Dismiss menu'**
  String get gitDismissMenu;

  /// No description provided for @gitDiffPatch.
  ///
  /// In en, this message translates to:
  /// **'Patch'**
  String get gitDiffPatch;

  /// No description provided for @gitDiffLine.
  ///
  /// In en, this message translates to:
  /// **'Line {line}'**
  String gitDiffLine(int line);

  /// No description provided for @gitDiffLines.
  ///
  /// In en, this message translates to:
  /// **'Lines {first}-{last}'**
  String gitDiffLines(int first, int last);

  /// No description provided for @gitDismissBranchPicker.
  ///
  /// In en, this message translates to:
  /// **'Dismiss branch picker'**
  String get gitDismissBranchPicker;

  /// No description provided for @gitBadgeCurrent.
  ///
  /// In en, this message translates to:
  /// **'Current'**
  String get gitBadgeCurrent;

  /// No description provided for @gitBadgeDefault.
  ///
  /// In en, this message translates to:
  /// **'Default'**
  String get gitBadgeDefault;

  /// No description provided for @gitCloseBranchPicker.
  ///
  /// In en, this message translates to:
  /// **'Close branch picker'**
  String get gitCloseBranchPicker;

  /// No description provided for @gitBranchPickerStale.
  ///
  /// In en, this message translates to:
  /// **'Thread or desktop changed. Close and reopen the branch picker.'**
  String get gitBranchPickerStale;

  /// No description provided for @gitSearchBranches.
  ///
  /// In en, this message translates to:
  /// **'Search branches'**
  String get gitSearchBranches;

  /// No description provided for @gitClearBranchSearch.
  ///
  /// In en, this message translates to:
  /// **'Clear branch search'**
  String get gitClearBranchSearch;

  /// No description provided for @gitBranches.
  ///
  /// In en, this message translates to:
  /// **'Branches'**
  String get gitBranches;

  /// No description provided for @gitNoBranchesFound.
  ///
  /// In en, this message translates to:
  /// **'No branches found'**
  String get gitNoBranchesFound;

  /// No description provided for @gitNoBranchesHint.
  ///
  /// In en, this message translates to:
  /// **'Try a different search or refresh the branch list.'**
  String get gitNoBranchesHint;

  /// No description provided for @gitCreateAndCheckout.
  ///
  /// In en, this message translates to:
  /// **'Create and checkout \'{name}\''**
  String gitCreateAndCheckout(String name);

  /// No description provided for @gitNewBranchEllipsis.
  ///
  /// In en, this message translates to:
  /// **'New branch...'**
  String get gitNewBranchEllipsis;

  /// No description provided for @gitSwitching.
  ///
  /// In en, this message translates to:
  /// **'Switching...'**
  String get gitSwitching;

  /// No description provided for @gitRefreshing.
  ///
  /// In en, this message translates to:
  /// **'Refreshing...'**
  String get gitRefreshing;

  /// No description provided for @gitReloadBranchList.
  ///
  /// In en, this message translates to:
  /// **'Reload branch list'**
  String get gitReloadBranchList;

  /// No description provided for @gitCloseWorktreeReview.
  ///
  /// In en, this message translates to:
  /// **'Close worktree review'**
  String get gitCloseWorktreeReview;

  /// No description provided for @gitHandoffTitle.
  ///
  /// In en, this message translates to:
  /// **'Hand off thread to worktree'**
  String get gitHandoffTitle;

  /// No description provided for @gitForkTitle.
  ///
  /// In en, this message translates to:
  /// **'Fork thread into new worktree'**
  String get gitForkTitle;

  /// No description provided for @gitHandoff.
  ///
  /// In en, this message translates to:
  /// **'Hand off'**
  String get gitHandoff;

  /// No description provided for @gitFork.
  ///
  /// In en, this message translates to:
  /// **'Fork'**
  String get gitFork;

  /// No description provided for @gitHandoffMessage.
  ///
  /// In en, this message translates to:
  /// **'Create and check out a branch in a new worktree to continue in parallel. The branch is normalized with the djl/ prefix.'**
  String get gitHandoffMessage;

  /// No description provided for @gitForkMessage.
  ///
  /// In en, this message translates to:
  /// **'Create and check out a branch in a new worktree, then fork this conversation into that checkout as a new chat.'**
  String get gitForkMessage;

  /// No description provided for @gitStartsFromBase.
  ///
  /// In en, this message translates to:
  /// **'Starts from this base branch.'**
  String get gitStartsFromBase;

  /// No description provided for @gitLoadingWorktreeBranches.
  ///
  /// In en, this message translates to:
  /// **'Loading worktree branches'**
  String get gitLoadingWorktreeBranches;

  /// No description provided for @gitPreparingWorktree.
  ///
  /// In en, this message translates to:
  /// **'Preparing worktree'**
  String get gitPreparingWorktree;

  /// No description provided for @gitNewBranch.
  ///
  /// In en, this message translates to:
  /// **'New branch'**
  String get gitNewBranch;

  /// No description provided for @gitNewBranchBody.
  ///
  /// In en, this message translates to:
  /// **'Branch will be created locally and checked out. Uncommitted changes stay with this working copy.'**
  String get gitNewBranchBody;

  /// No description provided for @gitThreadChangedReopenGit.
  ///
  /// In en, this message translates to:
  /// **'Thread activity changed. Close and reopen this Git action.'**
  String get gitThreadChangedReopenGit;

  /// No description provided for @gitRepositoryChanges.
  ///
  /// In en, this message translates to:
  /// **'Repository Changes'**
  String get gitRepositoryChanges;

  /// No description provided for @gitFilesChanged.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 file changed} other{{count} files changed}}'**
  String gitFilesChanged(int count);

  /// No description provided for @gitExpandAll.
  ///
  /// In en, this message translates to:
  /// **'Expand All'**
  String get gitExpandAll;

  /// No description provided for @gitCollapseAll.
  ///
  /// In en, this message translates to:
  /// **'Collapse All'**
  String get gitCollapseAll;

  /// No description provided for @gitPatchIndex.
  ///
  /// In en, this message translates to:
  /// **'Patch {index} of {total}'**
  String gitPatchIndex(int index, int total);

  /// No description provided for @chatUiComposerOptions.
  ///
  /// In en, this message translates to:
  /// **'Composer options'**
  String get chatUiComposerOptions;

  /// No description provided for @chatUiStopDictation.
  ///
  /// In en, this message translates to:
  /// **'Stop dictation'**
  String get chatUiStopDictation;

  /// No description provided for @chatUiStartDictation.
  ///
  /// In en, this message translates to:
  /// **'Start dictation'**
  String get chatUiStartDictation;

  /// No description provided for @chatUiResumeQueued.
  ///
  /// In en, this message translates to:
  /// **'Resume queued messages'**
  String get chatUiResumeQueued;

  /// No description provided for @chatUiStopTurn.
  ///
  /// In en, this message translates to:
  /// **'Stop turn'**
  String get chatUiStopTurn;

  /// No description provided for @chatUiSendToDesktop.
  ///
  /// In en, this message translates to:
  /// **'Send to desktop'**
  String get chatUiSendToDesktop;

  /// No description provided for @chatUiStartingRun.
  ///
  /// In en, this message translates to:
  /// **'Starting run'**
  String get chatUiStartingRun;

  /// No description provided for @chatUiRemoveImage.
  ///
  /// In en, this message translates to:
  /// **'Remove image'**
  String get chatUiRemoveImage;

  /// No description provided for @chatUiAttachedImage.
  ///
  /// In en, this message translates to:
  /// **'Attached image'**
  String get chatUiAttachedImage;

  /// No description provided for @chatUiDesktopImage.
  ///
  /// In en, this message translates to:
  /// **'Desktop image: {source}'**
  String chatUiDesktopImage(String source);

  /// No description provided for @chatUiImagePreviewUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Image preview unavailable'**
  String get chatUiImagePreviewUnavailable;

  /// No description provided for @chatUiContextSkills.
  ///
  /// In en, this message translates to:
  /// **'Skills'**
  String get chatUiContextSkills;

  /// No description provided for @chatUiContextPlugins.
  ///
  /// In en, this message translates to:
  /// **'Plugins'**
  String get chatUiContextPlugins;

  /// No description provided for @chatUiContextFiles.
  ///
  /// In en, this message translates to:
  /// **'Files'**
  String get chatUiContextFiles;

  /// kind is the Skills/Plugins/Files label
  ///
  /// In en, this message translates to:
  /// **'{kind} are not supported by this desktop runtime.'**
  String chatUiContextUnsupported(String kind);

  /// No description provided for @chatUiContextStale.
  ///
  /// In en, this message translates to:
  /// **'The conversation changed. Reopen the context picker.'**
  String get chatUiContextStale;

  /// No description provided for @chatUiContextRetry.
  ///
  /// In en, this message translates to:
  /// **'Retry discovery'**
  String get chatUiContextRetry;

  /// No description provided for @chatUiContextSearchFilesIn.
  ///
  /// In en, this message translates to:
  /// **'Search files in {path}'**
  String chatUiContextSearchFilesIn(String path);

  /// No description provided for @chatUiContextSelectFolder.
  ///
  /// In en, this message translates to:
  /// **'Select a project folder to search desktop files.'**
  String get chatUiContextSelectFolder;

  /// kind is the lowercased Skills/Plugins/Files label
  ///
  /// In en, this message translates to:
  /// **'No {kind} found.'**
  String chatUiContextNoneFound(String kind);

  /// No description provided for @chatUiAddDesktopContext.
  ///
  /// In en, this message translates to:
  /// **'Add desktop context'**
  String get chatUiAddDesktopContext;

  /// No description provided for @chatUiContextSearchFiles.
  ///
  /// In en, this message translates to:
  /// **'Search files on your desktop'**
  String get chatUiContextSearchFiles;

  /// kind is the lowercased Skills/Plugins label
  ///
  /// In en, this message translates to:
  /// **'Search {kind}'**
  String chatUiContextSearchKind(String kind);

  /// No description provided for @chatUiContextDisabled.
  ///
  /// In en, this message translates to:
  /// **'Disabled on desktop'**
  String get chatUiContextDisabled;

  /// No description provided for @chatUiContextOnDesktop.
  ///
  /// In en, this message translates to:
  /// **'On paired desktop'**
  String get chatUiContextOnDesktop;

  /// No description provided for @chatUiEmptyGeneralTitle.
  ///
  /// In en, this message translates to:
  /// **'What should we work on?'**
  String get chatUiEmptyGeneralTitle;

  /// Text before the folder name in 'What should we do in <folder>?'
  ///
  /// In en, this message translates to:
  /// **'What should we do in '**
  String get chatUiEmptyFolderPrefix;

  /// Text after the folder name in 'What should we do in <folder>?'
  ///
  /// In en, this message translates to:
  /// **'?'**
  String get chatUiEmptyFolderSuffix;

  /// No description provided for @chatUiEmptyGreeting.
  ///
  /// In en, this message translates to:
  /// **'Hi! How can I help you?'**
  String get chatUiEmptyGreeting;

  /// No description provided for @chatUiEncryptedCaption.
  ///
  /// In en, this message translates to:
  /// **'Chats are End-to-end encrypted'**
  String get chatUiEncryptedCaption;

  /// No description provided for @chatUiUserMessage.
  ///
  /// In en, this message translates to:
  /// **'User message'**
  String get chatUiUserMessage;

  /// No description provided for @chatUiAssistantMessage.
  ///
  /// In en, this message translates to:
  /// **'Assistant message'**
  String get chatUiAssistantMessage;

  /// No description provided for @chatUiThreadActions.
  ///
  /// In en, this message translates to:
  /// **'Thread actions'**
  String get chatUiThreadActions;

  /// No description provided for @chatUiBranchesAndWorktrees.
  ///
  /// In en, this message translates to:
  /// **'Branches & worktrees'**
  String get chatUiBranchesAndWorktrees;

  /// No description provided for @chatUiGitActions.
  ///
  /// In en, this message translates to:
  /// **'Git actions'**
  String get chatUiGitActions;

  /// No description provided for @chatUiWorking.
  ///
  /// In en, this message translates to:
  /// **'Working…'**
  String get chatUiWorking;

  /// No description provided for @chatUiScrollToLatest.
  ///
  /// In en, this message translates to:
  /// **'Scroll to latest message'**
  String get chatUiScrollToLatest;

  /// No description provided for @chatUiSavedToPhotos.
  ///
  /// In en, this message translates to:
  /// **'Saved to Photos.'**
  String get chatUiSavedToPhotos;

  /// No description provided for @chatUiShareImageFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not share this image. Please try again.'**
  String get chatUiShareImageFailed;

  /// No description provided for @chatUiSaveImageFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not save this image. Please try again.'**
  String get chatUiSaveImageFailed;

  /// No description provided for @chatUiLoadImageFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not load this image.'**
  String get chatUiLoadImageFailed;

  /// No description provided for @chatUiRetry.
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get chatUiRetry;

  /// No description provided for @chatUiImageReopenWorkspace.
  ///
  /// In en, this message translates to:
  /// **'Reconnect or reopen this image from its workspace.'**
  String get chatUiImageReopenWorkspace;

  /// No description provided for @chatUiImageReopenChat.
  ///
  /// In en, this message translates to:
  /// **'Reopen this image from its paired chat.'**
  String get chatUiImageReopenChat;

  /// No description provided for @chatUiOpenImage.
  ///
  /// In en, this message translates to:
  /// **'Open image {name}'**
  String chatUiOpenImage(String name);

  /// No description provided for @chatUiClose.
  ///
  /// In en, this message translates to:
  /// **'Close'**
  String get chatUiClose;

  /// No description provided for @chatUiShare.
  ///
  /// In en, this message translates to:
  /// **'Share'**
  String get chatUiShare;

  /// No description provided for @chatUiSaveToPhotos.
  ///
  /// In en, this message translates to:
  /// **'Save to Photos'**
  String get chatUiSaveToPhotos;

  /// Group heading for models with no provider
  ///
  /// In en, this message translates to:
  /// **'Models'**
  String get chatUiModelsGroup;

  /// No description provided for @chatUiRefreshModels.
  ///
  /// In en, this message translates to:
  /// **'Refresh models'**
  String get chatUiRefreshModels;

  /// No description provided for @chatUiProviderAndModel.
  ///
  /// In en, this message translates to:
  /// **'Provider & model'**
  String get chatUiProviderAndModel;

  /// No description provided for @chatUiDone.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get chatUiDone;

  /// No description provided for @chatUiAllProviders.
  ///
  /// In en, this message translates to:
  /// **'All providers'**
  String get chatUiAllProviders;

  /// No description provided for @chatUiModelsConnectionChanged.
  ///
  /// In en, this message translates to:
  /// **'Connection changed. Reopen model selection.'**
  String get chatUiModelsConnectionChanged;

  /// No description provided for @chatUiLoadingModels.
  ///
  /// In en, this message translates to:
  /// **'Loading models'**
  String get chatUiLoadingModels;

  /// No description provided for @chatUiNoModels.
  ///
  /// In en, this message translates to:
  /// **'No models available'**
  String get chatUiNoModels;

  /// No description provided for @chatUiNoModelsHint.
  ///
  /// In en, this message translates to:
  /// **'Connect a provider in DJL on your computer, then refresh the model list.'**
  String get chatUiNoModelsHint;

  /// No description provided for @chatUiNoMatchingModels.
  ///
  /// In en, this message translates to:
  /// **'No matching models'**
  String get chatUiNoMatchingModels;

  /// No description provided for @chatUiSearchModels.
  ///
  /// In en, this message translates to:
  /// **'Search providers or models'**
  String get chatUiSearchModels;

  /// No description provided for @chatUiClearModelSearch.
  ///
  /// In en, this message translates to:
  /// **'Clear model search'**
  String get chatUiClearModelSearch;

  /// No description provided for @chatUiNavCloudChat.
  ///
  /// In en, this message translates to:
  /// **'Cloud chat'**
  String get chatUiNavCloudChat;

  /// No description provided for @chatUiNavRemote.
  ///
  /// In en, this message translates to:
  /// **'Remote'**
  String get chatUiNavRemote;

  /// No description provided for @chatUiNavSearchFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not search chats.'**
  String get chatUiNavSearchFailed;

  /// No description provided for @chatUiNavRetrySearch.
  ///
  /// In en, this message translates to:
  /// **'Retry search'**
  String get chatUiNavRetrySearch;

  /// No description provided for @chatUiNavSearching.
  ///
  /// In en, this message translates to:
  /// **'Searching chats…'**
  String get chatUiNavSearching;

  /// No description provided for @chatUiNavPinned.
  ///
  /// In en, this message translates to:
  /// **'Pinned'**
  String get chatUiNavPinned;

  /// No description provided for @chatUiNavPinnedEmpty.
  ///
  /// In en, this message translates to:
  /// **'Keep favorite chats close.\nTouch and hold a chat to pin it.'**
  String get chatUiNavPinnedEmpty;

  /// No description provided for @chatUiNavRecent.
  ///
  /// In en, this message translates to:
  /// **'Recent chats'**
  String get chatUiNavRecent;

  /// No description provided for @chatUiNavRecentEmpty.
  ///
  /// In en, this message translates to:
  /// **'Your chats will appear here.'**
  String get chatUiNavRecentEmpty;

  /// No description provided for @chatUiNoMatchingChats.
  ///
  /// In en, this message translates to:
  /// **'No matching chats'**
  String get chatUiNoMatchingChats;

  /// No description provided for @chatUiCloseSearch.
  ///
  /// In en, this message translates to:
  /// **'Close search'**
  String get chatUiCloseSearch;

  /// No description provided for @chatUiSearchChats.
  ///
  /// In en, this message translates to:
  /// **'Search chats'**
  String get chatUiSearchChats;

  /// Short label on the new-chat button
  ///
  /// In en, this message translates to:
  /// **'Chat'**
  String get chatUiChatButton;

  /// No description provided for @chatUiNewChat.
  ///
  /// In en, this message translates to:
  /// **'New chat'**
  String get chatUiNewChat;

  /// No description provided for @chatUiSettings.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get chatUiSettings;

  /// No description provided for @chatUiMoreActions.
  ///
  /// In en, this message translates to:
  /// **'More actions'**
  String get chatUiMoreActions;

  /// No description provided for @chatUiMenuNewChat.
  ///
  /// In en, this message translates to:
  /// **'New Chat'**
  String get chatUiMenuNewChat;

  /// No description provided for @chatUiMenuQuickChat.
  ///
  /// In en, this message translates to:
  /// **'Quick Chat'**
  String get chatUiMenuQuickChat;

  /// No description provided for @chatUiMenuNewProject.
  ///
  /// In en, this message translates to:
  /// **'New Project'**
  String get chatUiMenuNewProject;

  /// No description provided for @chatUiMenuConnections.
  ///
  /// In en, this message translates to:
  /// **'Connections'**
  String get chatUiMenuConnections;

  /// No description provided for @chatUiMenuSecurePairing.
  ///
  /// In en, this message translates to:
  /// **'Secure pairing details'**
  String get chatUiMenuSecurePairing;

  /// No description provided for @chatUiMenuYourMac.
  ///
  /// In en, this message translates to:
  /// **'Your Mac'**
  String get chatUiMenuYourMac;

  /// No description provided for @chatUiMenuActiveChats.
  ///
  /// In en, this message translates to:
  /// **'Active chats'**
  String get chatUiMenuActiveChats;

  /// No description provided for @chatUiArchivedChats.
  ///
  /// In en, this message translates to:
  /// **'Archived chats'**
  String get chatUiArchivedChats;

  /// No description provided for @chatUiMenuRefresh.
  ///
  /// In en, this message translates to:
  /// **'Refresh'**
  String get chatUiMenuRefresh;

  /// No description provided for @chatUiMenuDisconnect.
  ///
  /// In en, this message translates to:
  /// **'Disconnect'**
  String get chatUiMenuDisconnect;

  /// No description provided for @chatUiOpenNavigation.
  ///
  /// In en, this message translates to:
  /// **'Open navigation'**
  String get chatUiOpenNavigation;

  /// No description provided for @chatUiSearchConversations.
  ///
  /// In en, this message translates to:
  /// **'Search conversations'**
  String get chatUiSearchConversations;

  /// No description provided for @chatUiDismissSearch.
  ///
  /// In en, this message translates to:
  /// **'Dismiss search'**
  String get chatUiDismissSearch;

  /// No description provided for @chatUiStatusConnecting.
  ///
  /// In en, this message translates to:
  /// **'Connecting'**
  String get chatUiStatusConnecting;

  /// No description provided for @chatUiStatusDeviceOffline.
  ///
  /// In en, this message translates to:
  /// **'Device offline'**
  String get chatUiStatusDeviceOffline;

  /// No description provided for @chatUiStatusDeviceOfflineSince.
  ///
  /// In en, this message translates to:
  /// **'Asleep or offline since {time}'**
  String chatUiStatusDeviceOfflineSince(String time);

  /// No description provided for @chatUiStatusOffline.
  ///
  /// In en, this message translates to:
  /// **'Offline'**
  String get chatUiStatusOffline;

  /// No description provided for @chatUiConnectionStatus.
  ///
  /// In en, this message translates to:
  /// **'Connection status: {status}'**
  String chatUiConnectionStatus(String status);

  /// No description provided for @chatUiGroups.
  ///
  /// In en, this message translates to:
  /// **'Groups'**
  String get chatUiGroups;

  /// No description provided for @homeTabChats.
  ///
  /// In en, this message translates to:
  /// **'Chats'**
  String get homeTabChats;

  /// No description provided for @chatUiExpandAll.
  ///
  /// In en, this message translates to:
  /// **'Expand all'**
  String get chatUiExpandAll;

  /// No description provided for @chatUiCollapseAll.
  ///
  /// In en, this message translates to:
  /// **'Collapse all'**
  String get chatUiCollapseAll;

  /// No description provided for @chatUiCollapseChildChats.
  ///
  /// In en, this message translates to:
  /// **'Collapse child chats for {title}'**
  String chatUiCollapseChildChats(String title);

  /// No description provided for @chatUiExpandChildChats.
  ///
  /// In en, this message translates to:
  /// **'Expand child chats for {title}'**
  String chatUiExpandChildChats(String title);

  /// No description provided for @chatUiDesktopChatActions.
  ///
  /// In en, this message translates to:
  /// **'Desktop chat actions'**
  String get chatUiDesktopChatActions;

  /// No description provided for @chatUiArchiveProject.
  ///
  /// In en, this message translates to:
  /// **'Archive Project'**
  String get chatUiArchiveProject;

  /// No description provided for @chatUiRemoveFromPhone.
  ///
  /// In en, this message translates to:
  /// **'Remove from Phone'**
  String get chatUiRemoveFromPhone;

  /// No description provided for @chatUiArchiveProjectTitle.
  ///
  /// In en, this message translates to:
  /// **'Archive \"{name}\"?'**
  String chatUiArchiveProjectTitle(String name);

  /// No description provided for @chatUiArchiveProjectBody.
  ///
  /// In en, this message translates to:
  /// **'All active chats in this project will be archived.'**
  String get chatUiArchiveProjectBody;

  /// No description provided for @chatUiRemoveProjectTitle.
  ///
  /// In en, this message translates to:
  /// **'Remove \"{name}\" from this phone?'**
  String chatUiRemoveProjectTitle(String name);

  /// No description provided for @chatUiRemoveProjectBody.
  ///
  /// In en, this message translates to:
  /// **'Chats for this project will be deleted only from DJL on this phone. Nothing is removed from your device or Codex observer.'**
  String get chatUiRemoveProjectBody;

  /// No description provided for @chatUiExpandProject.
  ///
  /// In en, this message translates to:
  /// **'Expand project {name}'**
  String chatUiExpandProject(String name);

  /// No description provided for @chatUiCollapseProject.
  ///
  /// In en, this message translates to:
  /// **'Collapse project {name}'**
  String chatUiCollapseProject(String name);

  /// No description provided for @chatUiNewChatIn.
  ///
  /// In en, this message translates to:
  /// **'New chat in {name}'**
  String chatUiNewChatIn(String name);

  /// No description provided for @chatUiNewGroup.
  ///
  /// In en, this message translates to:
  /// **'New group'**
  String get chatUiNewGroup;

  /// Short label on the new-group button
  ///
  /// In en, this message translates to:
  /// **'Group'**
  String get chatUiGroupButton;

  /// No description provided for @chatUiOfflineSavedChats.
  ///
  /// In en, this message translates to:
  /// **'Offline · showing saved chats'**
  String get chatUiOfflineSavedChats;

  /// No description provided for @chatUiReconnect.
  ///
  /// In en, this message translates to:
  /// **'Reconnect'**
  String get chatUiReconnect;

  /// No description provided for @chatUiNoMatchingChatsPeriod.
  ///
  /// In en, this message translates to:
  /// **'No matching chats.'**
  String get chatUiNoMatchingChatsPeriod;

  /// No description provided for @chatUiNoStudioThreads.
  ///
  /// In en, this message translates to:
  /// **'No Studio threads'**
  String get chatUiNoStudioThreads;

  /// No description provided for @chatUiNoProjectChats.
  ///
  /// In en, this message translates to:
  /// **'No project chats'**
  String get chatUiNoProjectChats;

  /// No description provided for @desktopAttentionApproval.
  ///
  /// In en, this message translates to:
  /// **'Approval needed'**
  String get desktopAttentionApproval;

  /// No description provided for @desktopAttentionQuestion.
  ///
  /// In en, this message translates to:
  /// **'Agent has a question'**
  String get desktopAttentionQuestion;

  /// No description provided for @desktopAttentionFailedRun.
  ///
  /// In en, this message translates to:
  /// **'Run failed'**
  String get desktopAttentionFailedRun;

  /// No description provided for @desktopAttentionBlockedGoal.
  ///
  /// In en, this message translates to:
  /// **'Goal needs attention'**
  String get desktopAttentionBlockedGoal;

  /// No description provided for @desktopAttentionCompletedRun.
  ///
  /// In en, this message translates to:
  /// **'Ready to review'**
  String get desktopAttentionCompletedRun;

  /// No description provided for @desktopFailurePermission.
  ///
  /// In en, this message translates to:
  /// **'Review the requested access or change this chat\'s access mode, then retry the run.'**
  String get desktopFailurePermission;

  /// No description provided for @desktopFailureSignIn.
  ///
  /// In en, this message translates to:
  /// **'Sign in again on your Mac, then retry the run.'**
  String get desktopFailureSignIn;

  /// No description provided for @desktopFailureTimeout.
  ///
  /// In en, this message translates to:
  /// **'Check the Mac connection, then retry the run.'**
  String get desktopFailureTimeout;

  /// No description provided for @desktopFailureNetwork.
  ///
  /// In en, this message translates to:
  /// **'Check that the Mac and relay are online, then retry the run.'**
  String get desktopFailureNetwork;

  /// No description provided for @desktopFailureCheck.
  ///
  /// In en, this message translates to:
  /// **'Open the chat to inspect the failing check, fix it, and retry.'**
  String get desktopFailureCheck;

  /// No description provided for @desktopFailureGeneric.
  ///
  /// In en, this message translates to:
  /// **'Open the chat to review the last step, correct the issue, and retry.'**
  String get desktopFailureGeneric;

  /// No description provided for @desktopAttentionAllowCommand.
  ///
  /// In en, this message translates to:
  /// **'Allow Codex to run “{command}”?'**
  String desktopAttentionAllowCommand(String command);

  /// No description provided for @desktopAttentionAwaitingPermission.
  ///
  /// In en, this message translates to:
  /// **'Codex is waiting for permission to continue.'**
  String get desktopAttentionAwaitingPermission;

  /// No description provided for @desktopAttentionAnswerAgent.
  ///
  /// In en, this message translates to:
  /// **'Open the chat to answer the agent.'**
  String get desktopAttentionAnswerAgent;

  /// No description provided for @desktopGoalBlocked.
  ///
  /// In en, this message translates to:
  /// **'The goal is blocked. Open the chat to review what the agent needs.'**
  String get desktopGoalBlocked;

  /// No description provided for @desktopGoalUsageLimited.
  ///
  /// In en, this message translates to:
  /// **'Usage limits paused this goal. Review the chat before resuming it.'**
  String get desktopGoalUsageLimited;

  /// No description provided for @desktopGoalBudgetLimited.
  ///
  /// In en, this message translates to:
  /// **'The goal reached its budget. Review the result before deciding what to do next.'**
  String get desktopGoalBudgetLimited;

  /// No description provided for @desktopRunFinishedReview.
  ///
  /// In en, this message translates to:
  /// **'The run finished. Review the result and any file changes before continuing.'**
  String get desktopRunFinishedReview;

  /// No description provided for @desktopScopeStudio.
  ///
  /// In en, this message translates to:
  /// **'Studio'**
  String get desktopScopeStudio;

  /// No description provided for @desktopScopeProjects.
  ///
  /// In en, this message translates to:
  /// **'Projects'**
  String get desktopScopeProjects;

  /// No description provided for @desktopNoProject.
  ///
  /// In en, this message translates to:
  /// **'No Project'**
  String get desktopNoProject;

  /// No description provided for @desktopGroupPinned.
  ///
  /// In en, this message translates to:
  /// **'Pinned'**
  String get desktopGroupPinned;

  /// No description provided for @desktopUntitledChat.
  ///
  /// In en, this message translates to:
  /// **'Untitled chat'**
  String get desktopUntitledChat;

  /// No description provided for @desktopComposerTooManyImages.
  ///
  /// In en, this message translates to:
  /// **'Choose at most four images.'**
  String get desktopComposerTooManyImages;

  /// No description provided for @desktopContextIncomplete.
  ///
  /// In en, this message translates to:
  /// **'A selected context is incomplete. Remove it and select it again.'**
  String get desktopContextIncomplete;

  /// No description provided for @desktopApproveForMeUnsupported.
  ///
  /// In en, this message translates to:
  /// **'Approve for me is not supported by this runtime. Update Codex on your Mac and retry.'**
  String get desktopApproveForMeUnsupported;

  /// No description provided for @desktopEnterChatName.
  ///
  /// In en, this message translates to:
  /// **'Enter a chat name.'**
  String get desktopEnterChatName;

  /// No description provided for @desktopContextPickerStale.
  ///
  /// In en, this message translates to:
  /// **'Connected desktop changed. Reopen the context picker.'**
  String get desktopContextPickerStale;

  /// No description provided for @desktopNoSkillList.
  ///
  /// In en, this message translates to:
  /// **'The desktop returned no skill list.'**
  String get desktopNoSkillList;

  /// No description provided for @desktopNoPluginList.
  ///
  /// In en, this message translates to:
  /// **'The desktop returned no plugin list.'**
  String get desktopNoPluginList;

  /// No description provided for @desktopNoFileMatches.
  ///
  /// In en, this message translates to:
  /// **'The desktop returned no file matches.'**
  String get desktopNoFileMatches;

  /// No description provided for @desktopPairedDisconnectedOrChanged.
  ///
  /// In en, this message translates to:
  /// **'The paired desktop is disconnected or changed.'**
  String get desktopPairedDisconnectedOrChanged;

  /// No description provided for @desktopPairedChangedRefreshOverview.
  ///
  /// In en, this message translates to:
  /// **'The paired desktop changed. Refresh its overview.'**
  String get desktopPairedChangedRefreshOverview;

  /// No description provided for @desktopPairedChangedRefreshChats.
  ///
  /// In en, this message translates to:
  /// **'The paired desktop changed. Refresh its chats.'**
  String get desktopPairedChangedRefreshChats;

  /// No description provided for @desktopIdentityMismatch.
  ///
  /// In en, this message translates to:
  /// **'The desktop identity or secure protocol does not match the pairing.'**
  String get desktopIdentityMismatch;

  /// No description provided for @desktopHandshakeUnverified.
  ///
  /// In en, this message translates to:
  /// **'The desktop handshake signature could not be verified.'**
  String get desktopHandshakeUnverified;

  /// No description provided for @desktopHandshakeTimedOut.
  ///
  /// In en, this message translates to:
  /// **'Desktop secure handshake timed out.'**
  String get desktopHandshakeTimedOut;

  /// No description provided for @desktopSecureConnectionRefused.
  ///
  /// In en, this message translates to:
  /// **'Desktop refused the secure connection.'**
  String get desktopSecureConnectionRefused;

  /// No description provided for @desktopHandshakeInterrupted.
  ///
  /// In en, this message translates to:
  /// **'Desktop connection interrupted during secure handshake.'**
  String get desktopHandshakeInterrupted;

  /// No description provided for @desktopSecureConnectionRejected.
  ///
  /// In en, this message translates to:
  /// **'Secure desktop connection refused.'**
  String get desktopSecureConnectionRejected;

  /// No description provided for @desktopInvalidFrame.
  ///
  /// In en, this message translates to:
  /// **'Invalid desktop frame.'**
  String get desktopInvalidFrame;

  /// No description provided for @desktopSecureTransportFailed.
  ///
  /// In en, this message translates to:
  /// **'Desktop secure transport failed.'**
  String get desktopSecureTransportFailed;

  /// No description provided for @desktopUnencryptedRejected.
  ///
  /// In en, this message translates to:
  /// **'Unencrypted desktop application traffic was rejected.'**
  String get desktopUnencryptedRejected;

  /// No description provided for @desktopPayloadDecodeFailed.
  ///
  /// In en, this message translates to:
  /// **'Unable to decode part of the desktop payload.'**
  String get desktopPayloadDecodeFailed;

  /// No description provided for @desktopRequestFailed.
  ///
  /// In en, this message translates to:
  /// **'Desktop request failed.'**
  String get desktopRequestFailed;

  /// No description provided for @desktopIsDisconnected.
  ///
  /// In en, this message translates to:
  /// **'Desktop is disconnected.'**
  String get desktopIsDisconnected;

  /// No description provided for @desktopConnectionChanged.
  ///
  /// In en, this message translates to:
  /// **'Desktop connection changed.'**
  String get desktopConnectionChanged;

  /// No description provided for @desktopRequestTimedOut.
  ///
  /// In en, this message translates to:
  /// **'Desktop request timed out. Its result is unknown; refresh before retrying.'**
  String get desktopRequestTimedOut;

  /// No description provided for @desktopDisconnectedRefresh.
  ///
  /// In en, this message translates to:
  /// **'Desktop disconnected; refresh before retrying an action.'**
  String get desktopDisconnectedRefresh;

  /// No description provided for @desktopVerifiedHostRequired.
  ///
  /// In en, this message translates to:
  /// **'A saved verified host is required.'**
  String get desktopVerifiedHostRequired;

  /// No description provided for @desktopResponseFailed.
  ///
  /// In en, this message translates to:
  /// **'The desktop could not complete this response. Check its provider settings and retry.'**
  String get desktopResponseFailed;

  /// No description provided for @desktopWaitBeforeMovingProject.
  ///
  /// In en, this message translates to:
  /// **'Wait for the current chat operation before moving its project.'**
  String get desktopWaitBeforeMovingProject;

  /// No description provided for @desktopProviderUnavailable.
  ///
  /// In en, this message translates to:
  /// **'The provider for this conversation is unavailable. Connect it on your desktop or choose another provider.'**
  String get desktopProviderUnavailable;

  /// No description provided for @desktopReopenBeforeRestore.
  ///
  /// In en, this message translates to:
  /// **'Reopen this chat to verify the turn before restoring changes.'**
  String get desktopReopenBeforeRestore;

  /// No description provided for @desktopSwitchCancelled.
  ///
  /// In en, this message translates to:
  /// **'Switch cancelled. Choose a device to reconnect.'**
  String get desktopSwitchCancelled;

  /// No description provided for @desktopSelectionClearUnconfirmed.
  ///
  /// In en, this message translates to:
  /// **'Could not confirm the saved selection was cleared. Unlock your device and choose a saved Mac to recover.'**
  String get desktopSelectionClearUnconfirmed;

  /// No description provided for @desktopLinkIdentityUnavailable.
  ///
  /// In en, this message translates to:
  /// **'The saved Mac identity for this link is unavailable. Open the chat from a verified Mac.'**
  String get desktopLinkIdentityUnavailable;

  /// No description provided for @desktopChooseMatchingMac.
  ///
  /// In en, this message translates to:
  /// **'Choose the saved Mac matching this link. Its verified identity must match.'**
  String get desktopChooseMatchingMac;

  /// No description provided for @desktopWaitingForMac.
  ///
  /// In en, this message translates to:
  /// **'Waiting for the selected Mac. Retry when it is available.'**
  String get desktopWaitingForMac;

  /// No description provided for @desktopLinkedConversationUnavailable.
  ///
  /// In en, this message translates to:
  /// **'The linked desktop conversation is unavailable.'**
  String get desktopLinkedConversationUnavailable;

  /// No description provided for @desktopLinkedConversationLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not load the linked conversation. Retry on the selected Mac.'**
  String get desktopLinkedConversationLoadFailed;

  /// No description provided for @desktopDevicePreferencesLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not load local device preferences. Unlock your device and retry.'**
  String get desktopDevicePreferencesLoadFailed;

  /// No description provided for @desktopSavedDesktopsOpenFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not open saved desktops. Unlock your device and try again.'**
  String get desktopSavedDesktopsOpenFailed;

  /// No description provided for @desktopModelUnavailable.
  ///
  /// In en, this message translates to:
  /// **'The selected desktop model is unavailable. Choose an available model.'**
  String get desktopModelUnavailable;

  /// No description provided for @desktopStopRunsUnconfirmed.
  ///
  /// In en, this message translates to:
  /// **'Stopping runs could not be confirmed; they may still be running on the other Mac.'**
  String get desktopStopRunsUnconfirmed;

  /// No description provided for @desktopPairingIdentityReadFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not read your secure pairing identity. Unlock your device, then choose Reconnect.'**
  String get desktopPairingIdentityReadFailed;

  /// No description provided for @desktopRuntimeOtherHistory.
  ///
  /// In en, this message translates to:
  /// **'The runtime returned another chat’s history.'**
  String get desktopRuntimeOtherHistory;

  /// No description provided for @desktopLinkedHistoryUnverified.
  ///
  /// In en, this message translates to:
  /// **'Could not verify the linked conversation history.'**
  String get desktopLinkedHistoryUnverified;

  /// No description provided for @desktopIdleChatAndProjectRequired.
  ///
  /// In en, this message translates to:
  /// **'The current idle chat and a valid project are required.'**
  String get desktopIdleChatAndProjectRequired;

  /// No description provided for @desktopProjectChangeUnverified.
  ///
  /// In en, this message translates to:
  /// **'The runtime did not verify this chat’s project change.'**
  String get desktopProjectChangeUnverified;

  /// No description provided for @desktopForkUnidentified.
  ///
  /// In en, this message translates to:
  /// **'The runtime did not identify the created fork. Refresh before trying again.'**
  String get desktopForkUnidentified;

  /// No description provided for @desktopForkNotSeparate.
  ///
  /// In en, this message translates to:
  /// **'The runtime did not create a separate conversation.'**
  String get desktopForkNotSeparate;

  /// No description provided for @desktopForkUnsupported.
  ///
  /// In en, this message translates to:
  /// **'This runtime does not support conversation forks. Update DJL on your desktop and retry.'**
  String get desktopForkUnsupported;

  /// No description provided for @desktopReadSettingsFirst.
  ///
  /// In en, this message translates to:
  /// **'Read saved settings before creating a new chat.'**
  String get desktopReadSettingsFirst;

  /// No description provided for @desktopConnectMacWithModels.
  ///
  /// In en, this message translates to:
  /// **'Connect a Mac with available models before creating a new chat.'**
  String get desktopConnectMacWithModels;

  /// No description provided for @desktopChatCreatedElsewhere.
  ///
  /// In en, this message translates to:
  /// **'The desktop created the chat in another project folder. Your local draft was retained.'**
  String get desktopChatCreatedElsewhere;

  /// No description provided for @desktopDraftContextOtherFolder.
  ///
  /// In en, this message translates to:
  /// **'The draft context belongs to another project folder. Remove it and select context again.'**
  String get desktopDraftContextOtherFolder;

  /// No description provided for @desktopQueuedPlanModelRequired.
  ///
  /// In en, this message translates to:
  /// **'Choose an available model that supports Plan mode before sending this queued draft.'**
  String get desktopQueuedPlanModelRequired;

  /// No description provided for @desktopChooseModelFirst.
  ///
  /// In en, this message translates to:
  /// **'Choose an available desktop model first.'**
  String get desktopChooseModelFirst;

  /// No description provided for @desktopRunChangedBeforeQueue.
  ///
  /// In en, this message translates to:
  /// **'The active run changed before queued delivery. Refresh before resuming.'**
  String get desktopRunChangedBeforeQueue;

  /// No description provided for @desktopRunChangedBeforeSteer.
  ///
  /// In en, this message translates to:
  /// **'The active run changed. Refresh before steering again.'**
  String get desktopRunChangedBeforeSteer;

  /// No description provided for @desktopModelBeforeLeavingPlan.
  ///
  /// In en, this message translates to:
  /// **'Choose an available model before leaving Plan mode.'**
  String get desktopModelBeforeLeavingPlan;

  /// No description provided for @desktopPlanModeUnsupported.
  ///
  /// In en, this message translates to:
  /// **'Plan mode is not supported by this runtime. Sent as a normal turn instead.'**
  String get desktopPlanModeUnsupported;

  /// No description provided for @desktopRunIdPending.
  ///
  /// In en, this message translates to:
  /// **'The active run has not published its ID yet. Try again in a moment.'**
  String get desktopRunIdPending;

  /// No description provided for @desktopRuntimeOtherTurnPage.
  ///
  /// In en, this message translates to:
  /// **'The runtime returned another chat’s turn page.'**
  String get desktopRuntimeOtherTurnPage;

  /// No description provided for @desktopRuntimeNoTurnState.
  ///
  /// In en, this message translates to:
  /// **'The runtime did not return this chat’s turn state.'**
  String get desktopRuntimeNoTurnState;

  /// No description provided for @desktopRuntimeInvalidTurnState.
  ///
  /// In en, this message translates to:
  /// **'The runtime returned an invalid turn state.'**
  String get desktopRuntimeInvalidTurnState;

  /// No description provided for @desktopRetryApprovalUnacknowledged.
  ///
  /// In en, this message translates to:
  /// **'Desktop did not acknowledge retry approval.'**
  String get desktopRetryApprovalUnacknowledged;

  /// No description provided for @desktopDeviceFallbackName.
  ///
  /// In en, this message translates to:
  /// **'Device'**
  String get desktopDeviceFallbackName;

  /// No description provided for @desktopDeviceChangeUnconfirmed.
  ///
  /// In en, this message translates to:
  /// **'Could not confirm the change. Review the saved name and retry. If this device was forgotten or replaced, close and reopen the editor.'**
  String get desktopDeviceChangeUnconfirmed;

  /// No description provided for @desktopPreferencesReloadFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not confirm or reload local preferences. Unlock your device and retry before saving again.'**
  String get desktopPreferencesReloadFailed;

  /// No description provided for @desktopRunChangedBeforePlan.
  ///
  /// In en, this message translates to:
  /// **'The active run changed. Refresh before implementing this plan.'**
  String get desktopRunChangedBeforePlan;

  /// No description provided for @desktopQueueMessageArrived.
  ///
  /// In en, this message translates to:
  /// **'The message arrived. Review its result before resuming queued messages.'**
  String get desktopQueueMessageArrived;

  /// No description provided for @desktopQueueDeliveryUnconfirmed.
  ///
  /// In en, this message translates to:
  /// **'Queued delivery was not confirmed. Reopen this chat before retrying.'**
  String get desktopQueueDeliveryUnconfirmed;

  /// No description provided for @desktopRequestFromEarlierSession.
  ///
  /// In en, this message translates to:
  /// **'This request belongs to an earlier desktop session. Refresh the chat.'**
  String get desktopRequestFromEarlierSession;

  /// No description provided for @desktopUndoReconnect.
  ///
  /// In en, this message translates to:
  /// **'Reconnect to your desktop before reviewing undo.'**
  String get desktopUndoReconnect;

  /// No description provided for @desktopUndoReopen.
  ///
  /// In en, this message translates to:
  /// **'Reopen this chat to verify the response before undoing changes.'**
  String get desktopUndoReopen;

  /// No description provided for @desktopUndoRepoBusy.
  ///
  /// In en, this message translates to:
  /// **'A chat in this repository is running. Wait before undoing a response.'**
  String get desktopUndoRepoBusy;

  /// No description provided for @desktopUndoWaitResponse.
  ///
  /// In en, this message translates to:
  /// **'Wait for the active response before undoing changes.'**
  String get desktopUndoWaitResponse;

  /// No description provided for @desktopUndoPersistFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not persist the undo result.'**
  String get desktopUndoPersistFailed;

  /// No description provided for @desktopUndoRepoUnverified.
  ///
  /// In en, this message translates to:
  /// **'Could not verify the response repository. Reconnect and review it again.'**
  String get desktopUndoRepoUnverified;

  /// No description provided for @desktopReconnectToRefreshModels.
  ///
  /// In en, this message translates to:
  /// **'Reconnect the desktop to refresh models.'**
  String get desktopReconnectToRefreshModels;

  /// No description provided for @desktopAccessModeNotApplied.
  ///
  /// In en, this message translates to:
  /// **'Desktop did not apply the requested access mode.'**
  String get desktopAccessModeNotApplied;

  /// No description provided for @desktopSubagentOfflineCached.
  ///
  /// In en, this message translates to:
  /// **'Offline · cached details'**
  String get desktopSubagentOfflineCached;

  /// No description provided for @desktopSubagentLoading.
  ///
  /// In en, this message translates to:
  /// **'Loading agent details'**
  String get desktopSubagentLoading;

  /// No description provided for @desktopSubagentLoaded.
  ///
  /// In en, this message translates to:
  /// **'Details loaded'**
  String get desktopSubagentLoaded;

  /// No description provided for @desktopSubagentIdentityUnknown.
  ///
  /// In en, this message translates to:
  /// **'Agent identity unknown'**
  String get desktopSubagentIdentityUnknown;

  /// No description provided for @desktopSubagentLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not load agent details'**
  String get desktopSubagentLoadFailed;

  /// No description provided for @desktopSavedDeviceChanged.
  ///
  /// In en, this message translates to:
  /// **'This saved device changed. Choose it again.'**
  String get desktopSavedDeviceChanged;

  /// No description provided for @desktopMacIdentityMismatch.
  ///
  /// In en, this message translates to:
  /// **'The selected Mac identity did not match.'**
  String get desktopMacIdentityMismatch;

  /// No description provided for @desktopOfflineChatsOpenFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not open offline chats. Unlock your device or reconnect to load them.'**
  String get desktopOfflineChatsOpenFailed;

  /// No description provided for @desktopOfflineChatsSaveFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not save offline chats. Unlock your device and try again.'**
  String get desktopOfflineChatsSaveFailed;

  /// No description provided for @desktopChoosePairedDesktop.
  ///
  /// In en, this message translates to:
  /// **'Choose a paired desktop.'**
  String get desktopChoosePairedDesktop;

  /// No description provided for @desktopSavedLocallyUnconfirmed.
  ///
  /// In en, this message translates to:
  /// **'Saved on this device. The change on your desktop could not be confirmed; refresh before retrying.'**
  String get desktopSavedLocallyUnconfirmed;

  /// No description provided for @desktopImageEmptyOrTooLarge.
  ///
  /// In en, this message translates to:
  /// **'The selected image is empty or too large. Choose a smaller image.'**
  String get desktopImageEmptyOrTooLarge;

  /// No description provided for @desktopImageUnsupported.
  ///
  /// In en, this message translates to:
  /// **'The selected file is not a supported image.'**
  String get desktopImageUnsupported;

  /// No description provided for @desktopImageResizeFailed.
  ///
  /// In en, this message translates to:
  /// **'This device could not resize the image. Choose an image no larger than 1600 pixels.'**
  String get desktopImageResizeFailed;

  /// No description provided for @desktopImageTooLarge.
  ///
  /// In en, this message translates to:
  /// **'The selected image is too large. Choose a smaller image.'**
  String get desktopImageTooLarge;

  /// No description provided for @desktopContextFolderChanged.
  ///
  /// In en, this message translates to:
  /// **'The project folder changed. Remove existing context or return to its original folder.'**
  String get desktopContextFolderChanged;

  /// No description provided for @desktopPickerOpenFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not open the picker. Please try again.'**
  String get desktopPickerOpenFailed;

  /// No description provided for @desktopWorktreeStale.
  ///
  /// In en, this message translates to:
  /// **'The connected desktop or chat changed. Reopen this worktree action.'**
  String get desktopWorktreeStale;

  /// No description provided for @desktopNotGitRepository.
  ///
  /// In en, this message translates to:
  /// **'This folder is no longer a Git repository.'**
  String get desktopNotGitRepository;

  /// No description provided for @desktopBranchAlreadyExists.
  ///
  /// In en, this message translates to:
  /// **'Branch Already Exists'**
  String get desktopBranchAlreadyExists;

  /// No description provided for @desktopWorktreeUnidentified.
  ///
  /// In en, this message translates to:
  /// **'The desktop did not identify a new worktree. Refresh before trying again.'**
  String get desktopWorktreeUnidentified;

  /// No description provided for @desktopForkUnverified.
  ///
  /// In en, this message translates to:
  /// **'The fork result could not be verified.'**
  String get desktopForkUnverified;

  /// No description provided for @desktopHandoffUnverified.
  ///
  /// In en, this message translates to:
  /// **'The desktop did not verify the handoff destination. Check both folders before retrying.'**
  String get desktopHandoffUnverified;

  /// No description provided for @desktopWorktreePathUnavailable.
  ///
  /// In en, this message translates to:
  /// **'The worktree path is unavailable.'**
  String get desktopWorktreePathUnavailable;

  /// No description provided for @desktopLocalCheckoutUnresolved.
  ///
  /// In en, this message translates to:
  /// **'Could not resolve the paired Local checkout for this worktree.'**
  String get desktopLocalCheckoutUnresolved;

  /// No description provided for @desktopWorktreeHandoffFailed.
  ///
  /// In en, this message translates to:
  /// **'Worktree Handoff Failed'**
  String get desktopWorktreeHandoffFailed;

  /// No description provided for @desktopWorktreeForkFailed.
  ///
  /// In en, this message translates to:
  /// **'Worktree Fork Failed'**
  String get desktopWorktreeForkFailed;

  /// No description provided for @desktopAccessModeNotAppliedBy.
  ///
  /// In en, this message translates to:
  /// **'{method} did not apply the selected access mode.'**
  String desktopAccessModeNotAppliedBy(String method);

  /// No description provided for @desktopApprovalReviewerNotApplied.
  ///
  /// In en, this message translates to:
  /// **'{method} did not apply the selected approval reviewer.'**
  String desktopApprovalReviewerNotApplied(String method);

  /// No description provided for @desktopApprovalPolicyNotApplied.
  ///
  /// In en, this message translates to:
  /// **'{method} did not apply the selected approval policy.'**
  String desktopApprovalPolicyNotApplied(String method);

  /// No description provided for @desktopSandboxNotApplied.
  ///
  /// In en, this message translates to:
  /// **'{method} did not apply the selected sandbox permissions.'**
  String desktopSandboxNotApplied(String method);

  /// No description provided for @desktopForkResultUnknown.
  ///
  /// In en, this message translates to:
  /// **'{error} The fork result may be unknown. Refresh before trying again.'**
  String desktopForkResultUnknown(String error);

  /// No description provided for @desktopSendResultUnknown.
  ///
  /// In en, this message translates to:
  /// **'{error} The send result may be unknown. Refresh the conversation before trying again.'**
  String desktopSendResultUnknown(String error);

  /// No description provided for @desktopQueuePaused.
  ///
  /// In en, this message translates to:
  /// **'Queue paused: {reason}'**
  String desktopQueuePaused(String reason);

  /// No description provided for @desktopWorktreeExists.
  ///
  /// In en, this message translates to:
  /// **'A worktree for \'{branch}\' already exists. Choose a different name.'**
  String desktopWorktreeExists(String branch);

  /// No description provided for @desktopRollbackFailed.
  ///
  /// In en, this message translates to:
  /// **'Tracked changes could not be moved back automatically: {reason}. Check both folders before retrying.'**
  String desktopRollbackFailed(String reason);

  /// No description provided for @desktopWorktreeKeptAt.
  ///
  /// In en, this message translates to:
  /// **'The new worktree was kept at {path}. Check it before trying again.'**
  String desktopWorktreeKeptAt(String path);

  /// No description provided for @desktopWorktreeMayExist.
  ///
  /// In en, this message translates to:
  /// **'A worktree may have been created. It was kept; refresh and inspect it before trying again.'**
  String get desktopWorktreeMayExist;

  /// No description provided for @pairingEnterTenCharCode.
  ///
  /// In en, this message translates to:
  /// **'Enter the ten-character code shown in desktop Remote settings.'**
  String get pairingEnterTenCharCode;

  /// No description provided for @pairingSecureRelayRequired.
  ///
  /// In en, this message translates to:
  /// **'Pairing requires a secure relay URL.'**
  String get pairingSecureRelayRequired;

  /// No description provided for @pairingPairedMac.
  ///
  /// In en, this message translates to:
  /// **'Paired Mac'**
  String get pairingPairedMac;

  /// No description provided for @pairingNotAPairingCode.
  ///
  /// In en, this message translates to:
  /// **'This is not a DJL pairing QR or pasteable code.'**
  String get pairingNotAPairingCode;

  /// No description provided for @pairingUpdateDesktop.
  ///
  /// In en, this message translates to:
  /// **'Update DJL on your desktop: this pairing uses a different protocol.'**
  String get pairingUpdateDesktop;

  /// No description provided for @pairingProofMismatch.
  ///
  /// In en, this message translates to:
  /// **'The pairing code or QR code did not match. Generate a new one and try again.'**
  String get pairingProofMismatch;

  /// No description provided for @pairingInvalidIdentifier.
  ///
  /// In en, this message translates to:
  /// **'Invalid device/session identifier.'**
  String get pairingInvalidIdentifier;

  /// No description provided for @pairingInvalidIdentityKey.
  ///
  /// In en, this message translates to:
  /// **'Invalid desktop identity key.'**
  String get pairingInvalidIdentityKey;

  /// No description provided for @pairingCodeExpired.
  ///
  /// In en, this message translates to:
  /// **'This pairing code has expired. Generate a new code on your Mac.'**
  String get pairingCodeExpired;

  /// No description provided for @pairingPrefsUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Saved device preferences are unavailable.'**
  String get pairingPrefsUnavailable;

  /// No description provided for @pairingDeviceChangedReopen.
  ///
  /// In en, this message translates to:
  /// **'This saved device changed. Close and reopen the editor.'**
  String get pairingDeviceChangedReopen;

  /// No description provided for @pairingRecoverSelectionFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not recover the saved selection. Unlock your device and retry before choosing a Mac.'**
  String get pairingRecoverSelectionFailed;

  /// No description provided for @pairingDeviceChangedChooseAgain.
  ///
  /// In en, this message translates to:
  /// **'The saved device changed. Choose it again.'**
  String get pairingDeviceChangedChooseAgain;

  /// No description provided for @pairingConfirmSavedFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not confirm the selected Mac was saved. Unlock your device and choose a saved Mac to recover.'**
  String get pairingConfirmSavedFailed;

  /// No description provided for @pairingRelayDifferentIdentity.
  ///
  /// In en, this message translates to:
  /// **'The trusted relay returned a different desktop identity. Pair again.'**
  String get pairingRelayDifferentIdentity;

  /// No description provided for @pairingRelayTemporarilyUnavailable.
  ///
  /// In en, this message translates to:
  /// **'The desktop relay is temporarily unavailable.'**
  String get pairingRelayTemporarilyUnavailable;

  /// No description provided for @pairingRelayInvalidResponse.
  ///
  /// In en, this message translates to:
  /// **'The desktop relay returned an invalid response.'**
  String get pairingRelayInvalidResponse;

  /// No description provided for @pairingTrustedComputerOffline.
  ///
  /// In en, this message translates to:
  /// **'The trusted computer is offline.'**
  String get pairingTrustedComputerOffline;

  /// No description provided for @pairingServiceUnavailable.
  ///
  /// In en, this message translates to:
  /// **'The desktop pairing service is unavailable.'**
  String get pairingServiceUnavailable;

  /// No description provided for @pairingRelayUnreachable.
  ///
  /// In en, this message translates to:
  /// **'Could not reach the desktop relay.'**
  String get pairingRelayUnreachable;

  /// No description provided for @pairingRelayUnsupportedMethod.
  ///
  /// In en, this message translates to:
  /// **'The relay does not support this pairing method.'**
  String get pairingRelayUnsupportedMethod;

  /// No description provided for @pairingRelayRequired.
  ///
  /// In en, this message translates to:
  /// **'A relay URL is required.'**
  String get pairingRelayRequired;

  /// No description provided for @pairingEnterOneTimeCode.
  ///
  /// In en, this message translates to:
  /// **'Enter one-time code'**
  String get pairingEnterOneTimeCode;

  /// No description provided for @pairingFindCodeHint.
  ///
  /// In en, this message translates to:
  /// **'Find your code in DJL Desktop under Settings → Remote.'**
  String get pairingFindCodeHint;

  /// No description provided for @pairingCodeLabel.
  ///
  /// In en, this message translates to:
  /// **'Pairing code'**
  String get pairingCodeLabel;

  /// No description provided for @pairingRelayConfigured.
  ///
  /// In en, this message translates to:
  /// **'Relay configured'**
  String get pairingRelayConfigured;

  /// No description provided for @pairingRelaySettings.
  ///
  /// In en, this message translates to:
  /// **'Relay settings'**
  String get pairingRelaySettings;

  /// No description provided for @pairingInProgress.
  ///
  /// In en, this message translates to:
  /// **'Pairing…'**
  String get pairingInProgress;

  /// No description provided for @pairingPair.
  ///
  /// In en, this message translates to:
  /// **'Pair'**
  String get pairingPair;

  /// No description provided for @pairingSecureDetailsTitle.
  ///
  /// In en, this message translates to:
  /// **'Secure pairing details'**
  String get pairingSecureDetailsTitle;

  /// No description provided for @pairingSecureDetailsBody.
  ///
  /// In en, this message translates to:
  /// **'Open DJL desktop → Settings → Remote. Paste its pairing payload, or configure the relay used by your one-time code.'**
  String get pairingSecureDetailsBody;

  /// No description provided for @pairingPasteCode.
  ///
  /// In en, this message translates to:
  /// **'Paste pairing code'**
  String get pairingPasteCode;

  /// No description provided for @pairingPayloadHint.
  ///
  /// In en, this message translates to:
  /// **'RMX1:… or QR JSON'**
  String get pairingPayloadHint;

  /// No description provided for @pairingPairSecurely.
  ///
  /// In en, this message translates to:
  /// **'Pair securely'**
  String get pairingPairSecurely;

  /// No description provided for @pairingRelayUrlLabel.
  ///
  /// In en, this message translates to:
  /// **'Desktop relay URL'**
  String get pairingRelayUrlLabel;

  /// No description provided for @pairingSwitchDeviceTitle.
  ///
  /// In en, this message translates to:
  /// **'Switch device?'**
  String get pairingSwitchDeviceTitle;

  /// No description provided for @pairingSwitchDeviceBody.
  ///
  /// In en, this message translates to:
  /// **'DJL will try to stop in-progress runs on this Mac and reload chats for the other device.'**
  String get pairingSwitchDeviceBody;

  /// No description provided for @pairingSwitch.
  ///
  /// In en, this message translates to:
  /// **'Switch'**
  String get pairingSwitch;

  /// No description provided for @pairingCancellingSwitch.
  ///
  /// In en, this message translates to:
  /// **'Cancelling switch…'**
  String get pairingCancellingSwitch;

  /// No description provided for @pairingSwitchingDevice.
  ///
  /// In en, this message translates to:
  /// **'Switching device…'**
  String get pairingSwitchingDevice;

  /// No description provided for @pairingCancelSwitch.
  ///
  /// In en, this message translates to:
  /// **'Cancel switch'**
  String get pairingCancelSwitch;

  /// No description provided for @pairingChooseMatchingMac.
  ///
  /// In en, this message translates to:
  /// **'Choose the saved Mac matching this link’s verified identity.'**
  String get pairingChooseMatchingMac;

  /// No description provided for @pairingChooseMacForLink.
  ///
  /// In en, this message translates to:
  /// **'Choose a saved Mac to open the linked conversation.'**
  String get pairingChooseMacForLink;

  /// No description provided for @pairingOpeningLinkedConversation.
  ///
  /// In en, this message translates to:
  /// **'Opening linked desktop conversation…'**
  String get pairingOpeningLinkedConversation;

  /// No description provided for @pairingRetryDesktopLink.
  ///
  /// In en, this message translates to:
  /// **'Retry desktop link'**
  String get pairingRetryDesktopLink;

  /// No description provided for @pairingCancelDesktopLink.
  ///
  /// In en, this message translates to:
  /// **'Cancel desktop link'**
  String get pairingCancelDesktopLink;

  /// No description provided for @pairingMatchesLinkIdentity.
  ///
  /// In en, this message translates to:
  /// **'Matches this link’s verified identity'**
  String get pairingMatchesLinkIdentity;

  /// No description provided for @pairingDifferentIdentity.
  ///
  /// In en, this message translates to:
  /// **'Different desktop identity'**
  String get pairingDifferentIdentity;

  /// No description provided for @pairingSavedVerifiedIdentity.
  ///
  /// In en, this message translates to:
  /// **'Saved, verified desktop identity'**
  String get pairingSavedVerifiedIdentity;

  /// No description provided for @pairingReconnect.
  ///
  /// In en, this message translates to:
  /// **'Reconnect'**
  String get pairingReconnect;

  /// No description provided for @pairingConnections.
  ///
  /// In en, this message translates to:
  /// **'Connections'**
  String get pairingConnections;

  /// No description provided for @pairingScanQrCode.
  ///
  /// In en, this message translates to:
  /// **'Scan QR Code'**
  String get pairingScanQrCode;

  /// No description provided for @pairingPairWithCode.
  ///
  /// In en, this message translates to:
  /// **'Pair with Code'**
  String get pairingPairWithCode;

  /// No description provided for @pairingConnectToDesktop.
  ///
  /// In en, this message translates to:
  /// **'Connect to DJL Desktop'**
  String get pairingConnectToDesktop;

  /// No description provided for @pairingChooseSavedMac.
  ///
  /// In en, this message translates to:
  /// **'Choose a saved Mac'**
  String get pairingChooseSavedMac;

  /// No description provided for @pairingFirstPairingHint.
  ///
  /// In en, this message translates to:
  /// **'Open DJL on your Mac or Windows PC, then go to Settings → Remote.'**
  String get pairingFirstPairingHint;

  /// No description provided for @pairingGetDesktop.
  ///
  /// In en, this message translates to:
  /// **'Get DJL for your Mac or PC'**
  String get pairingGetDesktop;

  /// No description provided for @pairingScanTitle.
  ///
  /// In en, this message translates to:
  /// **'Scan DJL desktop QR'**
  String get pairingScanTitle;

  /// No description provided for @pairingCameraDenied.
  ///
  /// In en, this message translates to:
  /// **'Camera access is denied. You can paste the pairing code instead.'**
  String get pairingCameraDenied;

  /// No description provided for @pairingScanUnsupported.
  ///
  /// In en, this message translates to:
  /// **'QR scanning is not available on this device. You can paste the pairing code instead.'**
  String get pairingScanUnsupported;

  /// No description provided for @pairingCameraUnavailable.
  ///
  /// In en, this message translates to:
  /// **'The camera is unavailable. You can paste the pairing code instead.'**
  String get pairingCameraUnavailable;

  /// No description provided for @pairingSwitchDevice.
  ///
  /// In en, this message translates to:
  /// **'Switch device'**
  String get pairingSwitchDevice;

  /// No description provided for @pairingSwitchTo.
  ///
  /// In en, this message translates to:
  /// **'Switch to'**
  String get pairingSwitchTo;

  /// No description provided for @pairingStatusSwitching.
  ///
  /// In en, this message translates to:
  /// **'Switching…'**
  String get pairingStatusSwitching;

  /// No description provided for @pairingStatusConnected.
  ///
  /// In en, this message translates to:
  /// **'Connected'**
  String get pairingStatusConnected;

  /// No description provided for @pairingStatusSelected.
  ///
  /// In en, this message translates to:
  /// **'Selected'**
  String get pairingStatusSelected;

  /// No description provided for @pairingStatusPrevious.
  ///
  /// In en, this message translates to:
  /// **'Previous'**
  String get pairingStatusPrevious;

  /// No description provided for @pairingStatusSaved.
  ///
  /// In en, this message translates to:
  /// **'Saved'**
  String get pairingStatusSaved;

  /// No description provided for @pairingForget.
  ///
  /// In en, this message translates to:
  /// **'Forget'**
  String get pairingForget;

  /// No description provided for @pairingForgetDeviceTitle.
  ///
  /// In en, this message translates to:
  /// **'Forget this device?'**
  String get pairingForgetDeviceTitle;

  /// No description provided for @pairingForgetDeviceBody.
  ///
  /// In en, this message translates to:
  /// **'{name} will be removed from this phone. Scan its QR code again to reconnect.'**
  String pairingForgetDeviceBody(String name);

  /// No description provided for @pairingActiveBadge.
  ///
  /// In en, this message translates to:
  /// **'Active'**
  String get pairingActiveBadge;

  /// No description provided for @pairingShowInMenu.
  ///
  /// In en, this message translates to:
  /// **'Show {name} in device menu'**
  String pairingShowInMenu(String name);

  /// No description provided for @pairingMenuVisibilityUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Menu visibility unavailable'**
  String get pairingMenuVisibilityUnavailable;

  /// No description provided for @pairingClose.
  ///
  /// In en, this message translates to:
  /// **'Close'**
  String get pairingClose;

  /// No description provided for @pairingActiveDevice.
  ///
  /// In en, this message translates to:
  /// **'Active device'**
  String get pairingActiveDevice;

  /// No description provided for @pairingActiveDeviceNamed.
  ///
  /// In en, this message translates to:
  /// **'Active device, {name}'**
  String pairingActiveDeviceNamed(String name);

  /// No description provided for @pairingDevicesInMenu.
  ///
  /// In en, this message translates to:
  /// **'{count} devices in menu'**
  String pairingDevicesInMenu(int count);

  /// No description provided for @pairingDevices.
  ///
  /// In en, this message translates to:
  /// **'Devices'**
  String get pairingDevices;

  /// No description provided for @pairingNoDevices.
  ///
  /// In en, this message translates to:
  /// **'No paired devices yet.'**
  String get pairingNoDevices;

  /// No description provided for @pairingScanQr.
  ///
  /// In en, this message translates to:
  /// **'Scan QR'**
  String get pairingScanQr;

  /// No description provided for @pairingForgetDesktop.
  ///
  /// In en, this message translates to:
  /// **'Forget desktop'**
  String get pairingForgetDesktop;

  /// No description provided for @pairingRecencyNow.
  ///
  /// In en, this message translates to:
  /// **'now'**
  String get pairingRecencyNow;

  /// No description provided for @pairingRecencyMinutes.
  ///
  /// In en, this message translates to:
  /// **'{count}m'**
  String pairingRecencyMinutes(int count);

  /// No description provided for @pairingRecencyHours.
  ///
  /// In en, this message translates to:
  /// **'{count}h'**
  String pairingRecencyHours(int count);

  /// No description provided for @pairingRecencyDays.
  ///
  /// In en, this message translates to:
  /// **'{count}d'**
  String pairingRecencyDays(int count);

  /// No description provided for @pairingRecencyAgo.
  ///
  /// In en, this message translates to:
  /// **'{age} ago'**
  String pairingRecencyAgo(String age);

  /// No description provided for @pairingRecencyIn.
  ///
  /// In en, this message translates to:
  /// **'in {age}'**
  String pairingRecencyIn(String age);

  /// No description provided for @chatUiCloseNavigation.
  ///
  /// In en, this message translates to:
  /// **'Close navigation'**
  String get chatUiCloseNavigation;

  /// No description provided for @chatUiRuntime.
  ///
  /// In en, this message translates to:
  /// **'Runtime'**
  String get chatUiRuntime;

  /// No description provided for @chatUiContinueIn.
  ///
  /// In en, this message translates to:
  /// **'Continue in'**
  String get chatUiContinueIn;

  /// No description provided for @chatUiLocal.
  ///
  /// In en, this message translates to:
  /// **'Local'**
  String get chatUiLocal;

  /// No description provided for @chatUiWorktree.
  ///
  /// In en, this message translates to:
  /// **'Worktree'**
  String get chatUiWorktree;

  /// No description provided for @chatUiCurrentBranch.
  ///
  /// In en, this message translates to:
  /// **'Current Branch'**
  String get chatUiCurrentBranch;

  /// No description provided for @chatUiCollapseProjectControls.
  ///
  /// In en, this message translates to:
  /// **'Collapse project controls'**
  String get chatUiCollapseProjectControls;

  /// No description provided for @chatUiExpandProjectControls.
  ///
  /// In en, this message translates to:
  /// **'Expand project controls'**
  String get chatUiExpandProjectControls;

  /// No description provided for @chatUiQueuedMessages.
  ///
  /// In en, this message translates to:
  /// **'Queued messages'**
  String get chatUiQueuedMessages;

  /// No description provided for @chatUiQueuedHint.
  ///
  /// In en, this message translates to:
  /// **'Shows the queued follow-ups in a sheet'**
  String get chatUiQueuedHint;

  /// No description provided for @chatUiQueued.
  ///
  /// In en, this message translates to:
  /// **'Queued'**
  String get chatUiQueued;

  /// No description provided for @chatUiQueuedNeedsPlanModel.
  ///
  /// In en, this message translates to:
  /// **'Choose a model that supports Plan mode before moving this draft into the input.'**
  String get chatUiQueuedNeedsPlanModel;

  /// No description provided for @chatUiImageCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 image} other{{count} images}}'**
  String chatUiImageCount(int count);

  /// No description provided for @chatUiAttachedContext.
  ///
  /// In en, this message translates to:
  /// **'Attached context'**
  String get chatUiAttachedContext;

  /// No description provided for @chatUiMoveDraftToInput.
  ///
  /// In en, this message translates to:
  /// **'Move draft into input'**
  String get chatUiMoveDraftToInput;

  /// No description provided for @chatUiSteerQueued.
  ///
  /// In en, this message translates to:
  /// **'Steer queued message'**
  String get chatUiSteerQueued;

  /// No description provided for @chatUiSteer.
  ///
  /// In en, this message translates to:
  /// **'Steer'**
  String get chatUiSteer;

  /// No description provided for @chatUiDeleteQueued.
  ///
  /// In en, this message translates to:
  /// **'Delete queued message'**
  String get chatUiDeleteQueued;

  /// No description provided for @chatUiCopyResponse.
  ///
  /// In en, this message translates to:
  /// **'Copy response'**
  String get chatUiCopyResponse;

  /// No description provided for @chatUiCopied.
  ///
  /// In en, this message translates to:
  /// **'Copied'**
  String get chatUiCopied;

  /// No description provided for @chatUiEffortLow.
  ///
  /// In en, this message translates to:
  /// **'Low'**
  String get chatUiEffortLow;

  /// No description provided for @chatUiEffortMedium.
  ///
  /// In en, this message translates to:
  /// **'Medium'**
  String get chatUiEffortMedium;

  /// No description provided for @chatUiEffortHigh.
  ///
  /// In en, this message translates to:
  /// **'High'**
  String get chatUiEffortHigh;

  /// No description provided for @chatUiEffortExtraHigh.
  ///
  /// In en, this message translates to:
  /// **'Extra High'**
  String get chatUiEffortExtraHigh;

  /// No description provided for @chatUiLoading.
  ///
  /// In en, this message translates to:
  /// **'Loading…'**
  String get chatUiLoading;

  /// No description provided for @chatUiSelectModel.
  ///
  /// In en, this message translates to:
  /// **'Select model'**
  String get chatUiSelectModel;

  /// No description provided for @chatUiModel.
  ///
  /// In en, this message translates to:
  /// **'Model'**
  String get chatUiModel;

  /// No description provided for @chatUiSpeed.
  ///
  /// In en, this message translates to:
  /// **'Speed'**
  String get chatUiSpeed;

  /// No description provided for @chatUiSpeedFast.
  ///
  /// In en, this message translates to:
  /// **'Fast'**
  String get chatUiSpeedFast;

  /// No description provided for @chatUiSpeedNormal.
  ///
  /// In en, this message translates to:
  /// **'Normal'**
  String get chatUiSpeedNormal;

  /// No description provided for @chatUiChatControls.
  ///
  /// In en, this message translates to:
  /// **'Chat controls'**
  String get chatUiChatControls;

  /// No description provided for @chatUiControlsConnectionChanged.
  ///
  /// In en, this message translates to:
  /// **'Connection changed. Reopen chat controls.'**
  String get chatUiControlsConnectionChanged;

  /// No description provided for @chatUiLoadingModelsEllipsis.
  ///
  /// In en, this message translates to:
  /// **'Loading models…'**
  String get chatUiLoadingModelsEllipsis;

  /// No description provided for @chatUiOtherModels.
  ///
  /// In en, this message translates to:
  /// **'Other models…'**
  String get chatUiOtherModels;

  /// No description provided for @chatUiIntelligence.
  ///
  /// In en, this message translates to:
  /// **'Intelligence'**
  String get chatUiIntelligence;

  /// No description provided for @chatUiCopySessionId.
  ///
  /// In en, this message translates to:
  /// **'Copy session ID'**
  String get chatUiCopySessionId;

  /// No description provided for @chatUiRenameChat.
  ///
  /// In en, this message translates to:
  /// **'Rename chat'**
  String get chatUiRenameChat;

  /// No description provided for @chatUiUnpinChat.
  ///
  /// In en, this message translates to:
  /// **'Unpin chat'**
  String get chatUiUnpinChat;

  /// No description provided for @chatUiPinChat.
  ///
  /// In en, this message translates to:
  /// **'Pin chat'**
  String get chatUiPinChat;

  /// No description provided for @chatUiUnarchiveChat.
  ///
  /// In en, this message translates to:
  /// **'Unarchive chat'**
  String get chatUiUnarchiveChat;

  /// No description provided for @chatUiArchiveChat.
  ///
  /// In en, this message translates to:
  /// **'Archive chat'**
  String get chatUiArchiveChat;

  /// No description provided for @chatUiRemoveFromDevice.
  ///
  /// In en, this message translates to:
  /// **'Remove from this device'**
  String get chatUiRemoveFromDevice;

  /// No description provided for @chatUiSessionIdCopied.
  ///
  /// In en, this message translates to:
  /// **'Session ID copied.'**
  String get chatUiSessionIdCopied;

  /// No description provided for @chatUiRemoveChatTitle.
  ///
  /// In en, this message translates to:
  /// **'Remove this chat from this device?'**
  String get chatUiRemoveChatTitle;

  /// No description provided for @chatUiRemoveChatBodyArchived.
  ///
  /// In en, this message translates to:
  /// **'The chat stays on your desktop. Subagent chats are archived locally.'**
  String get chatUiRemoveChatBodyArchived;

  /// No description provided for @chatUiRemoveChatBody.
  ///
  /// In en, this message translates to:
  /// **'The chat stays on your desktop. It will also be archived there. Subagent chats are archived locally.'**
  String get chatUiRemoveChatBody;

  /// No description provided for @chatUiRemoveChat.
  ///
  /// In en, this message translates to:
  /// **'Remove chat'**
  String get chatUiRemoveChat;

  /// No description provided for @chatUiChatName.
  ///
  /// In en, this message translates to:
  /// **'Chat name'**
  String get chatUiChatName;

  /// No description provided for @chatUiSaveName.
  ///
  /// In en, this message translates to:
  /// **'Save name'**
  String get chatUiSaveName;

  /// No description provided for @chatUiCopyPathFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not copy the path. Try again.'**
  String get chatUiCopyPathFailed;

  /// No description provided for @chatUiConversationChanged.
  ///
  /// In en, this message translates to:
  /// **'Conversation changed'**
  String get chatUiConversationChanged;

  /// No description provided for @chatUiCloseLocation.
  ///
  /// In en, this message translates to:
  /// **'Close location'**
  String get chatUiCloseLocation;

  /// No description provided for @chatUiThreadLabel.
  ///
  /// In en, this message translates to:
  /// **'Thread'**
  String get chatUiThreadLabel;

  /// No description provided for @chatUiRenameConversation.
  ///
  /// In en, this message translates to:
  /// **'Rename conversation'**
  String get chatUiRenameConversation;

  /// No description provided for @chatUiPathLabel.
  ///
  /// In en, this message translates to:
  /// **'Path'**
  String get chatUiPathLabel;

  /// No description provided for @chatUiPathCopied.
  ///
  /// In en, this message translates to:
  /// **'Path copied'**
  String get chatUiPathCopied;

  /// No description provided for @chatUiCopyPath.
  ///
  /// In en, this message translates to:
  /// **'Copy path'**
  String get chatUiCopyPath;

  /// No description provided for @chatUiLocationStale.
  ///
  /// In en, this message translates to:
  /// **'Close this sheet and reopen the conversation location.'**
  String get chatUiLocationStale;

  /// No description provided for @chatUiMoreThreadActions.
  ///
  /// In en, this message translates to:
  /// **'More thread actions'**
  String get chatUiMoreThreadActions;

  /// No description provided for @chatUiPreviousMessages.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 previous message} other{{count} previous messages}}'**
  String chatUiPreviousMessages(int count);

  /// No description provided for @chatUiMoreToolCalls.
  ///
  /// In en, this message translates to:
  /// **'+{count} tool calls'**
  String chatUiMoreToolCalls(int count);

  /// No description provided for @chatUiRanCommands.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{Ran 1 command} other{Ran {count} commands}}'**
  String chatUiRanCommands(int count);

  /// No description provided for @chatUiCommandsFailed.
  ///
  /// In en, this message translates to:
  /// **'{count} failed'**
  String chatUiCommandsFailed(int count);

  /// No description provided for @chatUiCommandsStopped.
  ///
  /// In en, this message translates to:
  /// **'{count} stopped'**
  String chatUiCommandsStopped(int count);

  /// No description provided for @chatUiCollapsePreviousMessages.
  ///
  /// In en, this message translates to:
  /// **'Collapse previous messages'**
  String get chatUiCollapsePreviousMessages;

  /// No description provided for @chatUiExpandPreviousMessages.
  ///
  /// In en, this message translates to:
  /// **'Expand previous messages'**
  String get chatUiExpandPreviousMessages;

  /// No description provided for @chatUiCollapseCommands.
  ///
  /// In en, this message translates to:
  /// **'Collapse commands'**
  String get chatUiCollapseCommands;

  /// No description provided for @chatUiExpandCommands.
  ///
  /// In en, this message translates to:
  /// **'Expand commands'**
  String get chatUiExpandCommands;

  /// No description provided for @chatUiCollapseToolCalls.
  ///
  /// In en, this message translates to:
  /// **'Collapse tool calls'**
  String get chatUiCollapseToolCalls;

  /// No description provided for @chatUiExpandToolCalls.
  ///
  /// In en, this message translates to:
  /// **'Expand tool calls'**
  String get chatUiExpandToolCalls;

  /// No description provided for @chatUiQuestions.
  ///
  /// In en, this message translates to:
  /// **'Questions'**
  String get chatUiQuestions;

  /// No description provided for @chatUiQuestionPage.
  ///
  /// In en, this message translates to:
  /// **'{page} of {total}'**
  String chatUiQuestionPage(int page, int total);

  /// No description provided for @chatUiQuestionResponseUnknown.
  ///
  /// In en, this message translates to:
  /// **'A previous response may have been sent. Check the desktop state before replying again.'**
  String get chatUiQuestionResponseUnknown;

  /// No description provided for @chatUiBack.
  ///
  /// In en, this message translates to:
  /// **'Back'**
  String get chatUiBack;

  /// No description provided for @chatUiQuestionClosing.
  ///
  /// In en, this message translates to:
  /// **'Closing...'**
  String get chatUiQuestionClosing;

  /// Dismisses the agent's question
  ///
  /// In en, this message translates to:
  /// **'ESC'**
  String get chatUiQuestionEsc;

  /// No description provided for @chatUiNext.
  ///
  /// In en, this message translates to:
  /// **'Next'**
  String get chatUiNext;

  /// No description provided for @chatUiResponseSent.
  ///
  /// In en, this message translates to:
  /// **'Response sent'**
  String get chatUiResponseSent;

  /// No description provided for @chatUiSendingDots.
  ///
  /// In en, this message translates to:
  /// **'Sending...'**
  String get chatUiSendingDots;

  /// No description provided for @chatUiSend.
  ///
  /// In en, this message translates to:
  /// **'Send'**
  String get chatUiSend;

  /// No description provided for @chatUiSelectUpTo.
  ///
  /// In en, this message translates to:
  /// **'Select up to {limit}'**
  String chatUiSelectUpTo(int limit);

  /// No description provided for @chatUiOtherAnswer.
  ///
  /// In en, this message translates to:
  /// **'Other answer'**
  String get chatUiOtherAnswer;

  /// No description provided for @chatUiYourAnswer.
  ///
  /// In en, this message translates to:
  /// **'Your answer'**
  String get chatUiYourAnswer;

  /// Font option that uses the system font.
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get settingsFontSystem;

  /// No description provided for @settingsUnlockReason.
  ///
  /// In en, this message translates to:
  /// **'Unlock DJL and your remote coding sessions.'**
  String get settingsUnlockReason;

  /// No description provided for @settingsUsageWeekly.
  ///
  /// In en, this message translates to:
  /// **'Weekly'**
  String get settingsUsageWeekly;

  /// No description provided for @settingsUsageWeeks.
  ///
  /// In en, this message translates to:
  /// **'{count}w'**
  String settingsUsageWeeks(int count);

  /// No description provided for @settingsUsageDays.
  ///
  /// In en, this message translates to:
  /// **'{count}d'**
  String settingsUsageDays(int count);

  /// No description provided for @settingsUsageHours.
  ///
  /// In en, this message translates to:
  /// **'{count}h'**
  String settingsUsageHours(int count);

  /// No description provided for @settingsUsageMinutes.
  ///
  /// In en, this message translates to:
  /// **'{count}m'**
  String settingsUsageMinutes(int count);

  /// Theme option that follows the system.
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get settingsThemeSystem;

  /// No description provided for @settingsThemeLight.
  ///
  /// In en, this message translates to:
  /// **'Light'**
  String get settingsThemeLight;

  /// No description provided for @settingsThemeDark.
  ///
  /// In en, this message translates to:
  /// **'Dark'**
  String get settingsThemeDark;

  /// No description provided for @settingsAppearance.
  ///
  /// In en, this message translates to:
  /// **'Appearance'**
  String get settingsAppearance;

  /// No description provided for @settingsFont.
  ///
  /// In en, this message translates to:
  /// **'Font'**
  String get settingsFont;

  /// No description provided for @settingsLiquidGlass.
  ///
  /// In en, this message translates to:
  /// **'Liquid Glass'**
  String get settingsLiquidGlass;

  /// No description provided for @settingsTheme.
  ///
  /// In en, this message translates to:
  /// **'Theme'**
  String get settingsTheme;

  /// No description provided for @settingsNotifications.
  ///
  /// In en, this message translates to:
  /// **'Notifications'**
  String get settingsNotifications;

  /// No description provided for @settingsInAppAlertsFooter.
  ///
  /// In en, this message translates to:
  /// **'Show a banner when another conversation’s task finishes.'**
  String get settingsInAppAlertsFooter;

  /// No description provided for @settingsInAppAlerts.
  ///
  /// In en, this message translates to:
  /// **'In-app alerts'**
  String get settingsInAppAlerts;

  /// No description provided for @settingsVoice.
  ///
  /// In en, this message translates to:
  /// **'Voice'**
  String get settingsVoice;

  /// No description provided for @settingsVoiceFooter.
  ///
  /// In en, this message translates to:
  /// **'Review dictation before sending. Replies use your device’s voice.'**
  String get settingsVoiceFooter;

  /// No description provided for @settingsSpeakReplies.
  ///
  /// In en, this message translates to:
  /// **'Speak new replies'**
  String get settingsSpeakReplies;

  /// No description provided for @settingsRetryReading.
  ///
  /// In en, this message translates to:
  /// **'Retry reading settings'**
  String get settingsRetryReading;

  /// No description provided for @settingsErrorPartialSave.
  ///
  /// In en, this message translates to:
  /// **'Some defaults may have been saved in part. Review the reloaded choices and retry.'**
  String get settingsErrorPartialSave;

  /// No description provided for @settingsErrorPartialReload.
  ///
  /// In en, this message translates to:
  /// **'Defaults may have been saved in part. Could not reload preferences. Retry reading settings first.'**
  String get settingsErrorPartialReload;

  /// No description provided for @settingsErrorRead.
  ///
  /// In en, this message translates to:
  /// **'Could not read saved settings. Retry to keep your preferences.'**
  String get settingsErrorRead;

  /// No description provided for @settingsErrorSave.
  ///
  /// In en, this message translates to:
  /// **'Could not save this setting. Your previous choice is unchanged. Try again.'**
  String get settingsErrorSave;

  /// No description provided for @settingsUsageResets.
  ///
  /// In en, this message translates to:
  /// **'resets {when}'**
  String settingsUsageResets(String when);

  /// No description provided for @settingsUsage.
  ///
  /// In en, this message translates to:
  /// **'Usage'**
  String get settingsUsage;

  /// No description provided for @settingsUsageFooter.
  ///
  /// In en, this message translates to:
  /// **'Account-wide rate limits from your paired device.'**
  String get settingsUsageFooter;

  /// No description provided for @settingsUsageLoading.
  ///
  /// In en, this message translates to:
  /// **'Loading current limits...'**
  String get settingsUsageLoading;

  /// No description provided for @settingsUsageConnect.
  ///
  /// In en, this message translates to:
  /// **'Connect your paired device to load current limits.'**
  String get settingsUsageConnect;

  /// No description provided for @settingsUsageUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Rate limits are unavailable for this account.'**
  String get settingsUsageUnavailable;

  /// No description provided for @settingsUsageLeft.
  ///
  /// In en, this message translates to:
  /// **'{percent}% left'**
  String settingsUsageLeft(int percent);

  /// No description provided for @settingsUsageStale.
  ///
  /// In en, this message translates to:
  /// **'Last known limits. Reconnect or refresh to update.'**
  String get settingsUsageStale;

  /// No description provided for @settingsUsageRefreshTooltip.
  ///
  /// In en, this message translates to:
  /// **'Refresh usage'**
  String get settingsUsageRefreshTooltip;

  /// No description provided for @settingsUsageRefreshing.
  ///
  /// In en, this message translates to:
  /// **'Refreshing...'**
  String get settingsUsageRefreshing;

  /// No description provided for @settingsUsageRefresh.
  ///
  /// In en, this message translates to:
  /// **'Refresh'**
  String get settingsUsageRefresh;

  /// No description provided for @settingsUsageRuntimeUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Rate limits are unavailable for this runtime.'**
  String get settingsUsageRuntimeUnavailable;

  /// No description provided for @settingsUsageLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not load current limits. Try again.'**
  String get settingsUsageLoadFailed;

  /// No description provided for @settingsTitle.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get settingsTitle;

  /// No description provided for @settingsOpenCloudChat.
  ///
  /// In en, this message translates to:
  /// **'Open DJL Cloud chat'**
  String get settingsOpenCloudChat;

  /// No description provided for @settingsSignInCloud.
  ///
  /// In en, this message translates to:
  /// **'Sign in to DJL Cloud'**
  String get settingsSignInCloud;

  /// No description provided for @settingsCloudSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Chat, images, and background tasks without your Mac'**
  String get settingsCloudSubtitle;

  /// No description provided for @settingsDevicePermissions.
  ///
  /// In en, this message translates to:
  /// **'Device permissions'**
  String get settingsDevicePermissions;

  /// No description provided for @settingsDevice.
  ///
  /// In en, this message translates to:
  /// **'Device'**
  String get settingsDevice;

  /// No description provided for @settingsMyMacs.
  ///
  /// In en, this message translates to:
  /// **'My Macs'**
  String get settingsMyMacs;

  /// No description provided for @settingsLocked.
  ///
  /// In en, this message translates to:
  /// **'DJL is locked'**
  String get settingsLocked;

  /// No description provided for @settingsPreparing.
  ///
  /// In en, this message translates to:
  /// **'Preparing DJL'**
  String get settingsPreparing;

  /// No description provided for @settingsStartFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not start DJL'**
  String get settingsStartFailed;

  /// No description provided for @settingsPrivateNote.
  ///
  /// In en, this message translates to:
  /// **'Your remote sessions stay private when you step away.'**
  String get settingsPrivateNote;

  /// No description provided for @settingsRetryStartup.
  ///
  /// In en, this message translates to:
  /// **'Retry startup'**
  String get settingsRetryStartup;

  /// No description provided for @settingsUnlockHint.
  ///
  /// In en, this message translates to:
  /// **'Authenticates with Face ID, Touch ID, or your device passcode'**
  String get settingsUnlockHint;

  /// No description provided for @settingsUnlocking.
  ///
  /// In en, this message translates to:
  /// **'Unlocking…'**
  String get settingsUnlocking;

  /// No description provided for @settingsUnlock.
  ///
  /// In en, this message translates to:
  /// **'Unlock DJL'**
  String get settingsUnlock;

  /// No description provided for @settingsLockSetup.
  ///
  /// In en, this message translates to:
  /// **'Set up Face ID, Touch ID, or a device passcode to unlock DJL.'**
  String get settingsLockSetup;

  /// No description provided for @settingsLockStillLocked.
  ///
  /// In en, this message translates to:
  /// **'DJL is still locked. Unlock DJL to continue.'**
  String get settingsLockStillLocked;

  /// No description provided for @settingsLockCancelled.
  ///
  /// In en, this message translates to:
  /// **'Authentication was cancelled or unavailable. Unlock DJL to continue.'**
  String get settingsLockCancelled;

  /// No description provided for @settingsBridgeUnknown.
  ///
  /// In en, this message translates to:
  /// **'Unknown'**
  String get settingsBridgeUnknown;

  /// No description provided for @settingsBridgeInstalled.
  ///
  /// In en, this message translates to:
  /// **'Installed'**
  String get settingsBridgeInstalled;

  /// No description provided for @settingsBridgeUpToDate.
  ///
  /// In en, this message translates to:
  /// **'Up to date'**
  String get settingsBridgeUpToDate;

  /// No description provided for @settingsBridgeUpdateAvailable.
  ///
  /// In en, this message translates to:
  /// **'Update available'**
  String get settingsBridgeUpdateAvailable;

  /// No description provided for @settingsBridgeDifferentBuild.
  ///
  /// In en, this message translates to:
  /// **'Different build'**
  String get settingsBridgeDifferentBuild;

  /// No description provided for @settingsBridgeConnectHint.
  ///
  /// In en, this message translates to:
  /// **'Connect to your Mac to see its DJL version.'**
  String get settingsBridgeConnectHint;

  /// No description provided for @settingsBridgeStaleHint.
  ///
  /// In en, this message translates to:
  /// **'Last known version. Reconnect to check again.'**
  String get settingsBridgeStaleHint;

  /// No description provided for @settingsBridgeMatches.
  ///
  /// In en, this message translates to:
  /// **'DJL on your Mac matches the latest release.'**
  String get settingsBridgeMatches;

  /// No description provided for @settingsBridgeNewer.
  ///
  /// In en, this message translates to:
  /// **'A newer DJL release is available. Update DJL on your Mac.'**
  String get settingsBridgeNewer;

  /// No description provided for @settingsBridgeDifferent.
  ///
  /// In en, this message translates to:
  /// **'Your Mac is running a different build than the latest release.'**
  String get settingsBridgeDifferent;

  /// No description provided for @settingsBridgeStatus.
  ///
  /// In en, this message translates to:
  /// **'Status'**
  String get settingsBridgeStatus;

  /// No description provided for @settingsBridgeLastKnown.
  ///
  /// In en, this message translates to:
  /// **'Last known · {status}'**
  String settingsBridgeLastKnown(String status);

  /// No description provided for @settingsVersion.
  ///
  /// In en, this message translates to:
  /// **'Version'**
  String get settingsVersion;

  /// No description provided for @settingsBridgeLatest.
  ///
  /// In en, this message translates to:
  /// **'Latest'**
  String get settingsBridgeLatest;

  /// No description provided for @settingsBridgeUpdate.
  ///
  /// In en, this message translates to:
  /// **'Update DJL on your Mac'**
  String get settingsBridgeUpdate;

  /// No description provided for @settingsBridgeCheck.
  ///
  /// In en, this message translates to:
  /// **'Check for a DJL update'**
  String get settingsBridgeCheck;

  /// No description provided for @settingsElapsedDays.
  ///
  /// In en, this message translates to:
  /// **'{days, plural, =1{1 day} other{{days} days}}'**
  String settingsElapsedDays(int days);

  /// No description provided for @settingsElapsedHours.
  ///
  /// In en, this message translates to:
  /// **'{hours, plural, =1{1 hr} other{{hours} hrs}}, {minutes} mins'**
  String settingsElapsedHours(int hours, int minutes);

  /// No description provided for @settingsElapsedMinutes.
  ///
  /// In en, this message translates to:
  /// **'{minutes} mins, {seconds} secs'**
  String settingsElapsedMinutes(int minutes, int seconds);

  /// No description provided for @settingsElapsedSeconds.
  ///
  /// In en, this message translates to:
  /// **'{seconds} secs'**
  String settingsElapsedSeconds(int seconds);

  /// No description provided for @settingsArchived.
  ///
  /// In en, this message translates to:
  /// **'Archived'**
  String get settingsArchived;

  /// No description provided for @settingsArchivedChats.
  ///
  /// In en, this message translates to:
  /// **'Archived Chats'**
  String get settingsArchivedChats;

  /// No description provided for @settingsArchivedSaved.
  ///
  /// In en, this message translates to:
  /// **'{count} saved locally'**
  String settingsArchivedSaved(int count);

  /// No description provided for @settingsArchivedActions.
  ///
  /// In en, this message translates to:
  /// **'Archived chat actions'**
  String get settingsArchivedActions;

  /// No description provided for @settingsUnarchive.
  ///
  /// In en, this message translates to:
  /// **'Unarchive'**
  String get settingsUnarchive;

  /// No description provided for @settingsRemoveFromPhone.
  ///
  /// In en, this message translates to:
  /// **'Remove from Phone'**
  String get settingsRemoveFromPhone;

  /// No description provided for @settingsRemove.
  ///
  /// In en, this message translates to:
  /// **'Remove'**
  String get settingsRemove;

  /// No description provided for @settingsNoArchived.
  ///
  /// In en, this message translates to:
  /// **'No archived chats'**
  String get settingsNoArchived;

  /// No description provided for @settingsRemoveTitle.
  ///
  /// In en, this message translates to:
  /// **'Remove \"{title}\" from this phone?'**
  String settingsRemoveTitle(String title);

  /// No description provided for @settingsRemoveBody.
  ///
  /// In en, this message translates to:
  /// **'This only removes the chat from DJL on this phone. Nothing is removed from your paired desktop.'**
  String get settingsRemoveBody;

  /// No description provided for @settingsCloudRefreshFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not refresh account and Cloud settings.'**
  String get settingsCloudRefreshFailed;

  /// No description provided for @settingsLinkFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not open this link. Try again.'**
  String get settingsLinkFailed;

  /// No description provided for @settingsOpenNotificationsFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not open notification settings. Try again.'**
  String get settingsOpenNotificationsFailed;

  /// No description provided for @settingsAlertsUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Unavailable'**
  String get settingsAlertsUnavailable;

  /// No description provided for @settingsAlertsOff.
  ///
  /// In en, this message translates to:
  /// **'Off'**
  String get settingsAlertsOff;

  /// No description provided for @settingsAlertsEnabled.
  ///
  /// In en, this message translates to:
  /// **'Enabled'**
  String get settingsAlertsEnabled;

  /// No description provided for @settingsAlertsNotEnabled.
  ///
  /// In en, this message translates to:
  /// **'Not enabled'**
  String get settingsAlertsNotEnabled;

  /// No description provided for @settingsBack.
  ///
  /// In en, this message translates to:
  /// **'Back'**
  String get settingsBack;

  /// No description provided for @settingsOpenNavigation.
  ///
  /// In en, this message translates to:
  /// **'Open navigation'**
  String get settingsOpenNavigation;

  /// No description provided for @settingsRetry.
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get settingsRetry;

  /// No description provided for @settingsAccount.
  ///
  /// In en, this message translates to:
  /// **'Account'**
  String get settingsAccount;

  /// No description provided for @settingsDjlAccount.
  ///
  /// In en, this message translates to:
  /// **'DJL account'**
  String get settingsDjlAccount;

  /// No description provided for @settingsAvailableCredits.
  ///
  /// In en, this message translates to:
  /// **'Available credits'**
  String get settingsAvailableCredits;

  /// No description provided for @settingsConversations.
  ///
  /// In en, this message translates to:
  /// **'Conversations'**
  String get settingsConversations;

  /// No description provided for @settingsArchivedChatsRow.
  ///
  /// In en, this message translates to:
  /// **'Archived chats'**
  String get settingsArchivedChatsRow;

  /// No description provided for @settingsRemoteAccess.
  ///
  /// In en, this message translates to:
  /// **'Remote access'**
  String get settingsRemoteAccess;

  /// No description provided for @settingsBackgroundAlerts.
  ///
  /// In en, this message translates to:
  /// **'Background alerts'**
  String get settingsBackgroundAlerts;

  /// No description provided for @settingsEnableBackgroundAlerts.
  ///
  /// In en, this message translates to:
  /// **'Enable background alerts'**
  String get settingsEnableBackgroundAlerts;

  /// No description provided for @settingsOpenNotificationSettings.
  ///
  /// In en, this message translates to:
  /// **'Open notification settings'**
  String get settingsOpenNotificationSettings;

  /// No description provided for @settingsVoiceIos.
  ///
  /// In en, this message translates to:
  /// **'Dictation stays on your iPhone. Review the text before sending. Replies use the iPhone voice.'**
  String get settingsVoiceIos;

  /// No description provided for @settingsVoiceDevice.
  ///
  /// In en, this message translates to:
  /// **'Dictation stays on your device. Review the text before sending. Replies use your device’s voice.'**
  String get settingsVoiceDevice;

  /// No description provided for @settingsAbout.
  ///
  /// In en, this message translates to:
  /// **'About'**
  String get settingsAbout;

  /// No description provided for @settingsTerms.
  ///
  /// In en, this message translates to:
  /// **'Terms'**
  String get settingsTerms;

  /// No description provided for @settingsPrivacy.
  ///
  /// In en, this message translates to:
  /// **'Privacy'**
  String get settingsPrivacy;

  /// No description provided for @settingsRetryLocalPrefs.
  ///
  /// In en, this message translates to:
  /// **'Retry local preferences'**
  String get settingsRetryLocalPrefs;

  /// No description provided for @settingsDeviceNameOnPhone.
  ///
  /// In en, this message translates to:
  /// **'Device name on this phone'**
  String get settingsDeviceNameOnPhone;

  /// No description provided for @settingsEditDeviceNameTooltip.
  ///
  /// In en, this message translates to:
  /// **'Edit device name'**
  String get settingsEditDeviceNameTooltip;

  /// No description provided for @settingsClose.
  ///
  /// In en, this message translates to:
  /// **'Close'**
  String get settingsClose;

  /// No description provided for @settingsEditDeviceNameTitle.
  ///
  /// In en, this message translates to:
  /// **'Edit Device Name'**
  String get settingsEditDeviceNameTitle;

  /// No description provided for @settingsDeviceName.
  ///
  /// In en, this message translates to:
  /// **'Device name'**
  String get settingsDeviceName;

  /// No description provided for @settingsNicknameNote.
  ///
  /// In en, this message translates to:
  /// **'This nickname stays on this phone and appears anywhere this device is shown.'**
  String get settingsNicknameNote;

  /// No description provided for @settingsDeviceChanged.
  ///
  /// In en, this message translates to:
  /// **'This saved device changed. Close and reopen the editor.'**
  String get settingsDeviceChanged;

  /// No description provided for @settingsUseDefault.
  ///
  /// In en, this message translates to:
  /// **'Use Default'**
  String get settingsUseDefault;

  /// No description provided for @settingsSave.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get settingsSave;

  /// No description provided for @settingsAboutFooter.
  ///
  /// In en, this message translates to:
  /// **'Chats are end-to-end encrypted between your phone and paired device.'**
  String get settingsAboutFooter;

  /// No description provided for @settingsHowDjlWorks.
  ///
  /// In en, this message translates to:
  /// **'How DJL Works'**
  String get settingsHowDjlWorks;

  /// No description provided for @settingsChatSupport.
  ///
  /// In en, this message translates to:
  /// **'Chat & Support'**
  String get settingsChatSupport;

  /// No description provided for @settingsPrivacyPolicy.
  ///
  /// In en, this message translates to:
  /// **'Privacy Policy'**
  String get settingsPrivacyPolicy;

  /// No description provided for @settingsTermsOfUse.
  ///
  /// In en, this message translates to:
  /// **'Terms of Use'**
  String get settingsTermsOfUse;

  /// No description provided for @settingsAboutRouteBridgeDevice.
  ///
  /// In en, this message translates to:
  /// **'Bridge on your paired device'**
  String get settingsAboutRouteBridgeDevice;

  /// No description provided for @settingsAboutRouteBridge.
  ///
  /// In en, this message translates to:
  /// **'Bridge'**
  String get settingsAboutRouteBridge;

  /// No description provided for @settingsAboutRouteLabel.
  ///
  /// In en, this message translates to:
  /// **'{from} to {to} via {via}'**
  String settingsAboutRouteLabel(String from, String to, String via);

  /// No description provided for @settingsAboutIntro.
  ///
  /// In en, this message translates to:
  /// **'Control **Codex** from your phone.'**
  String get settingsAboutIntro;

  /// No description provided for @settingsAboutIntroNote.
  ///
  /// In en, this message translates to:
  /// **'The Codex runtime stays on your paired device. Your phone is a secure remote control connected through a relay.'**
  String get settingsAboutIntroNote;

  /// No description provided for @settingsAboutHowItWorks.
  ///
  /// In en, this message translates to:
  /// **'How It Works'**
  String get settingsAboutHowItWorks;

  /// No description provided for @settingsAboutBridge.
  ///
  /// In en, this message translates to:
  /// **'Your paired device runs a lightweight **bridge** that connects to a **relay server** over WebSocket.'**
  String get settingsAboutBridge;

  /// No description provided for @settingsAboutStep1.
  ///
  /// In en, this message translates to:
  /// **'You send a prompt from your phone.'**
  String get settingsAboutStep1;

  /// No description provided for @settingsAboutStep2.
  ///
  /// In en, this message translates to:
  /// **'It travels through the relay to the bridge on your paired device.'**
  String get settingsAboutStep2;

  /// No description provided for @settingsAboutStep3.
  ///
  /// In en, this message translates to:
  /// **'The bridge forwards it to `codex app-server` via JSON-RPC.'**
  String get settingsAboutStep3;

  /// No description provided for @settingsAboutStep4.
  ///
  /// In en, this message translates to:
  /// **'Responses stream back along the same path in real time.'**
  String get settingsAboutStep4;

  /// No description provided for @settingsAboutWorkspaceNote.
  ///
  /// In en, this message translates to:
  /// **'Workspace tools and file edits run on your paired device. The relay routes encrypted traffic; it does not run your workspace.'**
  String get settingsAboutWorkspaceNote;

  /// No description provided for @settingsAboutArchitecture.
  ///
  /// In en, this message translates to:
  /// **'Architecture'**
  String get settingsAboutArchitecture;

  /// No description provided for @settingsAboutRelay.
  ///
  /// In en, this message translates to:
  /// **'The Relay'**
  String get settingsAboutRelay;

  /// No description provided for @settingsAboutRelayIntro.
  ///
  /// In en, this message translates to:
  /// **'A lightweight WebSocket server routes messages between your phone and paired device.'**
  String get settingsAboutRelayIntro;

  /// No description provided for @settingsAboutRelayDiscovery.
  ///
  /// In en, this message translates to:
  /// **'Handles session discovery so your phone finds the device\'s live session.'**
  String get settingsAboutRelayDiscovery;

  /// No description provided for @settingsAboutRelayPrivate.
  ///
  /// In en, this message translates to:
  /// **'Never sees decrypted message contents after the handshake.'**
  String get settingsAboutRelayPrivate;

  /// No description provided for @settingsAboutRelayMetadata.
  ///
  /// In en, this message translates to:
  /// **'Observes connection metadata such as session IDs, device IDs, and timing.'**
  String get settingsAboutRelayMetadata;

  /// No description provided for @settingsAboutRelaySelfHost.
  ///
  /// In en, this message translates to:
  /// **'You can **self-host** the relay or use the hosted endpoint configured by your bridge.'**
  String get settingsAboutRelaySelfHost;

  /// No description provided for @settingsAboutAppServerIntro.
  ///
  /// In en, this message translates to:
  /// **'For the Codex runtime, the bridge connects to **`codex app-server`**, the JSON-RPC interface used by Codex clients.'**
  String get settingsAboutAppServerIntro;

  /// No description provided for @settingsAboutAppServerSessions.
  ///
  /// In en, this message translates to:
  /// **'Phone conversations are first-class Codex sessions.'**
  String get settingsAboutAppServerSessions;

  /// No description provided for @settingsAboutAppServerRollout.
  ///
  /// In en, this message translates to:
  /// **'Codex produces JSONL rollout files under `~/.codex/sessions/`.'**
  String get settingsAboutAppServerRollout;

  /// No description provided for @settingsAboutAppServerHandoff.
  ///
  /// In en, this message translates to:
  /// **'Use DJL\'s desktop handoff action to continue a phone thread on the paired device.'**
  String get settingsAboutAppServerHandoff;

  /// No description provided for @settingsAboutPairing.
  ///
  /// In en, this message translates to:
  /// **'Pairing & Security'**
  String get settingsAboutPairing;

  /// No description provided for @settingsAboutPairingQr.
  ///
  /// In en, this message translates to:
  /// **'On first connection, scan the bridge\'s **QR code**. It identifies the relay, session, paired device, and bridge identity public key.'**
  String get settingsAboutPairingQr;

  /// No description provided for @settingsAboutPairingAfter.
  ///
  /// In en, this message translates to:
  /// **'After the secure handshake:'**
  String get settingsAboutPairingAfter;

  /// No description provided for @settingsAboutPairingTrusted.
  ///
  /// In en, this message translates to:
  /// **'Your phone saves the bridge as a **trusted device** in platform-backed secure storage.'**
  String get settingsAboutPairingTrusted;

  /// No description provided for @settingsAboutPairingIdentity.
  ///
  /// In en, this message translates to:
  /// **'The bridge persists your phone\'s identity locally.'**
  String get settingsAboutPairingIdentity;

  /// No description provided for @settingsAboutPairingReconnect.
  ///
  /// In en, this message translates to:
  /// **'Saved trusted devices can reconnect without scanning again.'**
  String get settingsAboutPairingReconnect;

  /// No description provided for @settingsAboutPairingRecovery.
  ///
  /// In en, this message translates to:
  /// **'The QR remains a recovery path if trust changes or the current session cannot be resolved. A one-time code is another pairing option when the same relay is configured.'**
  String get settingsAboutPairingRecovery;

  /// No description provided for @settingsAboutEncryption.
  ///
  /// In en, this message translates to:
  /// **'End-to-End Encryption'**
  String get settingsAboutEncryption;

  /// No description provided for @settingsAboutEncryptionIntro.
  ///
  /// In en, this message translates to:
  /// **'After pairing, messages use encrypted envelopes.'**
  String get settingsAboutEncryptionIntro;

  /// No description provided for @settingsAboutCipher.
  ///
  /// In en, this message translates to:
  /// **'Cipher'**
  String get settingsAboutCipher;

  /// No description provided for @settingsAboutKeyDerivation.
  ///
  /// In en, this message translates to:
  /// **'Key derivation'**
  String get settingsAboutKeyDerivation;

  /// No description provided for @settingsAboutKeyDerivationValue.
  ///
  /// In en, this message translates to:
  /// **'HKDF-SHA256, per-direction keys'**
  String get settingsAboutKeyDerivationValue;

  /// No description provided for @settingsAboutKeyExchange.
  ///
  /// In en, this message translates to:
  /// **'Key exchange'**
  String get settingsAboutKeyExchange;

  /// No description provided for @settingsAboutKeyExchangeValue.
  ///
  /// In en, this message translates to:
  /// **'X25519 ephemeral keys'**
  String get settingsAboutKeyExchangeValue;

  /// No description provided for @settingsAboutIdentity.
  ///
  /// In en, this message translates to:
  /// **'Identity'**
  String get settingsAboutIdentity;

  /// No description provided for @settingsAboutIdentityValue.
  ///
  /// In en, this message translates to:
  /// **'Ed25519 signatures'**
  String get settingsAboutIdentityValue;

  /// No description provided for @settingsAboutReplayProtection.
  ///
  /// In en, this message translates to:
  /// **'Replay protection'**
  String get settingsAboutReplayProtection;

  /// No description provided for @settingsAboutReplayProtectionValue.
  ///
  /// In en, this message translates to:
  /// **'Monotonic counters'**
  String get settingsAboutReplayProtectionValue;

  /// No description provided for @settingsAboutCacheKey.
  ///
  /// In en, this message translates to:
  /// **'Phone cache key'**
  String get settingsAboutCacheKey;

  /// No description provided for @settingsAboutCacheKeyValue.
  ///
  /// In en, this message translates to:
  /// **'Protected by platform-backed secure storage'**
  String get settingsAboutCacheKeyValue;

  /// No description provided for @settingsAboutEncryptionNote.
  ///
  /// In en, this message translates to:
  /// **'This describes **paired-device mode**. DJL Cloud is a separate service and account workflow.'**
  String get settingsAboutEncryptionNote;

  /// No description provided for @settingsAboutGit.
  ///
  /// In en, this message translates to:
  /// **'Git & Workspace'**
  String get settingsAboutGit;

  /// No description provided for @settingsAboutGitIntro.
  ///
  /// In en, this message translates to:
  /// **'The bridge handles Git commands locally on the paired device:'**
  String get settingsAboutGitIntro;

  /// No description provided for @settingsAboutGitRevert.
  ///
  /// In en, this message translates to:
  /// **'DJL also supports **workspace revert**: preview and apply reverse patches when you want to undo assistant changes. Review the confirmation before applying changes.'**
  String get settingsAboutGitRevert;

  /// No description provided for @settingsAboutResilience.
  ///
  /// In en, this message translates to:
  /// **'Connection Resilience'**
  String get settingsAboutResilience;

  /// No description provided for @settingsAboutReconnect.
  ///
  /// In en, this message translates to:
  /// **'Automatic reconnect uses bounded backoff.'**
  String get settingsAboutReconnect;

  /// No description provided for @settingsAboutReplay.
  ///
  /// In en, this message translates to:
  /// **'Encrypted replay cursors help recover missed events. Uncertain actions are not silently resent after a disconnect.'**
  String get settingsAboutReplay;

  /// No description provided for @settingsAboutRuntimeDrop.
  ///
  /// In en, this message translates to:
  /// **'The runtime can keep working through a transient phone connection drop.'**
  String get settingsAboutRuntimeDrop;

  /// No description provided for @settingsAboutShutdown.
  ///
  /// In en, this message translates to:
  /// **'The bridge handles clean shutdown on `SIGINT` and `SIGTERM`.'**
  String get settingsAboutShutdown;

  /// No description provided for @settingsAboutDesktop.
  ///
  /// In en, this message translates to:
  /// **'Desktop App Integration'**
  String get settingsAboutDesktop;

  /// No description provided for @settingsAboutDesktopRollout.
  ///
  /// In en, this message translates to:
  /// **'Codex persists phone threads as session rollout files on the paired device.'**
  String get settingsAboutDesktopRollout;

  /// No description provided for @settingsAboutDesktopHandoff.
  ///
  /// In en, this message translates to:
  /// **'The desktop app may not live-reload external writes. Use **Continue on desktop** in DJL to hand off the current thread.'**
  String get settingsAboutDesktopHandoff;

  /// No description provided for @settingsAboutDjl.
  ///
  /// In en, this message translates to:
  /// **'About DJL'**
  String get settingsAboutDjl;

  /// No description provided for @settingsOpenSource.
  ///
  /// In en, this message translates to:
  /// **'Open source'**
  String get settingsOpenSource;

  /// No description provided for @settingsMitLicense.
  ///
  /// In en, this message translates to:
  /// **'MIT License'**
  String get settingsMitLicense;

  /// No description provided for @hostYourMac.
  ///
  /// In en, this message translates to:
  /// **'Your Mac'**
  String get hostYourMac;

  /// No description provided for @hostUpdating.
  ///
  /// In en, this message translates to:
  /// **'DJL is updating on your Mac. This phone reconnects when it is back.'**
  String get hostUpdating;

  /// No description provided for @hostCheckingVersion.
  ///
  /// In en, this message translates to:
  /// **'Checking the DJL version on your Mac…'**
  String get hostCheckingVersion;

  /// No description provided for @hostNowVersion.
  ///
  /// In en, this message translates to:
  /// **'DJL on your Mac is now {version}.'**
  String hostNowVersion(String version);

  /// No description provided for @hostStillVersion.
  ///
  /// In en, this message translates to:
  /// **'DJL on your Mac is still {version}. It may already be up to date.'**
  String hostStillVersion(String version);

  /// No description provided for @hostConnectedFooter.
  ///
  /// In en, this message translates to:
  /// **'Your chats go straight to DJL on your Mac, encrypted end to end.'**
  String get hostConnectedFooter;

  /// No description provided for @hostReconnectFooter.
  ///
  /// In en, this message translates to:
  /// **'Open DJL on your Mac to reconnect.'**
  String get hostReconnectFooter;

  /// No description provided for @hostDjlVersion.
  ///
  /// In en, this message translates to:
  /// **'DJL version'**
  String get hostDjlVersion;

  /// No description provided for @hostCheckFailedNow.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t check your Mac just now.'**
  String get hostCheckFailedNow;

  /// No description provided for @hostReconnecting.
  ///
  /// In en, this message translates to:
  /// **'Reconnecting…'**
  String get hostReconnecting;

  /// No description provided for @hostWakeScreen.
  ///
  /// In en, this message translates to:
  /// **'Wake the screen'**
  String get hostWakeScreen;

  /// No description provided for @hostWakeScreenDetail.
  ///
  /// In en, this message translates to:
  /// **'Turns your Mac\'s display on while DJL is running.'**
  String get hostWakeScreenDetail;

  /// No description provided for @hostKeepAwake.
  ///
  /// In en, this message translates to:
  /// **'Keep Mac awake'**
  String get hostKeepAwake;

  /// No description provided for @hostKeepAwakeDetail.
  ///
  /// In en, this message translates to:
  /// **'Stops your Mac from sleeping while DJL is open. Best while it is charging.'**
  String get hostKeepAwakeDetail;

  /// No description provided for @hostUpdates.
  ///
  /// In en, this message translates to:
  /// **'Updates'**
  String get hostUpdates;

  /// No description provided for @hostUpdateDjl.
  ///
  /// In en, this message translates to:
  /// **'Update DJL'**
  String get hostUpdateDjl;

  /// No description provided for @hostUpdateDjlDetail.
  ///
  /// In en, this message translates to:
  /// **'Installs the newest DJL on your Mac, then reconnects.'**
  String get hostUpdateDjlDetail;

  /// No description provided for @hostNotConnected.
  ///
  /// In en, this message translates to:
  /// **'Not connected'**
  String get hostNotConnected;

  /// No description provided for @hostConnectedChecking.
  ///
  /// In en, this message translates to:
  /// **'Connected · checking'**
  String get hostConnectedChecking;

  /// No description provided for @hostConnected.
  ///
  /// In en, this message translates to:
  /// **'Connected'**
  String get hostConnected;

  /// No description provided for @hostStatusLabel.
  ///
  /// In en, this message translates to:
  /// **'DJL on your Mac, {status}'**
  String hostStatusLabel(String status);

  /// No description provided for @hostDjlOnYourMac.
  ///
  /// In en, this message translates to:
  /// **'DJL on your Mac'**
  String get hostDjlOnYourMac;

  /// No description provided for @hostUpdateTitle.
  ///
  /// In en, this message translates to:
  /// **'Update DJL on your Mac?'**
  String get hostUpdateTitle;

  /// No description provided for @hostUpdateCurrent.
  ///
  /// In en, this message translates to:
  /// **'Your Mac has DJL {version}.'**
  String hostUpdateCurrent(String version);

  /// No description provided for @hostUpdateBody.
  ///
  /// In en, this message translates to:
  /// **'DJL restarts on your Mac to install the newest version. This phone disconnects for a moment and reconnects by itself.'**
  String get hostUpdateBody;

  /// No description provided for @hostUpdate.
  ///
  /// In en, this message translates to:
  /// **'Update'**
  String get hostUpdate;

  /// No description provided for @hostContinueOnDesktop.
  ///
  /// In en, this message translates to:
  /// **'Continue on desktop'**
  String get hostContinueOnDesktop;

  /// No description provided for @hostContinueTitle.
  ///
  /// In en, this message translates to:
  /// **'Continue on desktop?'**
  String get hostContinueTitle;

  /// No description provided for @hostContinueBody.
  ///
  /// In en, this message translates to:
  /// **'Open this chat in DJL on your Mac.'**
  String get hostContinueBody;

  /// No description provided for @hostContinue.
  ///
  /// In en, this message translates to:
  /// **'Continue'**
  String get hostContinue;

  /// No description provided for @hostActionFinished.
  ///
  /// In en, this message translates to:
  /// **'Host action finished.'**
  String get hostActionFinished;

  /// No description provided for @hostErrorUnsupported.
  ///
  /// In en, this message translates to:
  /// **'DJL on your Mac can\'t do this yet. Update DJL on your Mac.'**
  String get hostErrorUnsupported;

  /// No description provided for @hostErrorRefused.
  ///
  /// In en, this message translates to:
  /// **'Your Mac turned this down. Check DJL on your Mac and try again.'**
  String get hostErrorRefused;

  /// No description provided for @hostErrorUncertain.
  ///
  /// In en, this message translates to:
  /// **'We could not tell whether this worked. Check your Mac before trying again.'**
  String get hostErrorUncertain;

  /// No description provided for @hostCheckFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not check your Mac. Try again.'**
  String get hostCheckFailed;

  /// No description provided for @hostCheckingFirst.
  ///
  /// In en, this message translates to:
  /// **'Checking your Mac first. Try again in a moment.'**
  String get hostCheckingFirst;

  /// No description provided for @hostConnectFirst.
  ///
  /// In en, this message translates to:
  /// **'Connect to your Mac first.'**
  String get hostConnectFirst;

  /// No description provided for @hostNotConfirmed.
  ///
  /// In en, this message translates to:
  /// **'Your Mac did not confirm this. Check it before trying again.'**
  String get hostNotConfirmed;

  /// No description provided for @hostOpenedOnMac.
  ///
  /// In en, this message translates to:
  /// **'Opened in DJL on your Mac.'**
  String get hostOpenedOnMac;

  /// No description provided for @hostReconnectFirst.
  ///
  /// In en, this message translates to:
  /// **'Reconnect to your Mac first.'**
  String get hostReconnectFirst;

  /// No description provided for @hostReachFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not reach DJL on your Mac. Check that it is open, then try again.'**
  String get hostReachFailed;

  /// No description provided for @hostWaking.
  ///
  /// In en, this message translates to:
  /// **'Your Mac\'s screen is waking up.'**
  String get hostWaking;

  /// No description provided for @hostPrefReadFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not read the saved preference. Retry.'**
  String get hostPrefReadFailed;

  /// No description provided for @hostPrefSaveFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not save this preference. Your previous choice is unchanged. Try again.'**
  String get hostPrefSaveFailed;

  /// No description provided for @hostPrefUnconfirmed.
  ///
  /// In en, this message translates to:
  /// **'Saved on this phone, but your Mac has not confirmed it yet.'**
  String get hostPrefUnconfirmed;

  /// No description provided for @pushTitle.
  ///
  /// In en, this message translates to:
  /// **'Push notifications'**
  String get pushTitle;

  /// No description provided for @pushUnsupported.
  ///
  /// In en, this message translates to:
  /// **'This phone can\'t get push notifications from DJL yet. Open DJL to see when an agent is done.'**
  String get pushUnsupported;

  /// No description provided for @pushDenied.
  ///
  /// In en, this message translates to:
  /// **'Notifications are off for DJL in your phone\'s Settings.'**
  String get pushDenied;

  /// No description provided for @pushReady.
  ///
  /// In en, this message translates to:
  /// **'Get a notification when an agent finishes or needs your answer.'**
  String get pushReady;

  /// No description provided for @pushSimulator.
  ///
  /// In en, this message translates to:
  /// **'This simulator can\'t receive push notifications.'**
  String get pushSimulator;

  /// No description provided for @pushUnavailableVersion.
  ///
  /// In en, this message translates to:
  /// **'Push notifications aren\'t available in this version.'**
  String get pushUnavailableVersion;

  /// No description provided for @pushFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t turn on notifications. Try again when you\'re online.'**
  String get pushFailed;

  /// No description provided for @pushUnavailableNow.
  ///
  /// In en, this message translates to:
  /// **'Push notifications aren\'t available right now.'**
  String get pushUnavailableNow;

  /// No description provided for @pushReadFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not read notification preference. Retry.'**
  String get pushReadFailed;

  /// No description provided for @pushUpdateFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not update notification preference. Retry.'**
  String get pushUpdateFailed;

  /// No description provided for @whatsNewTitle.
  ///
  /// In en, this message translates to:
  /// **'What\'s New'**
  String get whatsNewTitle;

  /// No description provided for @whatsNewIntro.
  ///
  /// In en, this message translates to:
  /// **'Here\'s what\'s new in DJL.'**
  String get whatsNewIntro;

  /// No description provided for @whatsNewOnce.
  ///
  /// In en, this message translates to:
  /// **'We\'ll only show this once for each app version.'**
  String get whatsNewOnce;

  /// No description provided for @whatsNewGotIt.
  ///
  /// In en, this message translates to:
  /// **'Got It'**
  String get whatsNewGotIt;

  /// No description provided for @whatsNewDismiss.
  ///
  /// In en, this message translates to:
  /// **'Dismiss release notes'**
  String get whatsNewDismiss;

  /// No description provided for @whatsNew100Design.
  ///
  /// In en, this message translates to:
  /// **'A calmer black and white design.'**
  String get whatsNew100Design;

  /// No description provided for @whatsNew100Groups.
  ///
  /// In en, this message translates to:
  /// **'Group chats: talk to several agents at once and watch them reply live.'**
  String get whatsNew100Groups;

  /// No description provided for @whatsNew100Files.
  ///
  /// In en, this message translates to:
  /// **'Send files and photos in a group chat.'**
  String get whatsNew100Files;

  /// No description provided for @whatsNew100Mac.
  ///
  /// In en, this message translates to:
  /// **'Chats go straight to DJL on your Mac.'**
  String get whatsNew100Mac;

  /// No description provided for @accountSomethingWrong.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong'**
  String get accountSomethingWrong;

  /// DELETE is the literal word the person must type; keep it in English.
  ///
  /// In en, this message translates to:
  /// **'Type DELETE to confirm.'**
  String get accountTypeDeleteToConfirm;

  /// No description provided for @accountOk.
  ///
  /// In en, this message translates to:
  /// **'OK'**
  String get accountOk;

  /// No description provided for @accountDone.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get accountDone;

  /// No description provided for @accountEmail.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get accountEmail;

  /// No description provided for @accountPlan.
  ///
  /// In en, this message translates to:
  /// **'Plan'**
  String get accountPlan;

  /// No description provided for @accountCredits.
  ///
  /// In en, this message translates to:
  /// **'Credits'**
  String get accountCredits;

  /// No description provided for @accountUsageFooter.
  ///
  /// In en, this message translates to:
  /// **'A banked reset starts both limits over and restarts your week. Banks expire 90 days after they\'re granted.'**
  String get accountUsageFooter;

  /// No description provided for @accountFiveHourLimit.
  ///
  /// In en, this message translates to:
  /// **'5-hour limit'**
  String get accountFiveHourLimit;

  /// No description provided for @accountWeeklyLimit.
  ///
  /// In en, this message translates to:
  /// **'Weekly limit'**
  String get accountWeeklyLimit;

  /// No description provided for @accountBankedResets.
  ///
  /// In en, this message translates to:
  /// **'Banked resets'**
  String get accountBankedResets;

  /// No description provided for @accountNextExpires.
  ///
  /// In en, this message translates to:
  /// **'Next expires {date}, {year}'**
  String accountNextExpires(String date, String year);

  /// No description provided for @accountNone.
  ///
  /// In en, this message translates to:
  /// **'None'**
  String get accountNone;

  /// No description provided for @accountUseOne.
  ///
  /// In en, this message translates to:
  /// **'Use 1 of {count}'**
  String accountUseOne(int count);

  /// No description provided for @accountDeleteFooter.
  ///
  /// In en, this message translates to:
  /// **'Deleting your account removes your chats, files, and credits. You have 30 days to change your mind by contacting support.'**
  String get accountDeleteFooter;

  /// No description provided for @accountSignOut.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get accountSignOut;

  /// No description provided for @accountDelete.
  ///
  /// In en, this message translates to:
  /// **'Delete account'**
  String get accountDelete;

  /// No description provided for @accountUsedPercent.
  ///
  /// In en, this message translates to:
  /// **'{percent}% used'**
  String accountUsedPercent(int percent);

  /// No description provided for @accountResetsNow.
  ///
  /// In en, this message translates to:
  /// **'Resets now'**
  String get accountResetsNow;

  /// No description provided for @accountResetsTomorrow.
  ///
  /// In en, this message translates to:
  /// **'Resets tomorrow'**
  String get accountResetsTomorrow;

  /// No description provided for @accountResetsYesterday.
  ///
  /// In en, this message translates to:
  /// **'Resets yesterday'**
  String get accountResetsYesterday;

  /// No description provided for @accountResetsNextWeek.
  ///
  /// In en, this message translates to:
  /// **'Resets next week'**
  String get accountResetsNextWeek;

  /// No description provided for @accountResetsLastWeek.
  ///
  /// In en, this message translates to:
  /// **'Resets last week'**
  String get accountResetsLastWeek;

  /// No description provided for @accountResetsIn.
  ///
  /// In en, this message translates to:
  /// **'Resets in {quantity}'**
  String accountResetsIn(String quantity);

  /// No description provided for @accountResetsAgo.
  ///
  /// In en, this message translates to:
  /// **'Resets {quantity} ago'**
  String accountResetsAgo(String quantity);

  /// No description provided for @accountSeconds.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 second} other{{count} seconds}}'**
  String accountSeconds(int count);

  /// No description provided for @accountMinutes.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 minute} other{{count} minutes}}'**
  String accountMinutes(int count);

  /// No description provided for @accountHours.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 hour} other{{count} hours}}'**
  String accountHours(int count);

  /// No description provided for @accountDays.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 day} other{{count} days}}'**
  String accountDays(int count);

  /// No description provided for @accountWeeks.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 week} other{{count} weeks}}'**
  String accountWeeks(int count);

  /// No description provided for @accountDeleteTitle.
  ///
  /// In en, this message translates to:
  /// **'Delete your account?'**
  String get accountDeleteTitle;

  /// No description provided for @accountDeleteBody.
  ///
  /// In en, this message translates to:
  /// **'This can\'t be undone after 30 days. Type DELETE to confirm.'**
  String get accountDeleteBody;

  /// No description provided for @accountTypeDelete.
  ///
  /// In en, this message translates to:
  /// **'Type DELETE'**
  String get accountTypeDelete;

  /// No description provided for @accountSignOutTitle.
  ///
  /// In en, this message translates to:
  /// **'Sign out of DJL Cloud?'**
  String get accountSignOutTitle;

  /// No description provided for @notificationsTitle.
  ///
  /// In en, this message translates to:
  /// **'Notifications'**
  String get notificationsTitle;

  /// No description provided for @notificationsMarkAllRead.
  ///
  /// In en, this message translates to:
  /// **'Mark all read'**
  String get notificationsMarkAllRead;

  /// No description provided for @notificationsCaughtUp.
  ///
  /// In en, this message translates to:
  /// **'You’re all caught up'**
  String get notificationsCaughtUp;

  /// No description provided for @notificationsEmptyHint.
  ///
  /// In en, this message translates to:
  /// **'Completed tasks will appear here.'**
  String get notificationsEmptyHint;

  /// No description provided for @notificationsTaskComplete.
  ///
  /// In en, this message translates to:
  /// **'Task complete'**
  String get notificationsTaskComplete;

  /// No description provided for @notificationsLoadMore.
  ///
  /// In en, this message translates to:
  /// **'Load more'**
  String get notificationsLoadMore;

  /// No description provided for @notificationsStatus.
  ///
  /// In en, this message translates to:
  /// **'{status, select, succeeded{succeeded} failed{failed} other{{status}}}'**
  String notificationsStatus(String status);

  /// No description provided for @notificationsTaskStopped.
  ///
  /// In en, this message translates to:
  /// **'Task stopped'**
  String get notificationsTaskStopped;

  /// No description provided for @notificationsTaskFinished.
  ///
  /// In en, this message translates to:
  /// **'Task finished'**
  String get notificationsTaskFinished;

  /// No description provided for @notificationsOpenResult.
  ///
  /// In en, this message translates to:
  /// **'Open DJL to see the result'**
  String get notificationsOpenResult;

  /// No description provided for @notificationsDismiss.
  ///
  /// In en, this message translates to:
  /// **'Dismiss notification'**
  String get notificationsDismiss;

  /// No description provided for @reportOffensive.
  ///
  /// In en, this message translates to:
  /// **'Offensive or hateful'**
  String get reportOffensive;

  /// No description provided for @reportHarmful.
  ///
  /// In en, this message translates to:
  /// **'Harmful or dangerous'**
  String get reportHarmful;

  /// No description provided for @reportWrong.
  ///
  /// In en, this message translates to:
  /// **'Wrong or misleading'**
  String get reportWrong;

  /// No description provided for @reportOther.
  ///
  /// In en, this message translates to:
  /// **'Something else'**
  String get reportOther;

  /// No description provided for @reportThanks.
  ///
  /// In en, this message translates to:
  /// **'Thanks. We\'ll review this answer.'**
  String get reportThanks;

  /// No description provided for @reportTitle.
  ///
  /// In en, this message translates to:
  /// **'Report this answer'**
  String get reportTitle;

  /// No description provided for @reportRateLimited.
  ///
  /// In en, this message translates to:
  /// **'Too many reports right now. Try again later.'**
  String get reportRateLimited;

  /// No description provided for @reportFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t send the report. Try again.'**
  String get reportFailed;

  /// No description provided for @reportIntro.
  ///
  /// In en, this message translates to:
  /// **'DJL reviews reports to keep answers safe. What is wrong with it?'**
  String get reportIntro;

  /// No description provided for @reportDetailsHint.
  ///
  /// In en, this message translates to:
  /// **'Add details (optional)'**
  String get reportDetailsHint;

  /// No description provided for @reportSending.
  ///
  /// In en, this message translates to:
  /// **'Sending…'**
  String get reportSending;

  /// No description provided for @reportSend.
  ///
  /// In en, this message translates to:
  /// **'Send report'**
  String get reportSend;

  /// No description provided for @attachmentsNoApp.
  ///
  /// In en, this message translates to:
  /// **'No app here opens this file. Pick one to send it to.'**
  String get attachmentsNoApp;

  /// No description provided for @attachmentsOpenFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t open this file'**
  String get attachmentsOpenFailed;

  /// No description provided for @attachmentsCheckMac.
  ///
  /// In en, this message translates to:
  /// **'Check that your Mac is connected, then try again.'**
  String get attachmentsCheckMac;

  /// No description provided for @attachmentsImageUnshowable.
  ///
  /// In en, this message translates to:
  /// **'This image can\'t be shown here'**
  String get attachmentsImageUnshowable;

  /// No description provided for @attachmentsOpenElsewhere.
  ///
  /// In en, this message translates to:
  /// **'Open in another app'**
  String get attachmentsOpenElsewhere;

  /// No description provided for @attachmentsOpen.
  ///
  /// In en, this message translates to:
  /// **'Open'**
  String get attachmentsOpen;

  /// No description provided for @attachmentsShare.
  ///
  /// In en, this message translates to:
  /// **'Share'**
  String get attachmentsShare;

  /// No description provided for @imagesSquare.
  ///
  /// In en, this message translates to:
  /// **'Square'**
  String get imagesSquare;

  /// No description provided for @imagesLandscape.
  ///
  /// In en, this message translates to:
  /// **'Landscape'**
  String get imagesLandscape;

  /// No description provided for @imagesPortrait.
  ///
  /// In en, this message translates to:
  /// **'Portrait'**
  String get imagesPortrait;

  /// No description provided for @imagesOnePerRequest.
  ///
  /// In en, this message translates to:
  /// **'One image per request. You can leave the chat while DJL works.'**
  String get imagesOnePerRequest;

  /// No description provided for @imagesCreate.
  ///
  /// In en, this message translates to:
  /// **'Create image'**
  String get imagesCreate;

  /// No description provided for @imagesMakeYours.
  ///
  /// In en, this message translates to:
  /// **'Make something yours.'**
  String get imagesMakeYours;

  /// No description provided for @imagesDescribe.
  ///
  /// In en, this message translates to:
  /// **'Describe the subject, style, and details you have in mind.'**
  String get imagesDescribe;

  /// No description provided for @imagesPromptHint.
  ///
  /// In en, this message translates to:
  /// **'A quiet studio in morning light…'**
  String get imagesPromptHint;

  /// No description provided for @imagesShape.
  ///
  /// In en, this message translates to:
  /// **'Shape'**
  String get imagesShape;

  /// No description provided for @imagesNotConfigured.
  ///
  /// In en, this message translates to:
  /// **'Image generation isn\'t configured on this server yet. Your saved images are still available.'**
  String get imagesNotConfigured;

  /// No description provided for @imagesStarting.
  ///
  /// In en, this message translates to:
  /// **'Starting…'**
  String get imagesStarting;

  /// No description provided for @imagesOpenImage.
  ///
  /// In en, this message translates to:
  /// **'Open image'**
  String get imagesOpenImage;

  /// No description provided for @imagesGenerated.
  ///
  /// In en, this message translates to:
  /// **'Generated image'**
  String get imagesGenerated;

  /// No description provided for @imagesOpenChat.
  ///
  /// In en, this message translates to:
  /// **'Open chat'**
  String get imagesOpenChat;

  /// No description provided for @imagesActions.
  ///
  /// In en, this message translates to:
  /// **'Image actions'**
  String get imagesActions;

  /// No description provided for @imagesEditInChat.
  ///
  /// In en, this message translates to:
  /// **'Edit in chat'**
  String get imagesEditInChat;

  /// No description provided for @imagesTitle.
  ///
  /// In en, this message translates to:
  /// **'Images'**
  String get imagesTitle;

  /// No description provided for @imagesYourImages.
  ///
  /// In en, this message translates to:
  /// **'Your images'**
  String get imagesYourImages;

  /// No description provided for @imagesEmpty.
  ///
  /// In en, this message translates to:
  /// **'Create an image and find it here, ready to save or share.'**
  String get imagesEmpty;

  /// No description provided for @imagesEmptyNotConfigured.
  ///
  /// In en, this message translates to:
  /// **'Image creation is not configured yet. Saved images will appear here.'**
  String get imagesEmptyNotConfigured;

  /// No description provided for @imagesLoadMore.
  ///
  /// In en, this message translates to:
  /// **'Load more'**
  String get imagesLoadMore;

  /// No description provided for @imagesYourImage.
  ///
  /// In en, this message translates to:
  /// **'Your image'**
  String get imagesYourImage;

  /// No description provided for @imagesShare.
  ///
  /// In en, this message translates to:
  /// **'Share'**
  String get imagesShare;

  /// No description provided for @imagesSaveToPhotos.
  ///
  /// In en, this message translates to:
  /// **'Save to Photos'**
  String get imagesSaveToPhotos;

  /// No description provided for @imagesSaved.
  ///
  /// In en, this message translates to:
  /// **'Saved to Photos.'**
  String get imagesSaved;

  /// No description provided for @authSocialNotConfigured.
  ///
  /// In en, this message translates to:
  /// **'Sign-in is not configured for this app. Continue with email.'**
  String get authSocialNotConfigured;

  /// No description provided for @authSocialOpenFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not open sign-in. Try again.'**
  String get authSocialOpenFailed;

  /// No description provided for @authSignInOptionsFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not load sign-in options.'**
  String get authSignInOptionsFailed;

  /// No description provided for @authCloudSignInFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not sign in to DJL Cloud. Try again.'**
  String get authCloudSignInFailed;

  /// No description provided for @authSecureStorageFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not open secure storage. Unlock your device and try again.'**
  String get authSecureStorageFailed;

  /// No description provided for @authCheckEmailForCode.
  ///
  /// In en, this message translates to:
  /// **'Check your email for a verification code.'**
  String get authCheckEmailForCode;

  /// No description provided for @authRequestSent.
  ///
  /// In en, this message translates to:
  /// **'Request sent. Check your email.'**
  String get authRequestSent;

  /// No description provided for @authCloudDataNotCleared.
  ///
  /// In en, this message translates to:
  /// **'Some saved Cloud data could not be cleared.'**
  String get authCloudDataNotCleared;

  /// No description provided for @authLinkOpenFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not open this link. Try again.'**
  String get authLinkOpenFailed;

  /// No description provided for @authWelcomeTitle.
  ///
  /// In en, this message translates to:
  /// **'Welcome to DJL'**
  String get authWelcomeTitle;

  /// No description provided for @authWelcomeSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Your ideas, conversations, and Mac.\nTogether in DJL.'**
  String get authWelcomeSubtitle;

  /// No description provided for @authRetrySignInOptions.
  ///
  /// In en, this message translates to:
  /// **'Retry sign-in options'**
  String get authRetrySignInOptions;

  /// No description provided for @authLoadingSignInOptions.
  ///
  /// In en, this message translates to:
  /// **'Loading sign-in options'**
  String get authLoadingSignInOptions;

  /// No description provided for @authContinueWithApple.
  ///
  /// In en, this message translates to:
  /// **'Continue with Apple'**
  String get authContinueWithApple;

  /// No description provided for @authContinueWithGoogle.
  ///
  /// In en, this message translates to:
  /// **'Continue with Google'**
  String get authContinueWithGoogle;

  /// No description provided for @authContinueWithEmail.
  ///
  /// In en, this message translates to:
  /// **'Continue with email'**
  String get authContinueWithEmail;

  /// No description provided for @authPairWithMac.
  ///
  /// In en, this message translates to:
  /// **'Pair with a Mac'**
  String get authPairWithMac;

  /// No description provided for @authNoMacHint.
  ///
  /// In en, this message translates to:
  /// **'No Mac? Sign in to chat with DJL Cloud.'**
  String get authNoMacHint;

  /// No description provided for @authTerms.
  ///
  /// In en, this message translates to:
  /// **'Terms'**
  String get authTerms;

  /// No description provided for @authPrivacy.
  ///
  /// In en, this message translates to:
  /// **'Privacy'**
  String get authPrivacy;

  /// No description provided for @authVerifyAndContinue.
  ///
  /// In en, this message translates to:
  /// **'Verify and continue'**
  String get authVerifyAndContinue;

  /// No description provided for @authSignIn.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get authSignIn;

  /// No description provided for @authEmailMeCode.
  ///
  /// In en, this message translates to:
  /// **'Email me a code'**
  String get authEmailMeCode;

  /// No description provided for @authCreateAccount.
  ///
  /// In en, this message translates to:
  /// **'Create account'**
  String get authCreateAccount;

  /// No description provided for @authSignInIncomplete.
  ///
  /// In en, this message translates to:
  /// **'Could not complete sign-in. Try again.'**
  String get authSignInIncomplete;

  /// No description provided for @authPassword.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get authPassword;

  /// No description provided for @authEmailCode.
  ///
  /// In en, this message translates to:
  /// **'Email code'**
  String get authEmailCode;

  /// No description provided for @authName.
  ///
  /// In en, this message translates to:
  /// **'Name'**
  String get authName;

  /// No description provided for @authEmail.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get authEmail;

  /// No description provided for @authSixDigitCode.
  ///
  /// In en, this message translates to:
  /// **'6-digit code'**
  String get authSixDigitCode;

  /// No description provided for @authCodeSent.
  ///
  /// In en, this message translates to:
  /// **'We sent a code to {email}. It expires in 10 minutes.'**
  String authCodeSent(String email);

  /// No description provided for @authCreateAccountHint.
  ///
  /// In en, this message translates to:
  /// **'Use at least 10 characters. We\'ll email you a code to confirm your address.'**
  String get authCreateAccountHint;

  /// No description provided for @authResendCode.
  ///
  /// In en, this message translates to:
  /// **'Resend code'**
  String get authResendCode;

  /// No description provided for @authResendIn.
  ///
  /// In en, this message translates to:
  /// **'Resend in {seconds}s'**
  String authResendIn(int seconds);

  /// No description provided for @authUseAnotherEmail.
  ///
  /// In en, this message translates to:
  /// **'Use another email'**
  String get authUseAnotherEmail;

  /// No description provided for @authForgotPassword.
  ///
  /// In en, this message translates to:
  /// **'Forgot password?'**
  String get authForgotPassword;

  /// No description provided for @authResetPassword.
  ///
  /// In en, this message translates to:
  /// **'Reset password'**
  String get authResetPassword;

  /// No description provided for @authPasswordUpdated.
  ///
  /// In en, this message translates to:
  /// **'Password updated'**
  String get authPasswordUpdated;

  /// No description provided for @authSignInWithNewPassword.
  ///
  /// In en, this message translates to:
  /// **'Sign in with your new password.'**
  String get authSignInWithNewPassword;

  /// No description provided for @authBackToSignIn.
  ///
  /// In en, this message translates to:
  /// **'Back to sign in'**
  String get authBackToSignIn;

  /// No description provided for @authNewPassword.
  ///
  /// In en, this message translates to:
  /// **'New password'**
  String get authNewPassword;

  /// No description provided for @authRecoveryHint.
  ///
  /// In en, this message translates to:
  /// **'We\'ll send a recovery code if an account exists for this email.'**
  String get authRecoveryHint;

  /// No description provided for @authRecoveryCodeHint.
  ///
  /// In en, this message translates to:
  /// **'Enter your recovery code and a password with 10–256 characters.'**
  String get authRecoveryCodeHint;

  /// No description provided for @authSendRecoveryCode.
  ///
  /// In en, this message translates to:
  /// **'Send recovery code'**
  String get authSendRecoveryCode;

  /// No description provided for @chatUiWorktreeHandoffFailed.
  ///
  /// In en, this message translates to:
  /// **'Worktree Handoff Failed'**
  String get chatUiWorktreeHandoffFailed;

  /// No description provided for @chatUiOk.
  ///
  /// In en, this message translates to:
  /// **'OK'**
  String get chatUiOk;

  /// No description provided for @chatUiSelectFolder.
  ///
  /// In en, this message translates to:
  /// **'Select folder'**
  String get chatUiSelectFolder;

  /// No description provided for @chatUiBrowseFolders.
  ///
  /// In en, this message translates to:
  /// **'Browse local folders…'**
  String get chatUiBrowseFolders;

  /// No description provided for @chatUiBranchOpenElsewhere.
  ///
  /// In en, this message translates to:
  /// **'Branch already open elsewhere'**
  String get chatUiBranchOpenElsewhere;

  /// No description provided for @chatUiBranchOpenElsewhereChat.
  ///
  /// In en, this message translates to:
  /// **'\'{branch}\' is already checked out in another worktree. Open that chat to continue there.'**
  String chatUiBranchOpenElsewhereChat(String branch);

  /// No description provided for @chatUiBranchOpenElsewhereSidebar.
  ///
  /// In en, this message translates to:
  /// **'\'{branch}\' is already checked out in another worktree. Open that chat from the sidebar to continue there.'**
  String chatUiBranchOpenElsewhereSidebar(String branch);

  /// No description provided for @chatUiOpenChat.
  ///
  /// In en, this message translates to:
  /// **'Open Chat'**
  String get chatUiOpenChat;

  /// No description provided for @chatUiWorktreeChatGone.
  ///
  /// In en, this message translates to:
  /// **'The worktree chat is no longer available. Open it from the sidebar.'**
  String get chatUiWorktreeChatGone;

  /// No description provided for @chatUiPhotoLibrary.
  ///
  /// In en, this message translates to:
  /// **'Photo library'**
  String get chatUiPhotoLibrary;

  /// No description provided for @chatUiTakePhoto.
  ///
  /// In en, this message translates to:
  /// **'Take a photo'**
  String get chatUiTakePhoto;

  /// No description provided for @chatUiPlanMode.
  ///
  /// In en, this message translates to:
  /// **'Plan mode'**
  String get chatUiPlanMode;

  /// No description provided for @chatUiFastMode.
  ///
  /// In en, this message translates to:
  /// **'Fast mode'**
  String get chatUiFastMode;

  /// No description provided for @chatUiImage.
  ///
  /// In en, this message translates to:
  /// **'Image'**
  String get chatUiImage;

  /// No description provided for @chatUiOpensThreadLocation.
  ///
  /// In en, this message translates to:
  /// **'Opens thread location'**
  String get chatUiOpensThreadLocation;

  /// No description provided for @chatUiDesktopChat.
  ///
  /// In en, this message translates to:
  /// **'Desktop chat'**
  String get chatUiDesktopChat;

  /// No description provided for @chatUiNewThread.
  ///
  /// In en, this message translates to:
  /// **'New thread'**
  String get chatUiNewThread;

  /// No description provided for @chatUiHandOffToDesktop.
  ///
  /// In en, this message translates to:
  /// **'Hand off to Desktop'**
  String get chatUiHandOffToDesktop;

  /// No description provided for @chatUiHandOffToLocal.
  ///
  /// In en, this message translates to:
  /// **'Hand off to Local'**
  String get chatUiHandOffToLocal;

  /// No description provided for @chatUiHandOffToWorktree.
  ///
  /// In en, this message translates to:
  /// **'Hand off to Worktree'**
  String get chatUiHandOffToWorktree;

  /// No description provided for @chatUiGoal.
  ///
  /// In en, this message translates to:
  /// **'Goal'**
  String get chatUiGoal;

  /// No description provided for @chatUiForkChat.
  ///
  /// In en, this message translates to:
  /// **'Fork this chat'**
  String get chatUiForkChat;

  /// No description provided for @chatUiForkIntoFolder.
  ///
  /// In en, this message translates to:
  /// **'Fork into another folder'**
  String get chatUiForkIntoFolder;

  /// No description provided for @chatUiForkIntoWorktree.
  ///
  /// In en, this message translates to:
  /// **'Fork into new worktree'**
  String get chatUiForkIntoWorktree;

  /// No description provided for @chatUiWorkspaceFiles.
  ///
  /// In en, this message translates to:
  /// **'Workspace files'**
  String get chatUiWorkspaceFiles;

  /// No description provided for @chatUiTurnChanges.
  ///
  /// In en, this message translates to:
  /// **'Turn changes and restore'**
  String get chatUiTurnChanges;

  /// No description provided for @chatUiRefreshFromDesktop.
  ///
  /// In en, this message translates to:
  /// **'Refresh from desktop'**
  String get chatUiRefreshFromDesktop;

  /// No description provided for @chatUiDesktopDisconnected.
  ///
  /// In en, this message translates to:
  /// **'Desktop disconnected. Your message has not been resent.'**
  String get chatUiDesktopDisconnected;

  /// No description provided for @chatUiLinkedPositionUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Linked position is not available in the loaded history.'**
  String get chatUiLinkedPositionUnavailable;

  /// No description provided for @chatUiReviewResponseChanges.
  ///
  /// In en, this message translates to:
  /// **'Review exact response changes'**
  String get chatUiReviewResponseChanges;

  /// No description provided for @chatUiResponseUndone.
  ///
  /// In en, this message translates to:
  /// **'Response undone'**
  String get chatUiResponseUndone;

  /// No description provided for @chatUiUndoResponse.
  ///
  /// In en, this message translates to:
  /// **'Undo this response'**
  String get chatUiUndoResponse;

  /// No description provided for @chatUiApprovalRequired.
  ///
  /// In en, this message translates to:
  /// **'Approval required'**
  String get chatUiApprovalRequired;

  /// No description provided for @chatUiApprovalSent.
  ///
  /// In en, this message translates to:
  /// **'Response sent. Waiting for the desktop.'**
  String get chatUiApprovalSent;

  /// No description provided for @chatUiDecline.
  ///
  /// In en, this message translates to:
  /// **'Decline'**
  String get chatUiDecline;

  /// No description provided for @chatUiApproveOnce.
  ///
  /// In en, this message translates to:
  /// **'Approve once'**
  String get chatUiApproveOnce;

  /// No description provided for @chatUiBranch.
  ///
  /// In en, this message translates to:
  /// **'Branch'**
  String get chatUiBranch;

  /// No description provided for @chatUiPreparingWorktree.
  ///
  /// In en, this message translates to:
  /// **'Preparing worktree...'**
  String get chatUiPreparingWorktree;

  /// No description provided for @chatUiNewWorktree.
  ///
  /// In en, this message translates to:
  /// **'New worktree'**
  String get chatUiNewWorktree;

  /// No description provided for @chatUiGoalChip.
  ///
  /// In en, this message translates to:
  /// **'Goal {status} · {elapsed}'**
  String chatUiGoalChip(String status, String elapsed);

  /// No description provided for @chatUiReturnToParent.
  ///
  /// In en, this message translates to:
  /// **'Return to parent chat'**
  String get chatUiReturnToParent;

  /// No description provided for @chatUiReturnTo.
  ///
  /// In en, this message translates to:
  /// **'Return to {title}'**
  String chatUiReturnTo(String title);

  /// No description provided for @chatUiAskDjl.
  ///
  /// In en, this message translates to:
  /// **'Ask DJL'**
  String get chatUiAskDjl;

  /// No description provided for @chatUiFollowUp.
  ///
  /// In en, this message translates to:
  /// **'Follow up'**
  String get chatUiFollowUp;

  /// No description provided for @workspaceRestoreFailed.
  ///
  /// In en, this message translates to:
  /// **'The desktop did not confirm the restore. Refresh before retrying.'**
  String get workspaceRestoreFailed;

  /// No description provided for @workspaceRestoredFiles.
  ///
  /// In en, this message translates to:
  /// **'Restored {count} files.'**
  String workspaceRestoredFiles(int count);

  /// No description provided for @workspaceBackupSaved.
  ///
  /// In en, this message translates to:
  /// **' A backup checkpoint was saved on your Mac.'**
  String get workspaceBackupSaved;

  /// No description provided for @workspaceNoLocalFolders.
  ///
  /// In en, this message translates to:
  /// **'No local folders are available from this device.'**
  String get workspaceNoLocalFolders;

  /// No description provided for @workspaceUndoReviewChanged.
  ///
  /// In en, this message translates to:
  /// **'The response or connection changed. Reopen this review.'**
  String get workspaceUndoReviewChanged;

  /// No description provided for @workspaceUndoPreviewFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not preview the exact patch. Refresh the review before trying again.'**
  String get workspaceUndoPreviewFailed;

  /// No description provided for @workspaceUndoRepositoryChanged.
  ///
  /// In en, this message translates to:
  /// **'The response or repository changed. Reopen this review.'**
  String get workspaceUndoRepositoryChanged;

  /// No description provided for @workspaceUndoResultUnknownChanged.
  ///
  /// In en, this message translates to:
  /// **'The connection or response changed. The undo result is unknown; refresh and review it.'**
  String get workspaceUndoResultUnknownChanged;

  /// No description provided for @workspaceUndoRefused.
  ///
  /// In en, this message translates to:
  /// **'The desktop did not undo the response. Review the current conflicts and staged files.'**
  String get workspaceUndoRefused;

  /// No description provided for @workspaceUndoResultUnknown.
  ///
  /// In en, this message translates to:
  /// **'The undo result is unknown. Refresh and review the exact patch before another attempt.'**
  String get workspaceUndoResultUnknown;

  /// No description provided for @workspaceUndoSaveAfterSuccessFailed.
  ///
  /// In en, this message translates to:
  /// **'Undo succeeded, but saving or refreshing its local result failed. Reconnect to verify the files.'**
  String get workspaceUndoSaveAfterSuccessFailed;

  /// No description provided for @workspaceUndoSaveFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not save the undo result. Reconnect and review the current files.'**
  String get workspaceUndoSaveFailed;

  /// No description provided for @workspaceUndoTitle.
  ///
  /// In en, this message translates to:
  /// **'Undo this response'**
  String get workspaceUndoTitle;

  /// No description provided for @workspaceUndoWorkspace.
  ///
  /// In en, this message translates to:
  /// **'Workspace: {path}'**
  String workspaceUndoWorkspace(String path);

  /// No description provided for @workspaceUndoIntro.
  ///
  /// In en, this message translates to:
  /// **'Review the exact changes from this response. Later edits stay in place where the reverse patch can apply. The desktop checks conflicts again when you confirm.'**
  String get workspaceUndoIntro;

  /// No description provided for @workspaceUndoOverlap.
  ///
  /// In en, this message translates to:
  /// **'Other responses touch these files. Review carefully: undo may overlap changes in this or another chat.'**
  String get workspaceUndoOverlap;

  /// No description provided for @workspaceUndoUncertain.
  ///
  /// In en, this message translates to:
  /// **'A previous undo result is unknown. Refresh this review and inspect the current files before confirming another attempt.'**
  String get workspaceUndoUncertain;

  /// No description provided for @workspaceUndoStale.
  ///
  /// In en, this message translates to:
  /// **'This review is no longer current. Close it and reopen the response.'**
  String get workspaceUndoStale;

  /// No description provided for @workspaceUndoDone.
  ///
  /// In en, this message translates to:
  /// **'This response was undone.'**
  String get workspaceUndoDone;

  /// No description provided for @workspaceUndoStagedBlock.
  ///
  /// In en, this message translates to:
  /// **'Staged files block undo: {files}'**
  String workspaceUndoStagedBlock(String files);

  /// No description provided for @workspaceUndoConflict.
  ///
  /// In en, this message translates to:
  /// **'Conflict: {conflict}'**
  String workspaceUndoConflict(String conflict);

  /// No description provided for @workspaceUndoCannotReverse.
  ///
  /// In en, this message translates to:
  /// **'The desktop cannot safely reverse this patch.'**
  String get workspaceUndoCannotReverse;

  /// No description provided for @workspaceClose.
  ///
  /// In en, this message translates to:
  /// **'Close'**
  String get workspaceClose;

  /// No description provided for @workspaceRefreshReview.
  ///
  /// In en, this message translates to:
  /// **'Refresh review'**
  String get workspaceRefreshReview;

  /// No description provided for @workspaceUndoResponse.
  ///
  /// In en, this message translates to:
  /// **'Undo response'**
  String get workspaceUndoResponse;

  /// No description provided for @workspaceConflictFallback.
  ///
  /// In en, this message translates to:
  /// **'Conflict'**
  String get workspaceConflictFallback;

  /// No description provided for @workspaceAlreadyUndone.
  ///
  /// In en, this message translates to:
  /// **'This response was already undone.'**
  String get workspaceAlreadyUndone;

  /// No description provided for @workspaceStillRunning.
  ///
  /// In en, this message translates to:
  /// **'This response is still running.'**
  String get workspaceStillRunning;

  /// No description provided for @workspaceNoDesktopWorkspace.
  ///
  /// In en, this message translates to:
  /// **'The response has no desktop workspace.'**
  String get workspaceNoDesktopWorkspace;

  /// No description provided for @workspaceNoPatchCaptured.
  ///
  /// In en, this message translates to:
  /// **'No supported exact response patch was captured.'**
  String get workspaceNoPatchCaptured;

  /// No description provided for @workspaceRestoreTitle.
  ///
  /// In en, this message translates to:
  /// **'Restore workspace before this turn?'**
  String get workspaceRestoreTitle;

  /// No description provided for @workspaceRestoreBody.
  ///
  /// In en, this message translates to:
  /// **'This replaces current workspace files and removes untracked files. Review the affected files before restoring. The Mac saves a backup checkpoint first.'**
  String get workspaceRestoreBody;

  /// No description provided for @workspaceNoAffectedFiles.
  ///
  /// In en, this message translates to:
  /// **'No affected files reported.'**
  String get workspaceNoAffectedFiles;

  /// No description provided for @workspaceStagedFiles.
  ///
  /// In en, this message translates to:
  /// **'Staged files'**
  String get workspaceStagedFiles;

  /// No description provided for @workspaceUntrackedFiles.
  ///
  /// In en, this message translates to:
  /// **'Untracked files'**
  String get workspaceUntrackedFiles;

  /// No description provided for @workspaceRestoreFiles.
  ///
  /// In en, this message translates to:
  /// **'Restore files'**
  String get workspaceRestoreFiles;

  /// No description provided for @workspaceTurnChanges.
  ///
  /// In en, this message translates to:
  /// **'Turn changes'**
  String get workspaceTurnChanges;

  /// No description provided for @workspaceReloadTurnChanges.
  ///
  /// In en, this message translates to:
  /// **'Reload turn changes'**
  String get workspaceReloadTurnChanges;

  /// No description provided for @workspaceConversationTurn.
  ///
  /// In en, this message translates to:
  /// **'Conversation turn'**
  String get workspaceConversationTurn;

  /// No description provided for @workspaceTurnNumber.
  ///
  /// In en, this message translates to:
  /// **'Turn {number}'**
  String workspaceTurnNumber(int number);

  /// No description provided for @workspaceNoSavedChanges.
  ///
  /// In en, this message translates to:
  /// **'No saved changes for this turn.'**
  String get workspaceNoSavedChanges;

  /// No description provided for @workspaceNoCompletedTurns.
  ///
  /// In en, this message translates to:
  /// **'No completed turns yet.'**
  String get workspaceNoCompletedTurns;

  /// No description provided for @workspaceChooseTurn.
  ///
  /// In en, this message translates to:
  /// **'Choose a turn to view its saved workspace changes.'**
  String get workspaceChooseTurn;

  /// No description provided for @workspaceStopBeforeRestore.
  ///
  /// In en, this message translates to:
  /// **'Stop the running turn before restoring files.'**
  String get workspaceStopBeforeRestore;

  /// No description provided for @workspacePreviewRestore.
  ///
  /// In en, this message translates to:
  /// **'Preview restore before this turn'**
  String get workspacePreviewRestore;

  /// No description provided for @workspaceFileFallbackTitle.
  ///
  /// In en, this message translates to:
  /// **'Workspace file'**
  String get workspaceFileFallbackTitle;

  /// No description provided for @workspaceCopyFileContents.
  ///
  /// In en, this message translates to:
  /// **'Copy file contents'**
  String get workspaceCopyFileContents;

  /// No description provided for @workspaceFileContentsCopied.
  ///
  /// In en, this message translates to:
  /// **'File contents copied.'**
  String get workspaceFileContentsCopied;

  /// No description provided for @workspaceReloadFile.
  ///
  /// In en, this message translates to:
  /// **'Reload file'**
  String get workspaceReloadFile;

  /// No description provided for @workspaceFilePathOnMac.
  ///
  /// In en, this message translates to:
  /// **'File path on your Mac'**
  String get workspaceFilePathOnMac;

  /// No description provided for @workspaceSegmentText.
  ///
  /// In en, this message translates to:
  /// **'Text'**
  String get workspaceSegmentText;

  /// No description provided for @workspaceSegmentImage.
  ///
  /// In en, this message translates to:
  /// **'Image'**
  String get workspaceSegmentImage;

  /// No description provided for @workspaceOpen.
  ///
  /// In en, this message translates to:
  /// **'Open'**
  String get workspaceOpen;

  /// No description provided for @workspaceSvgRenderFailed.
  ///
  /// In en, this message translates to:
  /// **'This SVG could not be rendered.'**
  String get workspaceSvgRenderFailed;

  /// No description provided for @workspaceImageRenderFailed.
  ///
  /// In en, this message translates to:
  /// **'This image format could not be rendered on this device.'**
  String get workspaceImageRenderFailed;

  /// No description provided for @workspaceOpenFileToPreview.
  ///
  /// In en, this message translates to:
  /// **'Open a workspace file to preview it.'**
  String get workspaceOpenFileToPreview;

  /// No description provided for @workspaceSavedToPhotos.
  ///
  /// In en, this message translates to:
  /// **'Saved to Photos.'**
  String get workspaceSavedToPhotos;

  /// No description provided for @workspaceImageTitle.
  ///
  /// In en, this message translates to:
  /// **'Image'**
  String get workspaceImageTitle;

  /// No description provided for @workspaceOk.
  ///
  /// In en, this message translates to:
  /// **'OK'**
  String get workspaceOk;

  /// No description provided for @workspaceLoadingFile.
  ///
  /// In en, this message translates to:
  /// **'Loading file'**
  String get workspaceLoadingFile;

  /// No description provided for @workspaceUnableToLoadFile.
  ///
  /// In en, this message translates to:
  /// **'Unable to load file.'**
  String get workspaceUnableToLoadFile;

  /// No description provided for @workspaceRetry.
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get workspaceRetry;

  /// No description provided for @workspaceCloseFilePreview.
  ///
  /// In en, this message translates to:
  /// **'Close file preview'**
  String get workspaceCloseFilePreview;

  /// No description provided for @workspaceDone.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get workspaceDone;

  /// No description provided for @workspaceFindInFile.
  ///
  /// In en, this message translates to:
  /// **'Find in file'**
  String get workspaceFindInFile;

  /// No description provided for @workspaceLineCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 line} other{{count} lines}}'**
  String workspaceLineCount(int count);

  /// No description provided for @workspaceByteCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 byte} other{{count} bytes}}'**
  String workspaceByteCount(int count);

  /// No description provided for @workspaceCloseSvgPreview.
  ///
  /// In en, this message translates to:
  /// **'Close SVG preview'**
  String get workspaceCloseSvgPreview;

  /// No description provided for @workspaceReloadSvgPreview.
  ///
  /// In en, this message translates to:
  /// **'Reload SVG preview'**
  String get workspaceReloadSvgPreview;

  /// No description provided for @workspaceShare.
  ///
  /// In en, this message translates to:
  /// **'Share'**
  String get workspaceShare;

  /// No description provided for @workspaceSaveToPhotos.
  ///
  /// In en, this message translates to:
  /// **'Save to Photos'**
  String get workspaceSaveToPhotos;

  /// No description provided for @workspaceUnableToDisplayImage.
  ///
  /// In en, this message translates to:
  /// **'Unable to display image.'**
  String get workspaceUnableToDisplayImage;

  /// No description provided for @workspaceFileContents.
  ///
  /// In en, this message translates to:
  /// **'File contents'**
  String get workspaceFileContents;

  /// No description provided for @workspaceSearching.
  ///
  /// In en, this message translates to:
  /// **'Searching…'**
  String get workspaceSearching;

  /// No description provided for @workspaceMatchPosition.
  ///
  /// In en, this message translates to:
  /// **'{index} of {total}'**
  String workspaceMatchPosition(int index, int total);

  /// No description provided for @workspacePreviousMatch.
  ///
  /// In en, this message translates to:
  /// **'Previous match'**
  String get workspacePreviousMatch;

  /// No description provided for @workspaceNextMatch.
  ///
  /// In en, this message translates to:
  /// **'Next match'**
  String get workspaceNextMatch;

  /// No description provided for @workspaceCloseFind.
  ///
  /// In en, this message translates to:
  /// **'Close find'**
  String get workspaceCloseFind;

  /// No description provided for @workspaceAddLocalFolder.
  ///
  /// In en, this message translates to:
  /// **'Add Local Folder'**
  String get workspaceAddLocalFolder;

  /// No description provided for @workspaceCreateFolderOnMac.
  ///
  /// In en, this message translates to:
  /// **'Create folder on Mac'**
  String get workspaceCreateFolderOnMac;

  /// No description provided for @workspaceUse.
  ///
  /// In en, this message translates to:
  /// **'Use'**
  String get workspaceUse;

  /// No description provided for @workspaceParentFolder.
  ///
  /// In en, this message translates to:
  /// **'Parent Folder'**
  String get workspaceParentFolder;

  /// No description provided for @workspaceSearchingFolders.
  ///
  /// In en, this message translates to:
  /// **'Searching folders...'**
  String get workspaceSearchingFolders;

  /// No description provided for @workspaceLoading.
  ///
  /// In en, this message translates to:
  /// **'Loading'**
  String get workspaceLoading;

  /// No description provided for @workspaceNoMatchingFolders.
  ///
  /// In en, this message translates to:
  /// **'No matching folders under this folder.'**
  String get workspaceNoMatchingFolders;

  /// No description provided for @workspaceNoChildFolders.
  ///
  /// In en, this message translates to:
  /// **'No child folders here.'**
  String get workspaceNoChildFolders;

  /// No description provided for @workspaceSearchFolders.
  ///
  /// In en, this message translates to:
  /// **'Search folders'**
  String get workspaceSearchFolders;

  /// No description provided for @workspaceClearFolderSearch.
  ///
  /// In en, this message translates to:
  /// **'Clear folder search'**
  String get workspaceClearFolderSearch;

  /// No description provided for @workspaceLocations.
  ///
  /// In en, this message translates to:
  /// **'Locations'**
  String get workspaceLocations;

  /// No description provided for @workspaceCurrentFolder.
  ///
  /// In en, this message translates to:
  /// **'Current Folder'**
  String get workspaceCurrentFolder;

  /// No description provided for @workspaceLoadingFolders.
  ///
  /// In en, this message translates to:
  /// **'Loading folders...'**
  String get workspaceLoadingFolders;

  /// No description provided for @workspaceNoFolderSelected.
  ///
  /// In en, this message translates to:
  /// **'No folder selected.'**
  String get workspaceNoFolderSelected;

  /// No description provided for @workspaceMatchingFolders.
  ///
  /// In en, this message translates to:
  /// **'Matching Folders'**
  String get workspaceMatchingFolders;

  /// No description provided for @workspaceFolders.
  ///
  /// In en, this message translates to:
  /// **'Folders'**
  String get workspaceFolders;

  /// No description provided for @workspaceNewFolder.
  ///
  /// In en, this message translates to:
  /// **'New Folder'**
  String get workspaceNewFolder;

  /// No description provided for @workspaceNewFolderBody.
  ///
  /// In en, this message translates to:
  /// **'Create this folder on your device and start a chat there.'**
  String get workspaceNewFolderBody;

  /// No description provided for @workspaceFolderName.
  ///
  /// In en, this message translates to:
  /// **'Folder name'**
  String get workspaceFolderName;

  /// No description provided for @workspaceCreate.
  ///
  /// In en, this message translates to:
  /// **'Create'**
  String get workspaceCreate;

  /// No description provided for @workspaceDesktopChangedPicker.
  ///
  /// In en, this message translates to:
  /// **'Connected desktop changed. Reopen the project picker.'**
  String get workspaceDesktopChangedPicker;

  /// No description provided for @workspaceDesktopChanged.
  ///
  /// In en, this message translates to:
  /// **'Connected desktop changed. Reopen this workspace.'**
  String get workspaceDesktopChanged;

  /// No description provided for @workspaceChooseWorkspaceFirst.
  ///
  /// In en, this message translates to:
  /// **'Choose a workspace on your desktop first.'**
  String get workspaceChooseWorkspaceFirst;

  /// No description provided for @workspaceNoTextInPreview.
  ///
  /// In en, this message translates to:
  /// **'The file preview did not include text. Reload it from the workspace.'**
  String get workspaceNoTextInPreview;

  /// No description provided for @workspaceNoImageInPreview.
  ///
  /// In en, this message translates to:
  /// **'The image preview did not include image data. Reload it from the workspace.'**
  String get workspaceNoImageInPreview;

  /// No description provided for @workspaceRestorePreviewOtherWorkspace.
  ///
  /// In en, this message translates to:
  /// **'This restore preview belongs to another workspace. Preview it again.'**
  String get workspaceRestorePreviewOtherWorkspace;

  /// No description provided for @cloudChatNewChat.
  ///
  /// In en, this message translates to:
  /// **'New chat'**
  String get cloudChatNewChat;

  /// No description provided for @cloudChatLostConnection.
  ///
  /// In en, this message translates to:
  /// **'Lost connection. Tap Reconnect to resume this response.'**
  String get cloudChatLostConnection;

  /// No description provided for @cloudChatImageToEdit.
  ///
  /// In en, this message translates to:
  /// **'Image to edit'**
  String get cloudChatImageToEdit;

  /// No description provided for @cloudChatNoContent.
  ///
  /// In en, this message translates to:
  /// **'No response content.'**
  String get cloudChatNoContent;

  /// No description provided for @cloudChatThinking.
  ///
  /// In en, this message translates to:
  /// **'Thinking…'**
  String get cloudChatThinking;

  /// No description provided for @cloudChatResponseStopped.
  ///
  /// In en, this message translates to:
  /// **'Response stopped.'**
  String get cloudChatResponseStopped;

  /// No description provided for @cloudChatResponseFailed.
  ///
  /// In en, this message translates to:
  /// **'Response failed.'**
  String get cloudChatResponseFailed;

  /// No description provided for @cloudChatWaitingForUsageReset.
  ///
  /// In en, this message translates to:
  /// **'Waiting for usage reset.'**
  String get cloudChatWaitingForUsageReset;

  /// No description provided for @cloudChatModelChoiceLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not load your saved model choice. Retry.'**
  String get cloudChatModelChoiceLoadFailed;

  /// No description provided for @cloudChatModelChoiceSaveFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not save your model choice. Retry.'**
  String get cloudChatModelChoiceSaveFailed;

  /// No description provided for @cloudChatDraftSaveFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not save your draft. Keep the text here and retry.'**
  String get cloudChatDraftSaveFailed;

  /// No description provided for @cloudChatDraftLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not load your saved draft. Retry before editing.'**
  String get cloudChatDraftLoadFailed;

  /// No description provided for @cloudChatInterruptedImage.
  ///
  /// In en, this message translates to:
  /// **'An interrupted image request is saved securely. Retry to check its result.'**
  String get cloudChatInterruptedImage;

  /// No description provided for @cloudChatInterruptedMessage.
  ///
  /// In en, this message translates to:
  /// **'An interrupted message is saved securely. Retry to check its result.'**
  String get cloudChatInterruptedMessage;

  /// No description provided for @cloudChatModelCannotViewImages.
  ///
  /// In en, this message translates to:
  /// **'Choose a model that can view images before sending this attachment.'**
  String get cloudChatModelCannotViewImages;

  /// No description provided for @cloudChatImageGenerationUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Image generation is not configured for this service.'**
  String get cloudChatImageGenerationUnavailable;

  /// No description provided for @cloudChatUseBankedResetTitle.
  ///
  /// In en, this message translates to:
  /// **'Use a banked reset?'**
  String get cloudChatUseBankedResetTitle;

  /// No description provided for @cloudChatUseBankedResetBody.
  ///
  /// In en, this message translates to:
  /// **'Both your 5-hour and weekly limits start over now, and your week restarts today.'**
  String get cloudChatUseBankedResetBody;

  /// No description provided for @cloudChatUseReset.
  ///
  /// In en, this message translates to:
  /// **'Use reset'**
  String get cloudChatUseReset;

  /// No description provided for @cloudChatLimitFreesSoon.
  ///
  /// In en, this message translates to:
  /// **'Your limit frees up again soon.'**
  String get cloudChatLimitFreesSoon;

  /// No description provided for @cloudChatResetsNow.
  ///
  /// In en, this message translates to:
  /// **'It resets now.'**
  String get cloudChatResetsNow;

  /// No description provided for @cloudChatResetsTomorrow.
  ///
  /// In en, this message translates to:
  /// **'It resets tomorrow.'**
  String get cloudChatResetsTomorrow;

  /// No description provided for @cloudChatResetsInDays.
  ///
  /// In en, this message translates to:
  /// **'It resets in {days} days.'**
  String cloudChatResetsInDays(int days);

  /// No description provided for @cloudChatResetsOn.
  ///
  /// In en, this message translates to:
  /// **'It resets {date}.'**
  String cloudChatResetsOn(String date);

  /// No description provided for @cloudChatResetsInAMoment.
  ///
  /// In en, this message translates to:
  /// **'It resets in a moment.'**
  String get cloudChatResetsInAMoment;

  /// No description provided for @cloudChatResetsInMinutes.
  ///
  /// In en, this message translates to:
  /// **'{minutes, plural, =1{It resets in 1 minute.} other{It resets in {minutes} minutes.}}'**
  String cloudChatResetsInMinutes(int minutes);

  /// No description provided for @cloudChatResetsInHours.
  ///
  /// In en, this message translates to:
  /// **'{hours, plural, =1{It resets in 1 hour.} other{It resets in {hours} hours.}}'**
  String cloudChatResetsInHours(int hours);

  /// No description provided for @cloudChatUsageLimitReached.
  ///
  /// In en, this message translates to:
  /// **'You\'ve reached your usage limit'**
  String get cloudChatUsageLimitReached;

  /// No description provided for @cloudChatRetryUsage.
  ///
  /// In en, this message translates to:
  /// **'Retry usage'**
  String get cloudChatRetryUsage;

  /// No description provided for @cloudChatUseBankedReset.
  ///
  /// In en, this message translates to:
  /// **'Use a banked reset ({count} left)'**
  String cloudChatUseBankedReset(int count);

  /// No description provided for @cloudChatPickerFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not open the picker. Please try again.'**
  String get cloudChatPickerFailed;

  /// No description provided for @cloudChatModel.
  ///
  /// In en, this message translates to:
  /// **'Model'**
  String get cloudChatModel;

  /// No description provided for @cloudChatShareLink.
  ///
  /// In en, this message translates to:
  /// **'Share link'**
  String get cloudChatShareLink;

  /// No description provided for @cloudChatTaskPrompt.
  ///
  /// In en, this message translates to:
  /// **'What should DJL work on?'**
  String get cloudChatTaskPrompt;

  /// No description provided for @cloudChatHowCanIHelp.
  ///
  /// In en, this message translates to:
  /// **'How can I help?'**
  String get cloudChatHowCanIHelp;

  /// No description provided for @cloudChatTaskHint.
  ///
  /// In en, this message translates to:
  /// **'Start a task and return to the result when it\'s ready.'**
  String get cloudChatTaskHint;

  /// No description provided for @cloudChatStepProgress.
  ///
  /// In en, this message translates to:
  /// **'Step {step} of {total}'**
  String cloudChatStepProgress(String step, String total);

  /// No description provided for @cloudChatRetry.
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get cloudChatRetry;

  /// No description provided for @cloudChatRetryDraft.
  ///
  /// In en, this message translates to:
  /// **'Retry draft'**
  String get cloudChatRetryDraft;

  /// No description provided for @cloudChatRetryModelChoice.
  ///
  /// In en, this message translates to:
  /// **'Retry model choice'**
  String get cloudChatRetryModelChoice;

  /// No description provided for @cloudChatMessageHint.
  ///
  /// In en, this message translates to:
  /// **'Message DJL'**
  String get cloudChatMessageHint;

  /// No description provided for @cloudChatAttachTooltip.
  ///
  /// In en, this message translates to:
  /// **'Attach file or image'**
  String get cloudChatAttachTooltip;

  /// No description provided for @cloudChatCreateImage.
  ///
  /// In en, this message translates to:
  /// **'Create image'**
  String get cloudChatCreateImage;

  /// No description provided for @cloudChatChooseFile.
  ///
  /// In en, this message translates to:
  /// **'Choose file'**
  String get cloudChatChooseFile;

  /// No description provided for @cloudChatPhotoLibrary.
  ///
  /// In en, this message translates to:
  /// **'Photo library'**
  String get cloudChatPhotoLibrary;

  /// No description provided for @cloudChatCamera.
  ///
  /// In en, this message translates to:
  /// **'Camera'**
  String get cloudChatCamera;

  /// No description provided for @cloudChatTaskMode.
  ///
  /// In en, this message translates to:
  /// **'Task mode'**
  String get cloudChatTaskMode;

  /// No description provided for @cloudChatTask.
  ///
  /// In en, this message translates to:
  /// **'Task'**
  String get cloudChatTask;

  /// No description provided for @cloudChatStopDictation.
  ///
  /// In en, this message translates to:
  /// **'Stop dictation'**
  String get cloudChatStopDictation;

  /// No description provided for @cloudChatStartDictation.
  ///
  /// In en, this message translates to:
  /// **'Start dictation'**
  String get cloudChatStartDictation;

  /// No description provided for @cloudChatStopResponse.
  ///
  /// In en, this message translates to:
  /// **'Stop response'**
  String get cloudChatStopResponse;

  /// No description provided for @cloudChatSendMessage.
  ///
  /// In en, this message translates to:
  /// **'Send message'**
  String get cloudChatSendMessage;

  /// No description provided for @cloudChatEditMessage.
  ///
  /// In en, this message translates to:
  /// **'Edit message'**
  String get cloudChatEditMessage;

  /// No description provided for @cloudChatSend.
  ///
  /// In en, this message translates to:
  /// **'Send'**
  String get cloudChatSend;

  /// No description provided for @cloudChatDisableWordWrap.
  ///
  /// In en, this message translates to:
  /// **'Disable word wrap'**
  String get cloudChatDisableWordWrap;

  /// No description provided for @cloudChatEnableWordWrap.
  ///
  /// In en, this message translates to:
  /// **'Enable word wrap'**
  String get cloudChatEnableWordWrap;

  /// No description provided for @cloudChatCopied.
  ///
  /// In en, this message translates to:
  /// **'Copied'**
  String get cloudChatCopied;

  /// No description provided for @cloudChatCopyCode.
  ///
  /// In en, this message translates to:
  /// **'Copy code'**
  String get cloudChatCopyCode;

  /// No description provided for @cloudChatCodeLabel.
  ///
  /// In en, this message translates to:
  /// **'Code'**
  String get cloudChatCodeLabel;

  /// No description provided for @cloudChatEdit.
  ///
  /// In en, this message translates to:
  /// **'Edit'**
  String get cloudChatEdit;

  /// No description provided for @cloudChatPreviousBranch.
  ///
  /// In en, this message translates to:
  /// **'Previous branch'**
  String get cloudChatPreviousBranch;

  /// No description provided for @cloudChatNextBranch.
  ///
  /// In en, this message translates to:
  /// **'Next branch'**
  String get cloudChatNextBranch;

  /// No description provided for @cloudChatCopyMessage.
  ///
  /// In en, this message translates to:
  /// **'Copy message'**
  String get cloudChatCopyMessage;

  /// No description provided for @cloudChatRegenerateReply.
  ///
  /// In en, this message translates to:
  /// **'Regenerate reply'**
  String get cloudChatRegenerateReply;

  /// No description provided for @cloudChatStopReading.
  ///
  /// In en, this message translates to:
  /// **'Stop reading'**
  String get cloudChatStopReading;

  /// No description provided for @cloudChatReadAloud.
  ///
  /// In en, this message translates to:
  /// **'Read aloud'**
  String get cloudChatReadAloud;

  /// No description provided for @cloudChatReportAnswer.
  ///
  /// In en, this message translates to:
  /// **'Report this answer'**
  String get cloudChatReportAnswer;

  /// No description provided for @cloudChatToolResult.
  ///
  /// In en, this message translates to:
  /// **'{name} · {status}'**
  String cloudChatToolResult(String name, String status);

  /// No description provided for @cloudChatToolFailed.
  ///
  /// In en, this message translates to:
  /// **'Failed'**
  String get cloudChatToolFailed;

  /// No description provided for @cloudChatToolDone.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get cloudChatToolDone;

  /// No description provided for @cloudChatNeedsNewerVersion.
  ///
  /// In en, this message translates to:
  /// **'This message contains content requiring a newer version.'**
  String get cloudChatNeedsNewerVersion;

  /// No description provided for @cloudChatImageUnavailableRetry.
  ///
  /// In en, this message translates to:
  /// **'Image unavailable · Retry'**
  String get cloudChatImageUnavailableRetry;

  /// No description provided for @cloudChatConversationImage.
  ///
  /// In en, this message translates to:
  /// **'Conversation image'**
  String get cloudChatConversationImage;

  /// No description provided for @cloudChatImageDisplayFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not display this image.'**
  String get cloudChatImageDisplayFailed;

  /// No description provided for @cloudChatShareFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not open sharing. Try again.'**
  String get cloudChatShareFailed;

  /// No description provided for @cloudChatShareLinkCreated.
  ///
  /// In en, this message translates to:
  /// **'Share link created'**
  String get cloudChatShareLinkCreated;

  /// No description provided for @cloudChatShareLinkBody.
  ///
  /// In en, this message translates to:
  /// **'Anyone with the link can read this chat as it is now. Messages you send later aren\'t shared.'**
  String get cloudChatShareLinkBody;

  /// No description provided for @cloudChatCopyLink.
  ///
  /// In en, this message translates to:
  /// **'Copy link'**
  String get cloudChatCopyLink;

  /// No description provided for @cloudChatShare.
  ///
  /// In en, this message translates to:
  /// **'Share'**
  String get cloudChatShare;

  /// No description provided for @conversationsPinned.
  ///
  /// In en, this message translates to:
  /// **'Pinned'**
  String get conversationsPinned;

  /// No description provided for @conversationsPinnedEmpty.
  ///
  /// In en, this message translates to:
  /// **'Touch and hold a chat to pin it.'**
  String get conversationsPinnedEmpty;

  /// No description provided for @conversationsRecentEmpty.
  ///
  /// In en, this message translates to:
  /// **'Your conversations appear here.'**
  String get conversationsRecentEmpty;

  /// No description provided for @conversationsCloudConversationHint.
  ///
  /// In en, this message translates to:
  /// **'Cloud conversation'**
  String get conversationsCloudConversationHint;

  /// No description provided for @conversationsChat.
  ///
  /// In en, this message translates to:
  /// **'Chat'**
  String get conversationsChat;

  /// No description provided for @conversationsSearchChats.
  ///
  /// In en, this message translates to:
  /// **'Search chats'**
  String get conversationsSearchChats;

  /// No description provided for @conversationsRemote.
  ///
  /// In en, this message translates to:
  /// **'Remote'**
  String get conversationsRemote;

  /// No description provided for @conversationsRecentChats.
  ///
  /// In en, this message translates to:
  /// **'Recent chats'**
  String get conversationsRecentChats;

  /// No description provided for @conversationsLoadMore.
  ///
  /// In en, this message translates to:
  /// **'Load more'**
  String get conversationsLoadMore;

  /// No description provided for @conversationsSettings.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get conversationsSettings;

  /// No description provided for @conversationsArchivedChats.
  ///
  /// In en, this message translates to:
  /// **'Archived chats'**
  String get conversationsArchivedChats;

  /// No description provided for @conversationsRestore.
  ///
  /// In en, this message translates to:
  /// **'Restore'**
  String get conversationsRestore;

  /// No description provided for @conversationsNoArchivedChats.
  ///
  /// In en, this message translates to:
  /// **'No archived chats'**
  String get conversationsNoArchivedChats;

  /// No description provided for @conversationsPin.
  ///
  /// In en, this message translates to:
  /// **'Pin'**
  String get conversationsPin;

  /// No description provided for @conversationsUnpin.
  ///
  /// In en, this message translates to:
  /// **'Unpin'**
  String get conversationsUnpin;

  /// No description provided for @conversationsRename.
  ///
  /// In en, this message translates to:
  /// **'Rename'**
  String get conversationsRename;

  /// No description provided for @conversationsArchive.
  ///
  /// In en, this message translates to:
  /// **'Archive'**
  String get conversationsArchive;

  /// No description provided for @conversationsDelete.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get conversationsDelete;

  /// No description provided for @conversationsDeleteChatQuestion.
  ///
  /// In en, this message translates to:
  /// **'Delete this chat?'**
  String get conversationsDeleteChatQuestion;

  /// No description provided for @plansCompleted.
  ///
  /// In en, this message translates to:
  /// **'Completed'**
  String get plansCompleted;

  /// No description provided for @plansInProgress.
  ///
  /// In en, this message translates to:
  /// **'In progress'**
  String get plansInProgress;

  /// No description provided for @plansPending.
  ///
  /// In en, this message translates to:
  /// **'Pending'**
  String get plansPending;

  /// No description provided for @plansOpenActivePlan.
  ///
  /// In en, this message translates to:
  /// **'Open active plan'**
  String get plansOpenActivePlan;

  /// No description provided for @plansPlan.
  ///
  /// In en, this message translates to:
  /// **'Plan'**
  String get plansPlan;

  /// No description provided for @plansStepOf.
  ///
  /// In en, this message translates to:
  /// **'Step {current} of {total}'**
  String plansStepOf(int current, int total);

  /// No description provided for @plansStepFraction.
  ///
  /// In en, this message translates to:
  /// **'Step {current} / {total}'**
  String plansStepFraction(int current, int total);

  /// No description provided for @plansStatusValue.
  ///
  /// In en, this message translates to:
  /// **'{status}, {position}'**
  String plansStatusValue(String status, String position);

  /// No description provided for @plansImage.
  ///
  /// In en, this message translates to:
  /// **'Image'**
  String get plansImage;

  /// No description provided for @plansActivePlan.
  ///
  /// In en, this message translates to:
  /// **'Active plan'**
  String get plansActivePlan;

  /// No description provided for @plansDone.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get plansDone;

  /// No description provided for @plansNoLongerAvailable.
  ///
  /// In en, this message translates to:
  /// **'This plan is no longer available.'**
  String get plansNoLongerAvailable;

  /// No description provided for @plansProposedPlan.
  ///
  /// In en, this message translates to:
  /// **'Proposed plan'**
  String get plansProposedPlan;

  /// No description provided for @plansCollapsePlan.
  ///
  /// In en, this message translates to:
  /// **'Collapse plan'**
  String get plansCollapsePlan;

  /// No description provided for @plansExpandPlan.
  ///
  /// In en, this message translates to:
  /// **'Expand plan'**
  String get plansExpandPlan;

  /// No description provided for @plansCollapse.
  ///
  /// In en, this message translates to:
  /// **'Collapse'**
  String get plansCollapse;

  /// No description provided for @plansExpand.
  ///
  /// In en, this message translates to:
  /// **'Expand'**
  String get plansExpand;

  /// No description provided for @plansStarting.
  ///
  /// In en, this message translates to:
  /// **'Starting...'**
  String get plansStarting;

  /// No description provided for @plansImplement.
  ///
  /// In en, this message translates to:
  /// **'Implement'**
  String get plansImplement;

  /// No description provided for @plansNextStepQuestion.
  ///
  /// In en, this message translates to:
  /// **'What should Codex produce next?'**
  String get plansNextStepQuestion;

  /// No description provided for @plansNextStepHeader.
  ///
  /// In en, this message translates to:
  /// **'Next step'**
  String get plansNextStepHeader;

  /// No description provided for @voiceAllowMicrophone.
  ///
  /// In en, this message translates to:
  /// **'Allow microphone and speech access in device settings to dictate.'**
  String get voiceAllowMicrophone;

  /// No description provided for @voiceDictationUnavailable.
  ///
  /// In en, this message translates to:
  /// **'On-device dictation is unavailable for this language or device. You can still type your message.'**
  String get voiceDictationUnavailable;

  /// No description provided for @voiceSpeechAccessRequired.
  ///
  /// In en, this message translates to:
  /// **'Allow microphone and speech access in device settings. On-device speech must be available for your language.'**
  String get voiceSpeechAccessRequired;

  /// No description provided for @voiceInputUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Voice input is unavailable. You can still type your message.'**
  String get voiceInputUnavailable;

  /// No description provided for @voiceStopFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not stop voice input.'**
  String get voiceStopFailed;

  /// No description provided for @voicePlaybackUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Speech playback is unavailable on this device.'**
  String get voicePlaybackUnavailable;

  /// No description provided for @voiceStopUnclean.
  ///
  /// In en, this message translates to:
  /// **'Voice could not stop cleanly. Close this screen before continuing.'**
  String get voiceStopUnclean;

  /// No description provided for @goalsStatusActive.
  ///
  /// In en, this message translates to:
  /// **'Active'**
  String get goalsStatusActive;

  /// No description provided for @goalsStatusPaused.
  ///
  /// In en, this message translates to:
  /// **'Paused'**
  String get goalsStatusPaused;

  /// No description provided for @goalsStatusBlocked.
  ///
  /// In en, this message translates to:
  /// **'Blocked'**
  String get goalsStatusBlocked;

  /// No description provided for @goalsStatusUsageLimited.
  ///
  /// In en, this message translates to:
  /// **'Usage limited'**
  String get goalsStatusUsageLimited;

  /// No description provided for @goalsStatusBudgetLimited.
  ///
  /// In en, this message translates to:
  /// **'Budget limited'**
  String get goalsStatusBudgetLimited;

  /// No description provided for @goalsStatusComplete.
  ///
  /// In en, this message translates to:
  /// **'Complete'**
  String get goalsStatusComplete;

  /// No description provided for @goalsTokenUsage.
  ///
  /// In en, this message translates to:
  /// **'{used} / {budget} tokens'**
  String goalsTokenUsage(String used, String budget);

  /// No description provided for @goalsUnsupported.
  ///
  /// In en, this message translates to:
  /// **'Goals are unavailable on this runtime. Update Codex on your Mac and enable goals.'**
  String get goalsUnsupported;

  /// No description provided for @goalsEphemeral.
  ///
  /// In en, this message translates to:
  /// **'Goals need a saved chat. This chat is temporary.'**
  String get goalsEphemeral;

  /// No description provided for @goalsDesktopChanged.
  ///
  /// In en, this message translates to:
  /// **'Connected desktop changed. Reopen this goal.'**
  String get goalsDesktopChanged;

  /// No description provided for @goalsOtherChatGoal.
  ///
  /// In en, this message translates to:
  /// **'The runtime returned another chat’s goal.'**
  String get goalsOtherChatGoal;

  /// No description provided for @goalsBudgetInvalid.
  ///
  /// In en, this message translates to:
  /// **'Token budget must be a positive whole number.'**
  String get goalsBudgetInvalid;

  /// No description provided for @goalsUnexpectedResponse.
  ///
  /// In en, this message translates to:
  /// **'The runtime returned an unexpected goal response.'**
  String get goalsUnexpectedResponse;

  /// No description provided for @goalsReconnect.
  ///
  /// In en, this message translates to:
  /// **'Reconnect to your desktop to manage this goal.'**
  String get goalsReconnect;

  /// No description provided for @goalsDescribeFirst.
  ///
  /// In en, this message translates to:
  /// **'Describe the goal first.'**
  String get goalsDescribeFirst;

  /// No description provided for @goalsReplaceTitle.
  ///
  /// In en, this message translates to:
  /// **'Replace the current goal?'**
  String get goalsReplaceTitle;

  /// No description provided for @goalsReplaceBody.
  ///
  /// In en, this message translates to:
  /// **'This objective is not complete. Replacing it starts a new goal and resets its usage accounting.'**
  String get goalsReplaceBody;

  /// No description provided for @goalsReplaceAction.
  ///
  /// In en, this message translates to:
  /// **'Replace goal'**
  String get goalsReplaceAction;

  /// No description provided for @goalsClearTitle.
  ///
  /// In en, this message translates to:
  /// **'Clear this goal?'**
  String get goalsClearTitle;

  /// No description provided for @goalsClearBody.
  ///
  /// In en, this message translates to:
  /// **'The desktop stops pursuing this objective and clears its progress accounting.'**
  String get goalsClearBody;

  /// No description provided for @goalsClearAction.
  ///
  /// In en, this message translates to:
  /// **'Clear goal'**
  String get goalsClearAction;

  /// No description provided for @goalsTitle.
  ///
  /// In en, this message translates to:
  /// **'Goal'**
  String get goalsTitle;

  /// No description provided for @goalsReload.
  ///
  /// In en, this message translates to:
  /// **'Reload goal'**
  String get goalsReload;

  /// No description provided for @goalsShowingLastKnown.
  ///
  /// In en, this message translates to:
  /// **'Showing the last known goal. Reconnect to manage it.'**
  String get goalsShowingLastKnown;

  /// No description provided for @goalsNewGoal.
  ///
  /// In en, this message translates to:
  /// **'New goal'**
  String get goalsNewGoal;

  /// No description provided for @goalsEditGoal.
  ///
  /// In en, this message translates to:
  /// **'Edit goal'**
  String get goalsEditGoal;

  /// No description provided for @goalsDescribeHint.
  ///
  /// In en, this message translates to:
  /// **'Describe the outcome, how to verify it, and what must not regress.'**
  String get goalsDescribeHint;

  /// No description provided for @goalsObjective.
  ///
  /// In en, this message translates to:
  /// **'Objective'**
  String get goalsObjective;

  /// No description provided for @goalsBudgetLabel.
  ///
  /// In en, this message translates to:
  /// **'Token budget (optional)'**
  String get goalsBudgetLabel;

  /// No description provided for @goalsBudgetHelper.
  ///
  /// In en, this message translates to:
  /// **'Leave empty for no token budget.'**
  String get goalsBudgetHelper;

  /// No description provided for @goalsStart.
  ///
  /// In en, this message translates to:
  /// **'Start goal'**
  String get goalsStart;

  /// No description provided for @goalsSave.
  ///
  /// In en, this message translates to:
  /// **'Save goal'**
  String get goalsSave;

  /// No description provided for @goalsCancelEditing.
  ///
  /// In en, this message translates to:
  /// **'Cancel editing'**
  String get goalsCancelEditing;

  /// No description provided for @goalsTokensRemaining.
  ///
  /// In en, this message translates to:
  /// **'{tokens} tokens remaining'**
  String goalsTokensRemaining(String tokens);

  /// No description provided for @goalsActiveExplainer.
  ///
  /// In en, this message translates to:
  /// **'The desktop keeps working toward this goal when the chat is idle, until it completes, pauses, or reaches a limit.'**
  String get goalsActiveExplainer;

  /// No description provided for @goalsPause.
  ///
  /// In en, this message translates to:
  /// **'Pause goal'**
  String get goalsPause;

  /// No description provided for @goalsResume.
  ///
  /// In en, this message translates to:
  /// **'Resume goal'**
  String get goalsResume;

  /// No description provided for @goalsEditObjective.
  ///
  /// In en, this message translates to:
  /// **'Edit objective'**
  String get goalsEditObjective;

  /// No description provided for @groupsKindSpreadsheet.
  ///
  /// In en, this message translates to:
  /// **'Spreadsheet'**
  String get groupsKindSpreadsheet;

  /// No description provided for @groupsKindText.
  ///
  /// In en, this message translates to:
  /// **'Text'**
  String get groupsKindText;

  /// No description provided for @groupsKindArchive.
  ///
  /// In en, this message translates to:
  /// **'Archive'**
  String get groupsKindArchive;

  /// No description provided for @groupsKindImage.
  ///
  /// In en, this message translates to:
  /// **'Image'**
  String get groupsKindImage;

  /// No description provided for @groupsKindVideo.
  ///
  /// In en, this message translates to:
  /// **'Video'**
  String get groupsKindVideo;

  /// No description provided for @groupsKindAudio.
  ///
  /// In en, this message translates to:
  /// **'Audio'**
  String get groupsKindAudio;

  /// No description provided for @groupsKindFile.
  ///
  /// In en, this message translates to:
  /// **'File'**
  String get groupsKindFile;

  /// No description provided for @groupsMacUnreachable.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t reach your Mac. Try again.'**
  String get groupsMacUnreachable;

  /// No description provided for @groupsCreateFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t create the group. Try again.'**
  String get groupsCreateFailed;

  /// No description provided for @groupsNewGroup.
  ///
  /// In en, this message translates to:
  /// **'New group'**
  String get groupsNewGroup;

  /// No description provided for @groupsChooseMembers.
  ///
  /// In en, this message translates to:
  /// **'Choose who is in the chat.'**
  String get groupsChooseMembers;

  /// No description provided for @groupsNameOptional.
  ///
  /// In en, this message translates to:
  /// **'Name (optional)'**
  String get groupsNameOptional;

  /// No description provided for @groupsCreateGroup.
  ///
  /// In en, this message translates to:
  /// **'Create group'**
  String get groupsCreateGroup;

  /// No description provided for @groupsCreateGroupWith.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{Create group with 1 agent} other{Create group with {count} agents}}'**
  String groupsCreateGroupWith(int count);

  /// No description provided for @groupsSignInOnMac.
  ///
  /// In en, this message translates to:
  /// **'Sign in on your Mac to use it'**
  String get groupsSignInOnMac;

  /// No description provided for @groupsUpdateMacTitle.
  ///
  /// In en, this message translates to:
  /// **'Update DJL on your Mac'**
  String get groupsUpdateMacTitle;

  /// No description provided for @groupsUpdateMacBody.
  ///
  /// In en, this message translates to:
  /// **'Group chats need the latest DJL on your Mac. Update it there, then come back.'**
  String get groupsUpdateMacBody;

  /// No description provided for @groupsConnectMacTitle.
  ///
  /// In en, this message translates to:
  /// **'Connect to your Mac'**
  String get groupsConnectMacTitle;

  /// No description provided for @groupsConnectMacBody.
  ///
  /// In en, this message translates to:
  /// **'Group chats live on your Mac. They appear here once it is connected.'**
  String get groupsConnectMacBody;

  /// No description provided for @groupsLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load your groups'**
  String get groupsLoadFailed;

  /// No description provided for @groupsEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'Put your agents in one chat'**
  String get groupsEmptyTitle;

  /// No description provided for @groupsEmptyBody.
  ///
  /// In en, this message translates to:
  /// **'Ask a question once and let Claude, Codex and the others answer together.'**
  String get groupsEmptyBody;

  /// No description provided for @groupsMemberWriting.
  ///
  /// In en, this message translates to:
  /// **'{name} is writing'**
  String groupsMemberWriting(String name);

  /// No description provided for @groupsAgentsWriting.
  ///
  /// In en, this message translates to:
  /// **'{count} agents are writing'**
  String groupsAgentsWriting(int count);

  /// No description provided for @groupsPausedWaiting.
  ///
  /// In en, this message translates to:
  /// **'Paused, waiting for you'**
  String get groupsPausedWaiting;

  /// No description provided for @groupsAgentCount.
  ///
  /// In en, this message translates to:
  /// **'{count} agents'**
  String groupsAgentCount(int count);

  /// No description provided for @groupsMacDidNotKeepFile.
  ///
  /// In en, this message translates to:
  /// **'Your Mac did not keep the file.'**
  String get groupsMacDidNotKeepFile;

  /// No description provided for @groupsFileStillSending.
  ///
  /// In en, this message translates to:
  /// **'This file is still sending.'**
  String get groupsFileStillSending;

  /// No description provided for @groupsMacTimeout.
  ///
  /// In en, this message translates to:
  /// **'Your Mac did not answer in time. Check that DJL is open on it.'**
  String get groupsMacTimeout;

  /// No description provided for @groupsMacNotConnected.
  ///
  /// In en, this message translates to:
  /// **'Your Mac is not connected right now.'**
  String get groupsMacNotConnected;

  /// No description provided for @groupsRemoveAttachment.
  ///
  /// In en, this message translates to:
  /// **'Remove {name}'**
  String groupsRemoveAttachment(String name);

  /// No description provided for @groupsSendingFiles.
  ///
  /// In en, this message translates to:
  /// **'Sending files'**
  String get groupsSendingFiles;

  /// No description provided for @groupsImageNamed.
  ///
  /// In en, this message translates to:
  /// **'Image {name}'**
  String groupsImageNamed(String name);

  /// No description provided for @groupsAttach.
  ///
  /// In en, this message translates to:
  /// **'Attach'**
  String get groupsAttach;

  /// No description provided for @groupsPhotos.
  ///
  /// In en, this message translates to:
  /// **'Photos'**
  String get groupsPhotos;

  /// No description provided for @groupsFiles.
  ///
  /// In en, this message translates to:
  /// **'Files'**
  String get groupsFiles;

  /// No description provided for @groupsFileUnsupported.
  ///
  /// In en, this message translates to:
  /// **'{name} can\'t be sent. Photos, PDFs, Word, Excel, PowerPoint, text and code files work.'**
  String groupsFileUnsupported(String name);

  /// No description provided for @groupsFileTooLarge.
  ///
  /// In en, this message translates to:
  /// **'{name} is larger than {size}.'**
  String groupsFileTooLarge(String name, String size);

  /// No description provided for @groupsTooManyFiles.
  ///
  /// In en, this message translates to:
  /// **'A message can carry {count} files.'**
  String groupsTooManyFiles(int count);

  /// No description provided for @groupsOpenFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t open that. Please try again.'**
  String get groupsOpenFailed;

  /// No description provided for @groupsAskEveryoneTitle.
  ///
  /// In en, this message translates to:
  /// **'Ask everyone?'**
  String get groupsAskEveryoneTitle;

  /// No description provided for @groupsAskEveryoneBody.
  ///
  /// In en, this message translates to:
  /// **'All {count} agents will answer this message.'**
  String groupsAskEveryoneBody(int count);

  /// No description provided for @groupsDontAskAgain.
  ///
  /// In en, this message translates to:
  /// **'Don\'t ask again'**
  String get groupsDontAskAgain;

  /// No description provided for @groupsAskEveryone.
  ///
  /// In en, this message translates to:
  /// **'Ask everyone'**
  String get groupsAskEveryone;

  /// No description provided for @groupsGroupGone.
  ///
  /// In en, this message translates to:
  /// **'This group is no longer on your Mac.'**
  String get groupsGroupGone;

  /// No description provided for @groupsSayHelloPrompt.
  ///
  /// In en, this message translates to:
  /// **'{everyone} Say hello in one line.'**
  String groupsSayHelloPrompt(String everyone);

  /// No description provided for @groupsReconnectingToMac.
  ///
  /// In en, this message translates to:
  /// **'Reconnecting to your Mac…'**
  String get groupsReconnectingToMac;

  /// No description provided for @groupsHeaderLabel.
  ///
  /// In en, this message translates to:
  /// **'{name}, {count} agents'**
  String groupsHeaderLabel(String name, int count);

  /// No description provided for @groupsMembers.
  ///
  /// In en, this message translates to:
  /// **'Members'**
  String get groupsMembers;

  /// No description provided for @groupsYou.
  ///
  /// In en, this message translates to:
  /// **'You'**
  String get groupsYou;

  /// No description provided for @groupsCouldNotReply.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t reply'**
  String get groupsCouldNotReply;

  /// No description provided for @groupsNothingToAdd.
  ///
  /// In en, this message translates to:
  /// **'Nothing to add'**
  String get groupsNothingToAdd;

  /// No description provided for @groupsImageOnMac.
  ///
  /// In en, this message translates to:
  /// **'Image on your Mac'**
  String get groupsImageOnMac;

  /// No description provided for @groupsRemovedAgent.
  ///
  /// In en, this message translates to:
  /// **'Removed agent'**
  String get groupsRemovedAgent;

  /// No description provided for @groupsWaitingTurn.
  ///
  /// In en, this message translates to:
  /// **'Waiting for its turn'**
  String get groupsWaitingTurn;

  /// No description provided for @groupsWriting.
  ///
  /// In en, this message translates to:
  /// **'Writing'**
  String get groupsWriting;

  /// No description provided for @groupsAttachTooltip.
  ///
  /// In en, this message translates to:
  /// **'Attach files or photos'**
  String get groupsAttachTooltip;

  /// No description provided for @groupsMentionAgent.
  ///
  /// In en, this message translates to:
  /// **'Mention an agent'**
  String get groupsMentionAgent;

  /// No description provided for @groupsMessageHint.
  ///
  /// In en, this message translates to:
  /// **'Message'**
  String get groupsMessageHint;

  /// No description provided for @groupsStopAgents.
  ///
  /// In en, this message translates to:
  /// **'Stop the agents'**
  String get groupsStopAgents;

  /// No description provided for @groupsEveryone.
  ///
  /// In en, this message translates to:
  /// **'Everyone'**
  String get groupsEveryone;

  /// No description provided for @groupsPausedTitle.
  ///
  /// In en, this message translates to:
  /// **'The agents paused'**
  String get groupsPausedTitle;

  /// No description provided for @groupsPausedBody.
  ///
  /// In en, this message translates to:
  /// **'They have been talking to each other for a while and have more to say.'**
  String get groupsPausedBody;

  /// No description provided for @groupsEndItHere.
  ///
  /// In en, this message translates to:
  /// **'End it here'**
  String get groupsEndItHere;

  /// No description provided for @groupsLetThemContinue.
  ///
  /// In en, this message translates to:
  /// **'Let them continue'**
  String get groupsLetThemContinue;

  /// No description provided for @groupsOfflineHint.
  ///
  /// In en, this message translates to:
  /// **'Messages appear here once your Mac is connected.'**
  String get groupsOfflineHint;

  /// No description provided for @groupsLoadingMessages.
  ///
  /// In en, this message translates to:
  /// **'Loading messages'**
  String get groupsLoadingMessages;

  /// No description provided for @groupsEveryoneIsHere.
  ///
  /// In en, this message translates to:
  /// **'Everyone is here'**
  String get groupsEveryoneIsHere;

  /// No description provided for @groupsEmptyChatHint.
  ///
  /// In en, this message translates to:
  /// **'Type @ to choose who answers. Your first message goes to everyone.'**
  String get groupsEmptyChatHint;

  /// No description provided for @groupsAskEveryoneToSayHello.
  ///
  /// In en, this message translates to:
  /// **'Ask everyone to say hello'**
  String get groupsAskEveryoneToSayHello;

  /// No description provided for @groupsManageOnMac.
  ///
  /// In en, this message translates to:
  /// **'Add or remove agents in DJL on your Mac.'**
  String get groupsManageOnMac;

  /// No description provided for @groupsReady.
  ///
  /// In en, this message translates to:
  /// **'Ready'**
  String get groupsReady;

  /// No description provided for @groupsStop.
  ///
  /// In en, this message translates to:
  /// **'Stop'**
  String get groupsStop;

  /// No description provided for @guardianLiveReason.
  ///
  /// In en, this message translates to:
  /// **'Retry approvals are available only during the live session.'**
  String get guardianLiveReason;

  /// No description provided for @guardianExpiredReason.
  ///
  /// In en, this message translates to:
  /// **'This retry is no longer available. Wait for Codex to request the action again.'**
  String get guardianExpiredReason;

  /// No description provided for @guardianDesktopReason.
  ///
  /// In en, this message translates to:
  /// **'Approve this retry in Codex Desktop.'**
  String get guardianDesktopReason;

  /// No description provided for @guardianUnsafeReason.
  ///
  /// In en, this message translates to:
  /// **'This action cannot be retried safely here. Approve it in Codex.'**
  String get guardianUnsafeReason;

  /// No description provided for @guardianSubmittedReason.
  ///
  /// In en, this message translates to:
  /// **'Retry approval submitted. Check Codex before trying again.'**
  String get guardianSubmittedReason;

  /// No description provided for @guardianUncertainReason.
  ///
  /// In en, this message translates to:
  /// **'Retry approval may not have reached Codex. Check Codex before trying again.'**
  String get guardianUncertainReason;

  /// No description provided for @guardianRequestedAction.
  ///
  /// In en, this message translates to:
  /// **'Requested action'**
  String get guardianRequestedAction;

  /// No description provided for @guardianRunCommand.
  ///
  /// In en, this message translates to:
  /// **'Run command'**
  String get guardianRunCommand;

  /// No description provided for @guardianApplyFileChanges.
  ///
  /// In en, this message translates to:
  /// **'Apply file changes'**
  String get guardianApplyFileChanges;

  /// No description provided for @guardianEditFile.
  ///
  /// In en, this message translates to:
  /// **'Edit {file}'**
  String guardianEditFile(String file);

  /// No description provided for @guardianEditFiles.
  ///
  /// In en, this message translates to:
  /// **'Edit {count} files: {files}'**
  String guardianEditFiles(int count, String files);

  /// No description provided for @guardianAccessNetwork.
  ///
  /// In en, this message translates to:
  /// **'Access the network'**
  String get guardianAccessNetwork;

  /// No description provided for @guardianAccessHost.
  ///
  /// In en, this message translates to:
  /// **'Access {host}'**
  String guardianAccessHost(String host);

  /// No description provided for @guardianRequestPermissions.
  ///
  /// In en, this message translates to:
  /// **'Request additional permissions'**
  String get guardianRequestPermissions;

  /// No description provided for @guardianRequestNetwork.
  ///
  /// In en, this message translates to:
  /// **'Request network'**
  String get guardianRequestNetwork;

  /// No description provided for @guardianRequestFileAccess.
  ///
  /// In en, this message translates to:
  /// **'Request file access'**
  String get guardianRequestFileAccess;

  /// No description provided for @guardianRequestNetworkAndFileAccess.
  ///
  /// In en, this message translates to:
  /// **'Request network and file access'**
  String get guardianRequestNetworkAndFileAccess;

  /// No description provided for @guardianReviewing.
  ///
  /// In en, this message translates to:
  /// **'Reviewing'**
  String get guardianReviewing;

  /// No description provided for @guardianApproved.
  ///
  /// In en, this message translates to:
  /// **'Approved'**
  String get guardianApproved;

  /// No description provided for @guardianDenied.
  ///
  /// In en, this message translates to:
  /// **'Denied'**
  String get guardianDenied;

  /// No description provided for @guardianTimedOut.
  ///
  /// In en, this message translates to:
  /// **'Timed out'**
  String get guardianTimedOut;

  /// No description provided for @guardianStopped.
  ///
  /// In en, this message translates to:
  /// **'Stopped'**
  String get guardianStopped;

  /// No description provided for @guardianUpdatedStatus.
  ///
  /// In en, this message translates to:
  /// **'Updated ({status})'**
  String guardianUpdatedStatus(String status);

  /// No description provided for @guardianDetailsUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Review details unavailable.'**
  String get guardianDetailsUnavailable;

  /// No description provided for @guardianAutoReviewTitle.
  ///
  /// In en, this message translates to:
  /// **'Auto-review · {status}'**
  String guardianAutoReviewTitle(String status);

  /// No description provided for @guardianRiskLow.
  ///
  /// In en, this message translates to:
  /// **'Low risk'**
  String get guardianRiskLow;

  /// No description provided for @guardianRiskMedium.
  ///
  /// In en, this message translates to:
  /// **'Medium risk'**
  String get guardianRiskMedium;

  /// No description provided for @guardianRiskHigh.
  ///
  /// In en, this message translates to:
  /// **'High risk'**
  String get guardianRiskHigh;

  /// No description provided for @guardianRiskOther.
  ///
  /// In en, this message translates to:
  /// **'{level} risk'**
  String guardianRiskOther(String level);

  /// No description provided for @guardianAuthorization.
  ///
  /// In en, this message translates to:
  /// **'Authorization: {value}'**
  String guardianAuthorization(String value);

  /// No description provided for @guardianApprovalRecorded.
  ///
  /// In en, this message translates to:
  /// **'Approval recorded; the retry will still be reviewed'**
  String get guardianApprovalRecorded;

  /// No description provided for @guardianSubmittingApproval.
  ///
  /// In en, this message translates to:
  /// **'Submitting retry approval…'**
  String get guardianSubmittingApproval;

  /// No description provided for @guardianApproveOneRetry.
  ///
  /// In en, this message translates to:
  /// **'Approve one retry'**
  String get guardianApproveOneRetry;

  /// No description provided for @subagentsSubagent.
  ///
  /// In en, this message translates to:
  /// **'Subagent'**
  String get subagentsSubagent;

  /// No description provided for @subagentsSpawnAgent.
  ///
  /// In en, this message translates to:
  /// **'Spawn agent'**
  String get subagentsSpawnAgent;

  /// No description provided for @subagentsWaitForAgents.
  ///
  /// In en, this message translates to:
  /// **'Wait for agents'**
  String get subagentsWaitForAgents;

  /// No description provided for @subagentsUpdateAgent.
  ///
  /// In en, this message translates to:
  /// **'Update agent'**
  String get subagentsUpdateAgent;

  /// No description provided for @subagentsResumeAgent.
  ///
  /// In en, this message translates to:
  /// **'Resume agent'**
  String get subagentsResumeAgent;

  /// No description provided for @subagentsCloseAgent.
  ///
  /// In en, this message translates to:
  /// **'Close agent'**
  String get subagentsCloseAgent;

  /// No description provided for @subagentsActivity.
  ///
  /// In en, this message translates to:
  /// **'Subagent activity'**
  String get subagentsActivity;

  /// No description provided for @subagentsMetadataUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Subagent metadata unavailable'**
  String get subagentsMetadataUnavailable;

  /// No description provided for @activityCommand.
  ///
  /// In en, this message translates to:
  /// **'Command'**
  String get activityCommand;

  /// No description provided for @activityFileChanges.
  ///
  /// In en, this message translates to:
  /// **'File changes'**
  String get activityFileChanges;

  /// No description provided for @activityFilesChanged.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 file changed} other{{count} files changed}}'**
  String activityFilesChanged(int count);

  /// No description provided for @activityToolActivity.
  ///
  /// In en, this message translates to:
  /// **'Tool activity'**
  String get activityToolActivity;

  /// No description provided for @activityReadFile.
  ///
  /// In en, this message translates to:
  /// **'Read file'**
  String get activityReadFile;

  /// No description provided for @activityReadValue.
  ///
  /// In en, this message translates to:
  /// **'Read {value}'**
  String activityReadValue(String value);

  /// No description provided for @activitySearchFiles.
  ///
  /// In en, this message translates to:
  /// **'Search files'**
  String get activitySearchFiles;

  /// No description provided for @activitySearchValue.
  ///
  /// In en, this message translates to:
  /// **'Search {value}'**
  String activitySearchValue(String value);

  /// No description provided for @activityListFiles.
  ///
  /// In en, this message translates to:
  /// **'List files'**
  String get activityListFiles;

  /// No description provided for @activityListFilesValue.
  ///
  /// In en, this message translates to:
  /// **'List files {value}'**
  String activityListFilesValue(String value);

  /// No description provided for @statusTaskStatus.
  ///
  /// In en, this message translates to:
  /// **'Task status'**
  String get statusTaskStatus;

  /// No description provided for @statusAllowed.
  ///
  /// In en, this message translates to:
  /// **'Task status is allowed on this device.'**
  String get statusAllowed;

  /// No description provided for @statusDenied.
  ///
  /// In en, this message translates to:
  /// **'Allow local task status in your device settings. Chat works without it.'**
  String get statusDenied;

  /// No description provided for @statusUnsupported.
  ///
  /// In en, this message translates to:
  /// **'Task status is unavailable on this device.'**
  String get statusUnsupported;

  /// No description provided for @statusChecking.
  ///
  /// In en, this message translates to:
  /// **'Checking device permission…'**
  String get statusChecking;

  /// No description provided for @statusEnable.
  ///
  /// In en, this message translates to:
  /// **'Turn on'**
  String get statusEnable;

  /// No description provided for @statusRefresh.
  ///
  /// In en, this message translates to:
  /// **'Refresh task status'**
  String get statusRefresh;

  /// No description provided for @statusSystemSettings.
  ///
  /// In en, this message translates to:
  /// **'Open Settings'**
  String get statusSystemSettings;

  /// The connection state shown under the Mac's name. The English values are shown unchanged.
  ///
  /// In en, this message translates to:
  /// **'{state, select, disconnected{disconnected} resolving{resolving} connecting{connecting} connected{connected} offline{desktop offline} suspended{suspended} other{{state}}}'**
  String pairingStateLabel(String state);

  /// Settings row that picks the app's language.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get settingsLanguage;

  /// Language option that follows the phone's language.
  ///
  /// In en, this message translates to:
  /// **'System default'**
  String get settingsLanguageSystem;

  /// No description provided for @workspaceUndoNoExactPatch.
  ///
  /// In en, this message translates to:
  /// **'No complete exact unified patch was captured.'**
  String get workspaceUndoNoExactPatch;

  /// No description provided for @workspaceUndoRenames.
  ///
  /// In en, this message translates to:
  /// **'Renames cannot be undone here.'**
  String get workspaceUndoRenames;

  /// No description provided for @workspaceUndoBinary.
  ///
  /// In en, this message translates to:
  /// **'Binary, rename, mode or symlink changes cannot be undone here.'**
  String get workspaceUndoBinary;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) => <String>[
    'en',
    'es',
    'fr',
    'ja',
    'ko',
    'zh',
  ].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when language+script codes are specified.
  switch (locale.languageCode) {
    case 'zh':
      {
        switch (locale.scriptCode) {
          case 'Hant':
            return AppLocalizationsZhHant();
        }
        break;
      }
  }

  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'es':
      return AppLocalizationsEs();
    case 'fr':
      return AppLocalizationsFr();
    case 'ja':
      return AppLocalizationsJa();
    case 'ko':
      return AppLocalizationsKo();
    case 'zh':
      return AppLocalizationsZh();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
