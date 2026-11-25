// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for French (`fr`).
class AppLocalizationsFr extends AppLocalizations {
  AppLocalizationsFr([String locale = 'fr']) : super(locale);

  @override
  String get appName => 'DJL';

  @override
  String get commonCancel => 'Annuler';

  @override
  String get commonTryAgain => 'Réessayer';

  @override
  String get chatUiAccessAskTitle => 'Demander l’approbation';

  @override
  String get chatUiAccessAskDetail =>
      'Toujours demander avant de modifier des fichiers externes ou d’utiliser Internet';

  @override
  String get chatUiAccessAutoTitle => 'Approuver pour moi';

  @override
  String get chatUiAccessAutoDetail =>
      'Ne demander que pour les actions jugées potentiellement risquées';

  @override
  String get chatUiAccessFullTitle => 'Accès complet';

  @override
  String get chatUiAccessFullDetail =>
      'Accès complet à l’ordinateur (risque élevé)';

  @override
  String get chatUiAccessHint =>
      'Modifie la façon dont Codex demande l’autorisation';

  @override
  String get chatUiAccessFullConfirmTitle =>
      'Autoriser l’accès complet à l’ordinateur ?';

  @override
  String get chatUiAccessFullConfirmBody =>
      'L’agent pourra modifier des fichiers et exécuter des commandes hors de l’espace de travail sans demander d’approbation.';

  @override
  String get chatUiAccessFullConfirm => 'Autoriser l’accès complet';

  @override
  String get chatUiAttentionNoMatches => 'Aucun élément correspondant';

  @override
  String get chatUiAttentionAllCaughtUp => 'Vous êtes à jour';

  @override
  String get chatUiAttentionNoMatchesHint =>
      'Essayez un autre projet, une autre discussion ou un autre statut.';

  @override
  String get chatUiAttentionEmptyHint =>
      'Les approbations, les questions des agents, les exécutions en échec et le travail terminé apparaîtront ici.';

  @override
  String get chatUiAttentionNeedsYou => 'VOUS ATTEND';

  @override
  String get chatUiAttentionReadyToReview => 'PRÊT À VÉRIFIER';

  @override
  String get chatUiAgoNow => 'à l’instant';

  @override
  String chatUiAgoMinutes(int minutes) {
    return 'il y a $minutes min';
  }

  @override
  String chatUiAgoHours(int hours) {
    return 'il y a $hours h';
  }

  @override
  String chatUiAgoDays(int days) {
    return 'il y a $days j';
  }

  @override
  String get chatUiAttentionTitle => 'À traiter';

  @override
  String get chatUiAttentionConnectionChanged =>
      'La connexion a changé. Revenez en arrière pour rouvrir « À traiter ».';

  @override
  String get chatUiAttentionSearch => 'Rechercher dans « À traiter »';

  @override
  String get appSavedConnectionsUnreadable =>
      'Impossible de lire les connexions enregistrées. Elles ont été conservées.';

  @override
  String get appRestoreMacsFailed =>
      'Impossible de restaurer les Mac enregistrés. Déverrouillez votre appareil et réessayez.';

  @override
  String get appLinkedConversationFailed =>
      'Impossible d’ouvrir la discussion liée. Vérifiez votre connexion et réessayez.';

  @override
  String get appLinkedAccountUnavailable =>
      'Les informations du compte ne sont pas encore disponibles. Réessayez d’ouvrir la discussion liée une fois chargées.';

  @override
  String get appAccountStillLoading =>
      'Les informations du compte sont en cours de chargement. Veuillez réessayer.';

  @override
  String get appRenameChat => 'Renommer la discussion';

  @override
  String get appRenameChatPlaceholder => 'Titre';

  @override
  String get appSave => 'Enregistrer';

  @override
  String get appOpenNavigation => 'Ouvrir la navigation';

  @override
  String get appAccountUnavailable =>
      'Les informations du compte ne sont pas disponibles.';

  @override
  String get appRetryAccount => 'Recharger le compte';

  @override
  String get appImages => 'Images';

  @override
  String get appNotifications => 'Notifications';

  @override
  String get appRetryLinkedConversation => 'Rouvrir la discussion liée';

  @override
  String get coreBack => 'Retour';

  @override
  String get coreMenu => 'Menu';

  @override
  String get coreChatActions => 'Actions de la discussion';

  @override
  String get coreSessionEnded =>
      'Votre session a expiré. Veuillez vous reconnecter.';

  @override
  String coreCloudRequestFailed(int status) {
    return 'La requête DJL Cloud a échoué ($status).';
  }

  @override
  String get coreAccountChanged => 'Le compte a changé.';

  @override
  String get corePleaseSignIn => 'Veuillez vous connecter.';

  @override
  String get coreNoAccessToken => 'DJL Cloud n’a renvoyé aucun jeton d’accès.';

  @override
  String get coreCloudTimeout => 'DJL Cloud a mis trop de temps à répondre.';

  @override
  String get coreCloudUnreachable =>
      'Impossible de joindre DJL Cloud. Vérifiez votre connexion.';

  @override
  String get corePleaseSignInAgain => 'Veuillez vous reconnecter.';

  @override
  String get coreInvalidPushRegistration =>
      'Inscription aux notifications non valide.';

  @override
  String get corePushNotAcknowledged => 'L’inscription n’a pas été confirmée.';

  @override
  String get coreCloudResponseUnreadable =>
      'Cette version n’a pas pu lire la réponse de DJL Cloud.';

  @override
  String get coreInvalidDesktopEnvelope =>
      'Message de l’ordinateur non valide ou rejoué.';

  @override
  String get coreDesktopMessageUnauthenticated =>
      'Impossible d’authentifier le message de l’ordinateur.';

  @override
  String get gitThreadChangedReopenAction =>
      'L’activité de la discussion a changé. Relancez cette action de branche ou d’arbre de travail.';

  @override
  String get gitWaitForThread =>
      'Attendez la fin de cette discussion avant de changer de branche ou d’arbre de travail.';

  @override
  String get gitWaitForOperation =>
      'Attendez la fin de l’opération Git en cours avant de changer de branche ou d’arbre de travail.';

  @override
  String get gitNotRepositorySentence => 'Ce dossier n’est pas un dépôt Git.';

  @override
  String get gitNotRepository => 'Ce dossier n’est pas un dépôt Git';

  @override
  String get gitNoLongerRepository =>
      'Ce dossier n’est plus un dépôt Git. Actualisez avant de créer une branche ou un arbre de travail.';

  @override
  String get gitContinue => 'Continuer';

  @override
  String get gitOk => 'OK';

  @override
  String get gitCreate => 'Créer';

  @override
  String get gitClose => 'Fermer';

  @override
  String get gitDone => 'Terminé';

  @override
  String get gitGenerating => 'Génération…';

  @override
  String get gitGenerateMessage => 'Générer le message';

  @override
  String get gitCommitAllTitle => 'Valider toutes les modifications';

  @override
  String get gitCommitPublishTitle => 'Valider et publier les modifications';

  @override
  String get gitCommitMessageLabel => 'Message de commit';

  @override
  String get gitPublishBranchTitle => 'Publier cette branche ?';

  @override
  String get gitPublishCommitPushBody =>
      'Valider toutes les modifications et pousser cette branche vers son dépôt distant.';

  @override
  String get gitPublishFeatureBranchPrBody =>
      'Préparer une branche de fonctionnalité, valider toutes les modifications, pousser la branche et créer une pull request sur GitHub.';

  @override
  String get gitPublishCommitPrBody =>
      'Valider toutes les modifications, pousser la branche et créer une pull request sur GitHub.';

  @override
  String get gitCommitCreateSwitch => 'Valider, créer et basculer';

  @override
  String get gitCreateManagedWorktree => 'Créer un arbre de travail géré';

  @override
  String get gitCreateWorktree => 'Créer un arbre de travail';

  @override
  String get gitBranchName => 'Nom de la branche';

  @override
  String get gitBaseBranch => 'Branche de base';

  @override
  String get gitMoveCurrentChanges => 'Déplacer les modifications';

  @override
  String get gitCopyCurrentChanges => 'Copier les modifications';

  @override
  String get gitLeaveChangesHere => 'Laisser les modifications ici';

  @override
  String get gitInitializeTitle => 'Initialiser Git ?';

  @override
  String get gitInitializeBody =>
      'Créer un dépôt Git dans cet espace de travail.';

  @override
  String get gitPushTitle => 'Pousser la branche ?';

  @override
  String get gitPushBody =>
      'Pousser les modifications validées vers le dépôt distant configuré.';

  @override
  String get gitLocalChangesNeedAttention =>
      'Des modifications locales demandent votre attention';

  @override
  String get gitUpdateRepositoryTitle => 'Mettre à jour le dépôt ?';

  @override
  String get gitDirtyAndBehindBody =>
      'Vous avez des modifications locales et la branche distante a avancé. Ne récupérez avec rebase que si vous êtes prêt à réconcilier ces modifications.';

  @override
  String get gitPullBody =>
      'Récupérer les commits distants dans cette branche.';

  @override
  String get gitPullAndRebase => 'Récupérer et rebaser';

  @override
  String get gitUpdate => 'Mettre à jour';

  @override
  String get gitTransferChangesTitle => 'Transférer les modifications';

  @override
  String get gitTargetWorkspacePath => 'Chemin de l’espace de travail cible';

  @override
  String get gitRemoveWorktreeTitle => 'Supprimer cet arbre de travail ?';

  @override
  String get gitRemoveWorktreeBody =>
      'Supprimer l’arbre de travail géré de cette branche. L’ordinateur refusera de supprimer la copie de travail principale.';

  @override
  String get gitDiscardTitle => 'Abandonner les modifications locales ?';

  @override
  String get gitDiscardBody =>
      'Abandonner les modifications locales des fichiers et réinitialiser cette branche sur sa version distante.';

  @override
  String get gitPrDraftTitle => 'Brouillon de pull request';

  @override
  String get gitCopyDraft => 'Copier le brouillon';

  @override
  String get gitCreatePrTitle => 'Créer une pull request ?';

  @override
  String get gitCreatePrBody =>
      'L’ordinateur poussera cette branche si nécessaire, générera un titre et une description à partir des modifications validées, puis créera la pull request sur GitHub.';

  @override
  String get gitNoChangesToShow => 'Aucune modification du dépôt à afficher.';

  @override
  String get gitBranchSwitchFailed => 'Échec du changement de branche';

  @override
  String get gitBranchOpenElsewhere =>
      'Impossible de changer de branche : elle est déjà ouverte dans un autre arbre de travail.';

  @override
  String get gitErrorTitle => 'Erreur Git';

  @override
  String get gitOpenPr => 'Ouvrir la PR';

  @override
  String get gitLoadingChanges => 'Chargement des modifications';

  @override
  String get gitLoadingChangesEllipsis => 'Chargement des modifications…';

  @override
  String get gitChangesUnavailable => 'Modifications indisponibles';

  @override
  String get gitNoChanges => 'Aucune modification';

  @override
  String get gitDesktopChanged =>
      'L’ordinateur connecté a changé. Rouvrez Git depuis son espace de travail.';

  @override
  String get gitChooseWorkspace =>
      'Choisissez un espace de travail sur l’ordinateur avant d’utiliser Git.';

  @override
  String get gitWorking => 'En cours…';

  @override
  String get gitRetryStatus => 'Recharger l’état Git';

  @override
  String get gitWorktreeUnavailable => 'Arbre de travail indisponible';

  @override
  String get gitActionsLabel => 'Actions Git';

  @override
  String get gitRefreshStatus => 'Actualiser l’état Git';

  @override
  String get gitShowMenu => 'Afficher le menu';

  @override
  String get gitInitializeRepository => 'Initialiser le dépôt';

  @override
  String get gitCreateBranch => 'Créer une branche';

  @override
  String get gitTransferToWorkspace =>
      'Transférer les modifications vers l’espace de travail';

  @override
  String get gitRemoveManagedWorktree => 'Supprimer l’arbre de travail géré';

  @override
  String get gitGeneratePrDraft => 'Générer un brouillon de PR';

  @override
  String get gitCreatePullRequest => 'Créer une pull request';

  @override
  String get gitCommitAndPushMenu => 'Valider et pousser';

  @override
  String get gitCommitPushCreatePrMenu => 'Valider, pousser et créer une PR';

  @override
  String get gitDiscardAndReset =>
      'Abandonner et revenir à la version distante';

  @override
  String get gitWorktreeReady => 'Arbre de travail prêt';

  @override
  String get gitOpenChat => 'Ouvrir la discussion';

  @override
  String get gitOpenPullRequest => 'Ouvrir la pull request';

  @override
  String get gitDetachedHead => 'HEAD détachée';

  @override
  String get gitNoUpstream => 'Aucune branche amont';

  @override
  String gitAheadBehind(int ahead, int behind) {
    return '$ahead en avance · $behind en retard';
  }

  @override
  String get gitCommitChanges => 'Valider les modifications';

  @override
  String get gitPush => 'Pousser';

  @override
  String get gitPullTitle => 'Récupérer les modifications ?';

  @override
  String get gitPull => 'Récupérer';

  @override
  String get gitViewDiff => 'Voir les différences';

  @override
  String get gitCurrentBranch => 'Branche actuelle';

  @override
  String get gitBranchFallback => 'Branche';

  @override
  String get gitWriterModel => 'Modèle de rédaction Git';

  @override
  String get gitConnectCodexModel =>
      'Connectez un modèle Codex sur votre Mac pour générer les messages de commit et les brouillons de PR.';

  @override
  String gitChangedFilesCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count fichiers modifiés',
      one: '$count fichier modifié',
    );
    return '$_temp0';
  }

  @override
  String get gitActionInitialize => 'Initialiser Git';

  @override
  String get gitActionChanges => 'Modifications';

  @override
  String get gitActionCommit => 'Valider';

  @override
  String get gitActionCommitAndPush => 'Valider et pousser';

  @override
  String get gitActionCommitPushPr => 'Valider, pousser et PR';

  @override
  String get gitActionCreatePr => 'Créer une PR';

  @override
  String get gitSectionSetup => 'Configuration';

  @override
  String get gitSectionWrite => 'Écriture';

  @override
  String get gitStatusNotInitialized => 'Git n’est pas initialisé';

  @override
  String get gitStatusUpToDate => 'Dépôt à jour';

  @override
  String get gitStatusAheadOnly => 'Branche locale en avance sur la distante';

  @override
  String get gitStatusBehindOnly => 'Branche distante en avance sur la locale';

  @override
  String get gitStatusDiverged => 'Les branches locale et distante ont divergé';

  @override
  String get gitStatusDirty =>
      'Le dépôt local contient des modifications non validées';

  @override
  String get gitStatusDirtyAndBehind =>
      'Modifications locales présentes et branche distante en avance';

  @override
  String get gitStatusNoUpstream => 'Branche pas encore publiée';

  @override
  String get gitStatusDetachedHead => 'Branche actuelle indisponible';

  @override
  String get gitStatusUnavailable => 'État du dépôt indisponible';

  @override
  String gitReviewLocalCommits(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count commits locaux',
      one: '$count commit local',
    );
    return '$_temp0';
  }

  @override
  String get gitReviewTheCurrentBranch => 'la branche actuelle';

  @override
  String gitReviewCreatingFrom(String name, String source) {
    return 'Vous créez « $name » à partir de $source. Emportez vos modifications locales sur la nouvelle branche, ou validez d’abord puis créez et basculez.';
  }

  @override
  String gitReviewCommitsStayPrefix(
    String base,
    String commits,
    String message,
  ) {
    return '$base contient déjà $commits absents du dépôt distant. Ces commits restent dans l’historique de $base. $message';
  }

  @override
  String get gitReviewFilesWithChanges =>
      'Fichiers avec des modifications locales :';

  @override
  String gitReviewMoreFiles(int count) {
    return '+$count autres fichiers';
  }

  @override
  String gitReviewBringChangesTitle(String name) {
    return 'Emporter les modifications locales sur « $name » ?';
  }

  @override
  String get gitReviewCarryToNewBranch => 'Emporter sur la nouvelle branche';

  @override
  String gitReviewCommitsStayTitle(String base) {
    return 'Les commits locaux restent sur $base';
  }

  @override
  String gitReviewBranchCommitsStay(String base, String commits, String name) {
    return '$base contient déjà $commits absents du dépôt distant. Créer « $name » maintenant fait partir la nouvelle branche du HEAD actuel, mais ces commits restent dans l’historique de $base.';
  }

  @override
  String get gitReviewCreateAnyway => 'Créer quand même';

  @override
  String get gitReviewManagedWorktreeNoun => 'un arbre de travail géré';

  @override
  String gitReviewQuotedName(String name) {
    return '« $name »';
  }

  @override
  String get gitReviewCopyTitle =>
      'Copier les modifications locales de la branche actuelle';

  @override
  String get gitReviewMoveTitle =>
      'Déplacer les modifications locales de la branche actuelle';

  @override
  String get gitReviewVerbCopy => 'copier';

  @override
  String get gitReviewVerbMove => 'déplacer';

  @override
  String gitReviewOnlyCurrentBranch(
    String target,
    String verb,
    String current,
  ) {
    return 'La création de $target ne peut $verb des modifications locales que depuis la branche actuelle. Choisissez « $current » comme branche de base ou nettoyez les modifications locales avant de créer l’arbre de travail.';
  }

  @override
  String gitReviewCopiedInto(String worktree) {
    return ' Les modifications locales seront aussi copiées dans $worktree ; les fichiers ignorés restent ici.';
  }

  @override
  String gitReviewMovedInto(String worktree) {
    return ' Les modifications locales seront déplacées dans $worktree ; les fichiers ignorés restent ici.';
  }

  @override
  String get gitReviewTheManagedWorktree => 'l’arbre de travail géré';

  @override
  String get gitReviewTheNewWorktree => 'le nouvel arbre de travail';

  @override
  String gitReviewWorktreeCommitsStay(
    String base,
    String commits,
    String target,
    String from,
    String suffix,
  ) {
    return '$base contient déjà $commits absents du dépôt distant. Créer $target depuis $from part du HEAD actuel, mais ces commits restent aussi dans l’historique de $base.$suffix';
  }

  @override
  String get gitBadgeOpenWorktree => 'Ouvrir l’arbre de travail';

  @override
  String get gitBadgeOpenElsewhere => 'Ouvert ailleurs';

  @override
  String get gitActionCompleted => 'Action Git terminée.';

  @override
  String gitActionFailed(String error) {
    return '$error Actualisez avant de relancer une action dont le résultat est inconnu.';
  }

  @override
  String get gitDismissMenu => 'Fermer le menu';

  @override
  String get gitDiffPatch => 'Patch';

  @override
  String gitDiffLine(int line) {
    return 'Ligne $line';
  }

  @override
  String gitDiffLines(int first, int last) {
    return 'Lignes $first à $last';
  }

  @override
  String get gitDismissBranchPicker => 'Fermer le sélecteur de branche';

  @override
  String get gitBadgeCurrent => 'Actuelle';

  @override
  String get gitBadgeDefault => 'Par défaut';

  @override
  String get gitCloseBranchPicker => 'Fermer le sélecteur de branche';

  @override
  String get gitBranchPickerStale =>
      'La discussion ou l’ordinateur a changé. Fermez puis rouvrez le sélecteur de branche.';

  @override
  String get gitSearchBranches => 'Rechercher une branche';

  @override
  String get gitClearBranchSearch => 'Effacer la recherche';

  @override
  String get gitBranches => 'Branches';

  @override
  String get gitNoBranchesFound => 'Aucune branche trouvée';

  @override
  String get gitNoBranchesHint =>
      'Essayez une autre recherche ou actualisez la liste des branches.';

  @override
  String gitCreateAndCheckout(String name) {
    return 'Créer et basculer sur « $name »';
  }

  @override
  String get gitNewBranchEllipsis => 'Nouvelle branche…';

  @override
  String get gitSwitching => 'Changement…';

  @override
  String get gitRefreshing => 'Actualisation…';

  @override
  String get gitReloadBranchList => 'Recharger la liste des branches';

  @override
  String get gitCloseWorktreeReview => 'Fermer l’aperçu de l’arbre de travail';

  @override
  String get gitHandoffTitle =>
      'Transférer la discussion vers un arbre de travail';

  @override
  String get gitForkTitle =>
      'Dupliquer la discussion dans un nouvel arbre de travail';

  @override
  String get gitHandoff => 'Transférer';

  @override
  String get gitFork => 'Dupliquer';

  @override
  String get gitHandoffMessage =>
      'Créer une branche dans un nouvel arbre de travail et basculer dessus pour continuer en parallèle. Le nom de la branche reçoit le préfixe djl/.';

  @override
  String get gitForkMessage =>
      'Créer une branche dans un nouvel arbre de travail et basculer dessus, puis dupliquer cette discussion dans cette copie sous forme de nouvelle discussion.';

  @override
  String get gitStartsFromBase => 'Part de cette branche de base.';

  @override
  String get gitLoadingWorktreeBranches =>
      'Chargement des branches de l’arbre de travail';

  @override
  String get gitPreparingWorktree => 'Préparation de l’arbre de travail';

  @override
  String get gitNewBranch => 'Nouvelle branche';

  @override
  String get gitNewBranchBody =>
      'La branche sera créée localement et activée. Les modifications non validées restent dans cette copie de travail.';

  @override
  String get gitThreadChangedReopenGit =>
      'L’activité de la discussion a changé. Fermez puis rouvrez cette action Git.';

  @override
  String get gitRepositoryChanges => 'Modifications du dépôt';

  @override
  String gitFilesChanged(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count fichiers modifiés',
      one: '$count fichier modifié',
    );
    return '$_temp0';
  }

  @override
  String get gitExpandAll => 'Tout déplier';

  @override
  String get gitCollapseAll => 'Tout replier';

  @override
  String gitPatchIndex(int index, int total) {
    return 'Patch $index sur $total';
  }

  @override
  String get chatUiComposerOptions => 'Options de saisie';

  @override
  String get chatUiStopDictation => 'Arrêter la dictée';

  @override
  String get chatUiStartDictation => 'Démarrer la dictée';

  @override
  String get chatUiResumeQueued => 'Reprendre les messages en attente';

  @override
  String get chatUiStopTurn => 'Arrêter la réponse';

  @override
  String get chatUiSendToDesktop => 'Envoyer à l’ordinateur';

  @override
  String get chatUiStartingRun => 'Démarrage';

  @override
  String get chatUiRemoveImage => 'Retirer l’image';

  @override
  String get chatUiAttachedImage => 'Image jointe';

  @override
  String chatUiDesktopImage(String source) {
    return 'Image de l’ordinateur : $source';
  }

  @override
  String get chatUiImagePreviewUnavailable => 'Aperçu de l’image indisponible';

  @override
  String get chatUiContextSkills => 'Compétences';

  @override
  String get chatUiContextPlugins => 'Plugins';

  @override
  String get chatUiContextFiles => 'Fichiers';

  @override
  String chatUiContextUnsupported(String kind) {
    return '$kind : non pris en charge par cet environnement de l’ordinateur.';
  }

  @override
  String get chatUiContextStale =>
      'La discussion a changé. Rouvrez le sélecteur de contexte.';

  @override
  String get chatUiContextRetry => 'Relancer la recherche';

  @override
  String chatUiContextSearchFilesIn(String path) {
    return 'Rechercher des fichiers dans $path';
  }

  @override
  String get chatUiContextSelectFolder =>
      'Sélectionnez un dossier de projet pour rechercher des fichiers sur l’ordinateur.';

  @override
  String chatUiContextNoneFound(String kind) {
    return 'Aucun élément trouvé ($kind).';
  }

  @override
  String get chatUiAddDesktopContext => 'Ajouter du contexte de l’ordinateur';

  @override
  String get chatUiContextSearchFiles =>
      'Rechercher des fichiers sur votre ordinateur';

  @override
  String chatUiContextSearchKind(String kind) {
    return 'Rechercher : $kind';
  }

  @override
  String get chatUiContextDisabled => 'Désactivé sur l’ordinateur';

  @override
  String get chatUiContextOnDesktop => 'Sur l’ordinateur jumelé';

  @override
  String get chatUiEmptyGeneralTitle => 'Sur quoi travaillons-nous ?';

  @override
  String get chatUiEmptyFolderPrefix => 'Que faisons-nous dans ';

  @override
  String get chatUiEmptyFolderSuffix => ' ?';

  @override
  String get chatUiEmptyGreeting => 'Bonjour ! Comment puis-je vous aider ?';

  @override
  String get chatUiEncryptedCaption => 'Discussions chiffrées de bout en bout';

  @override
  String get chatUiUserMessage => 'Message de l’utilisateur';

  @override
  String get chatUiAssistantMessage => 'Message de l’assistant';

  @override
  String get chatUiThreadActions => 'Actions de la discussion';

  @override
  String get chatUiBranchesAndWorktrees => 'Branches et arbres de travail';

  @override
  String get chatUiGitActions => 'Actions Git';

  @override
  String get chatUiWorking => 'En cours…';

  @override
  String get chatUiScrollToLatest => 'Aller au dernier message';

  @override
  String get chatUiSavedToPhotos => 'Enregistrée dans Photos.';

  @override
  String get chatUiShareImageFailed =>
      'Impossible de partager cette image. Veuillez réessayer.';

  @override
  String get chatUiSaveImageFailed =>
      'Impossible d’enregistrer cette image. Veuillez réessayer.';

  @override
  String get chatUiLoadImageFailed => 'Impossible de charger cette image.';

  @override
  String get chatUiRetry => 'Réessayer';

  @override
  String get chatUiImageReopenWorkspace =>
      'Reconnectez-vous ou rouvrez cette image depuis son espace de travail.';

  @override
  String get chatUiImageReopenChat =>
      'Rouvrez cette image depuis sa discussion jumelée.';

  @override
  String chatUiOpenImage(String name) {
    return 'Ouvrir l’image $name';
  }

  @override
  String get chatUiClose => 'Fermer';

  @override
  String get chatUiShare => 'Partager';

  @override
  String get chatUiSaveToPhotos => 'Enregistrer dans Photos';

  @override
  String get chatUiModelsGroup => 'Modèles';

  @override
  String get chatUiRefreshModels => 'Actualiser les modèles';

  @override
  String get chatUiProviderAndModel => 'Fournisseur et modèle';

  @override
  String get chatUiDone => 'OK';

  @override
  String get chatUiAllProviders => 'Tous les fournisseurs';

  @override
  String get chatUiModelsConnectionChanged =>
      'La connexion a changé. Rouvrez le choix du modèle.';

  @override
  String get chatUiLoadingModels => 'Chargement des modèles';

  @override
  String get chatUiNoModels => 'Aucun modèle disponible';

  @override
  String get chatUiNoModelsHint =>
      'Connectez un fournisseur dans DJL sur votre ordinateur, puis actualisez la liste des modèles.';

  @override
  String get chatUiNoMatchingModels => 'Aucun modèle correspondant';

  @override
  String get chatUiSearchModels => 'Rechercher un fournisseur ou un modèle';

  @override
  String get chatUiClearModelSearch => 'Effacer la recherche';

  @override
  String get chatUiNavCloudChat => 'Discussion Cloud';

  @override
  String get chatUiNavRemote => 'À distance';

  @override
  String get chatUiNavSearchFailed =>
      'Impossible de rechercher dans les discussions.';

  @override
  String get chatUiNavRetrySearch => 'Relancer la recherche';

  @override
  String get chatUiNavSearching => 'Recherche en cours…';

  @override
  String get chatUiNavPinned => 'Épinglées';

  @override
  String get chatUiNavPinnedEmpty =>
      'Gardez vos discussions favorites à portée de main.\nTouchez longuement une discussion pour l’épingler.';

  @override
  String get chatUiNavRecent => 'Discussions récentes';

  @override
  String get chatUiNavRecentEmpty => 'Vos discussions apparaîtront ici.';

  @override
  String get chatUiNoMatchingChats => 'Aucune discussion correspondante';

  @override
  String get chatUiCloseSearch => 'Fermer la recherche';

  @override
  String get chatUiSearchChats => 'Rechercher';

  @override
  String get chatUiChatButton => 'Discussion';

  @override
  String get chatUiNewChat => 'Nouvelle discussion';

  @override
  String get chatUiSettings => 'Paramètres';

  @override
  String get chatUiMoreActions => 'Plus d’actions';

  @override
  String get chatUiMenuNewChat => 'Nouvelle discussion';

  @override
  String get chatUiMenuQuickChat => 'Discussion rapide';

  @override
  String get chatUiMenuNewProject => 'Nouveau projet';

  @override
  String get chatUiMenuConnections => 'Connexions';

  @override
  String get chatUiMenuSecurePairing => 'Détails du jumelage sécurisé';

  @override
  String get chatUiMenuYourMac => 'Votre Mac';

  @override
  String get chatUiMenuActiveChats => 'Discussions actives';

  @override
  String get chatUiArchivedChats => 'Discussions archivées';

  @override
  String get chatUiMenuRefresh => 'Actualiser';

  @override
  String get chatUiMenuDisconnect => 'Se déconnecter';

  @override
  String get chatUiOpenNavigation => 'Ouvrir la navigation';

  @override
  String get chatUiSearchConversations => 'Rechercher dans les discussions';

  @override
  String get chatUiDismissSearch => 'Fermer la recherche';

  @override
  String get chatUiStatusConnecting => 'Connexion…';

  @override
  String get chatUiStatusDeviceOffline => 'Appareil hors ligne';

  @override
  String get chatUiStatusOffline => 'Hors ligne';

  @override
  String chatUiConnectionStatus(String status) {
    return 'État de la connexion : $status';
  }

  @override
  String get chatUiGroups => 'Groupes';

  @override
  String get homeTabChats => 'Discussions';

  @override
  String get chatUiExpandAll => 'Tout déplier';

  @override
  String get chatUiCollapseAll => 'Tout replier';

  @override
  String chatUiCollapseChildChats(String title) {
    return 'Replier les sous-discussions de $title';
  }

  @override
  String chatUiExpandChildChats(String title) {
    return 'Déplier les sous-discussions de $title';
  }

  @override
  String get chatUiDesktopChatActions =>
      'Actions de la discussion sur l’ordinateur';

  @override
  String get chatUiArchiveProject => 'Archiver le projet';

  @override
  String get chatUiRemoveFromPhone => 'Retirer du téléphone';

  @override
  String chatUiArchiveProjectTitle(String name) {
    return 'Archiver « $name » ?';
  }

  @override
  String get chatUiArchiveProjectBody =>
      'Toutes les discussions actives de ce projet seront archivées.';

  @override
  String chatUiRemoveProjectTitle(String name) {
    return 'Retirer « $name » de ce téléphone ?';
  }

  @override
  String get chatUiRemoveProjectBody =>
      'Les discussions de ce projet seront supprimées uniquement de DJL sur ce téléphone. Rien n’est supprimé de votre ordinateur ni de l’observateur Codex.';

  @override
  String chatUiExpandProject(String name) {
    return 'Déplier le projet $name';
  }

  @override
  String chatUiCollapseProject(String name) {
    return 'Replier le projet $name';
  }

  @override
  String chatUiNewChatIn(String name) {
    return 'Nouvelle discussion dans $name';
  }

  @override
  String get chatUiNewGroup => 'Nouveau groupe';

  @override
  String get chatUiGroupButton => 'Groupe';

  @override
  String get chatUiOfflineSavedChats => 'Hors ligne · discussions enregistrées';

  @override
  String get chatUiReconnect => 'Reconnecter';

  @override
  String get chatUiNoMatchingChatsPeriod => 'Aucune discussion correspondante.';

  @override
  String get chatUiNoStudioThreads => 'Aucune discussion Studio';

  @override
  String get chatUiNoProjectChats => 'Aucune discussion de projet';

  @override
  String get desktopAttentionApproval => 'Approbation requise';

  @override
  String get desktopAttentionQuestion => 'L’agent a une question';

  @override
  String get desktopAttentionFailedRun => 'Échec de l’exécution';

  @override
  String get desktopAttentionBlockedGoal => 'Objectif à vérifier';

  @override
  String get desktopAttentionCompletedRun => 'Prêt à vérifier';

  @override
  String get desktopFailurePermission =>
      'Vérifiez l’accès demandé ou changez le mode d’accès de cette discussion, puis relancez l’exécution.';

  @override
  String get desktopFailureSignIn =>
      'Reconnectez-vous sur votre Mac, puis relancez l’exécution.';

  @override
  String get desktopFailureTimeout =>
      'Vérifiez la connexion au Mac, puis relancez l’exécution.';

  @override
  String get desktopFailureNetwork =>
      'Vérifiez que le Mac et le relais sont en ligne, puis relancez l’exécution.';

  @override
  String get desktopFailureCheck =>
      'Ouvrez la discussion pour examiner la vérification en échec, corrigez-la et réessayez.';

  @override
  String get desktopFailureGeneric =>
      'Ouvrez la discussion pour revoir la dernière étape, corrigez le problème et réessayez.';

  @override
  String desktopAttentionAllowCommand(String command) {
    return 'Autoriser Codex à exécuter « $command » ?';
  }

  @override
  String get desktopAttentionAwaitingPermission =>
      'Codex attend votre autorisation pour continuer.';

  @override
  String get desktopAttentionAnswerAgent =>
      'Ouvrez la discussion pour répondre à l’agent.';

  @override
  String get desktopGoalBlocked =>
      'L’objectif est bloqué. Ouvrez la discussion pour voir ce dont l’agent a besoin.';

  @override
  String get desktopGoalUsageLimited =>
      'Les limites d’utilisation ont mis cet objectif en pause. Relisez la discussion avant de le reprendre.';

  @override
  String get desktopGoalBudgetLimited =>
      'L’objectif a atteint son budget. Examinez le résultat avant de décider de la suite.';

  @override
  String get desktopRunFinishedReview =>
      'L’exécution est terminée. Examinez le résultat et les fichiers modifiés avant de continuer.';

  @override
  String get desktopScopeStudio => 'Studio';

  @override
  String get desktopScopeProjects => 'Projets';

  @override
  String get desktopNoProject => 'Sans projet';

  @override
  String get desktopGroupPinned => 'Épinglées';

  @override
  String get desktopUntitledChat => 'Discussion sans titre';

  @override
  String get desktopComposerTooManyImages =>
      'Choisissez quatre images au maximum.';

  @override
  String get desktopContextIncomplete =>
      'Un contexte sélectionné est incomplet. Retirez-le et sélectionnez-le à nouveau.';

  @override
  String get desktopApproveForMeUnsupported =>
      '« Approuver pour moi » n’est pas pris en charge par cet environnement. Mettez à jour Codex sur votre Mac et réessayez.';

  @override
  String get desktopEnterChatName => 'Saisissez un nom de discussion.';

  @override
  String get desktopContextPickerStale =>
      'L’ordinateur connecté a changé. Rouvrez le sélecteur de contexte.';

  @override
  String get desktopNoSkillList =>
      'L’ordinateur n’a renvoyé aucune liste de compétences.';

  @override
  String get desktopNoPluginList =>
      'L’ordinateur n’a renvoyé aucune liste de plugins.';

  @override
  String get desktopNoFileMatches =>
      'L’ordinateur n’a renvoyé aucun fichier correspondant.';

  @override
  String get desktopPairedDisconnectedOrChanged =>
      'L’ordinateur jumelé est déconnecté ou a changé.';

  @override
  String get desktopPairedChangedRefreshOverview =>
      'L’ordinateur jumelé a changé. Actualisez sa vue d’ensemble.';

  @override
  String get desktopPairedChangedRefreshChats =>
      'L’ordinateur jumelé a changé. Actualisez ses discussions.';

  @override
  String get desktopIdentityMismatch =>
      'L’identité de l’ordinateur ou le protocole sécurisé ne correspond pas au jumelage.';

  @override
  String get desktopHandshakeUnverified =>
      'Impossible de vérifier la signature de l’échange sécurisé avec l’ordinateur.';

  @override
  String get desktopHandshakeTimedOut =>
      'L’échange sécurisé avec l’ordinateur a expiré.';

  @override
  String get desktopSecureConnectionRefused =>
      'L’ordinateur a refusé la connexion sécurisée.';

  @override
  String get desktopHandshakeInterrupted =>
      'Connexion à l’ordinateur interrompue pendant l’échange sécurisé.';

  @override
  String get desktopSecureConnectionRejected =>
      'Connexion sécurisée à l’ordinateur refusée.';

  @override
  String get desktopInvalidFrame => 'Trame de l’ordinateur non valide.';

  @override
  String get desktopSecureTransportFailed =>
      'Échec du transport sécurisé avec l’ordinateur.';

  @override
  String get desktopUnencryptedRejected =>
      'Le trafic non chiffré de l’ordinateur a été rejeté.';

  @override
  String get desktopPayloadDecodeFailed =>
      'Impossible de décoder une partie des données de l’ordinateur.';

  @override
  String get desktopRequestFailed => 'La requête à l’ordinateur a échoué.';

  @override
  String get desktopIsDisconnected => 'L’ordinateur est déconnecté.';

  @override
  String get desktopConnectionChanged =>
      'La connexion à l’ordinateur a changé.';

  @override
  String get desktopRequestTimedOut =>
      'La requête à l’ordinateur a expiré. Son résultat est inconnu ; actualisez avant de réessayer.';

  @override
  String get desktopDisconnectedRefresh =>
      'Ordinateur déconnecté ; actualisez avant de relancer une action.';

  @override
  String get desktopVerifiedHostRequired =>
      'Un hôte vérifié enregistré est requis.';

  @override
  String get desktopResponseFailed =>
      'L’ordinateur n’a pas pu terminer cette réponse. Vérifiez les paramètres du fournisseur et réessayez.';

  @override
  String get desktopWaitBeforeMovingProject =>
      'Attendez la fin de l’opération en cours avant de déplacer le projet de la discussion.';

  @override
  String get desktopProviderUnavailable =>
      'Le fournisseur de cette discussion n’est pas disponible. Connectez-le sur votre ordinateur ou choisissez-en un autre.';

  @override
  String get desktopReopenBeforeRestore =>
      'Rouvrez cette discussion pour vérifier l’échange avant de restaurer les modifications.';

  @override
  String get desktopSwitchCancelled =>
      'Changement annulé. Choisissez un appareil auquel vous reconnecter.';

  @override
  String get desktopSelectionClearUnconfirmed =>
      'Impossible de confirmer que la sélection enregistrée a été effacée. Déverrouillez votre appareil et choisissez un Mac enregistré pour récupérer.';

  @override
  String get desktopLinkIdentityUnavailable =>
      'L’identité du Mac enregistrée pour ce lien n’est pas disponible. Ouvrez la discussion depuis un Mac vérifié.';

  @override
  String get desktopChooseMatchingMac =>
      'Choisissez le Mac enregistré correspondant à ce lien. Son identité vérifiée doit correspondre.';

  @override
  String get desktopWaitingForMac =>
      'En attente du Mac sélectionné. Réessayez quand il sera disponible.';

  @override
  String get desktopLinkedConversationUnavailable =>
      'La discussion liée sur l’ordinateur n’est pas disponible.';

  @override
  String get desktopLinkedConversationLoadFailed =>
      'Impossible de charger la discussion liée. Réessayez sur le Mac sélectionné.';

  @override
  String get desktopDevicePreferencesLoadFailed =>
      'Impossible de charger les préférences locales de l’appareil. Déverrouillez votre appareil et réessayez.';

  @override
  String get desktopSavedDesktopsOpenFailed =>
      'Impossible d’ouvrir les ordinateurs enregistrés. Déverrouillez votre appareil et réessayez.';

  @override
  String get desktopModelUnavailable =>
      'Le modèle sélectionné n’est pas disponible. Choisissez un modèle disponible.';

  @override
  String get desktopStopRunsUnconfirmed =>
      'L’arrêt des exécutions n’a pas pu être confirmé ; elles tournent peut-être encore sur l’autre Mac.';

  @override
  String get desktopPairingIdentityReadFailed =>
      'Impossible de lire votre identité de jumelage sécurisé. Déverrouillez votre appareil, puis choisissez Reconnecter.';

  @override
  String get desktopRuntimeOtherHistory =>
      'L’environnement a renvoyé l’historique d’une autre discussion.';

  @override
  String get desktopLinkedHistoryUnverified =>
      'Impossible de vérifier l’historique de la discussion liée.';

  @override
  String get desktopIdleChatAndProjectRequired =>
      'Une discussion inactive et un projet valide sont requis.';

  @override
  String get desktopProjectChangeUnverified =>
      'L’environnement n’a pas confirmé le changement de projet de cette discussion.';

  @override
  String get desktopForkUnidentified =>
      'L’environnement n’a pas identifié la copie créée. Actualisez avant de réessayer.';

  @override
  String get desktopForkNotSeparate =>
      'L’environnement n’a pas créé de discussion distincte.';

  @override
  String get desktopForkUnsupported =>
      'Cet environnement ne permet pas de dupliquer les discussions. Mettez à jour DJL sur votre ordinateur et réessayez.';

  @override
  String get desktopReadSettingsFirst =>
      'Chargez les paramètres enregistrés avant de créer une discussion.';

  @override
  String get desktopConnectMacWithModels =>
      'Connectez un Mac disposant de modèles avant de créer une discussion.';

  @override
  String get desktopChatCreatedElsewhere =>
      'L’ordinateur a créé la discussion dans un autre dossier de projet. Votre brouillon local a été conservé.';

  @override
  String get desktopDraftContextOtherFolder =>
      'Le contexte du brouillon appartient à un autre dossier de projet. Retirez-le et sélectionnez à nouveau le contexte.';

  @override
  String get desktopQueuedPlanModelRequired =>
      'Choisissez un modèle disponible compatible avec le mode planification avant d’envoyer ce brouillon en attente.';

  @override
  String get desktopChooseModelFirst =>
      'Choisissez d’abord un modèle disponible sur l’ordinateur.';

  @override
  String get desktopRunChangedBeforeQueue =>
      'L’exécution en cours a changé avant l’envoi de la file d’attente. Actualisez avant de reprendre.';

  @override
  String get desktopRunChangedBeforeSteer =>
      'L’exécution en cours a changé. Actualisez avant de réorienter.';

  @override
  String get desktopModelBeforeLeavingPlan =>
      'Choisissez un modèle disponible avant de quitter le mode planification.';

  @override
  String get desktopPlanModeUnsupported =>
      'Le mode planification n’est pas pris en charge par cet environnement. Message envoyé normalement.';

  @override
  String get desktopRunIdPending =>
      'L’exécution en cours n’a pas encore publié son identifiant. Réessayez dans un instant.';

  @override
  String get desktopRuntimeOtherTurnPage =>
      'L’environnement a renvoyé les échanges d’une autre discussion.';

  @override
  String get desktopRuntimeNoTurnState =>
      'L’environnement n’a pas renvoyé l’état de cette discussion.';

  @override
  String get desktopRuntimeInvalidTurnState =>
      'L’environnement a renvoyé un état non valide.';

  @override
  String get desktopRetryApprovalUnacknowledged =>
      'L’ordinateur n’a pas confirmé l’approbation de la nouvelle tentative.';

  @override
  String get desktopDeviceFallbackName => 'Appareil';

  @override
  String get desktopDeviceChangeUnconfirmed =>
      'Impossible de confirmer la modification. Vérifiez le nom enregistré et réessayez. Si cet appareil a été oublié ou remplacé, fermez puis rouvrez l’éditeur.';

  @override
  String get desktopPreferencesReloadFailed =>
      'Impossible de confirmer ou de recharger les préférences locales. Déverrouillez votre appareil et réessayez avant d’enregistrer à nouveau.';

  @override
  String get desktopRunChangedBeforePlan =>
      'L’exécution en cours a changé. Actualisez avant de mettre en œuvre ce plan.';

  @override
  String get desktopQueueMessageArrived =>
      'Le message est arrivé. Examinez son résultat avant de reprendre les messages en attente.';

  @override
  String get desktopQueueDeliveryUnconfirmed =>
      'L’envoi des messages en attente n’a pas été confirmé. Rouvrez cette discussion avant de réessayer.';

  @override
  String get desktopRequestFromEarlierSession =>
      'Cette demande provient d’une session précédente de l’ordinateur. Actualisez la discussion.';

  @override
  String get desktopUndoReconnect =>
      'Reconnectez-vous à votre ordinateur avant de revoir l’annulation.';

  @override
  String get desktopUndoReopen =>
      'Rouvrez cette discussion pour vérifier la réponse avant d’annuler les modifications.';

  @override
  String get desktopUndoRepoBusy =>
      'Une discussion est en cours dans ce dépôt. Patientez avant d’annuler une réponse.';

  @override
  String get desktopUndoWaitResponse =>
      'Attendez la fin de la réponse en cours avant d’annuler les modifications.';

  @override
  String get desktopUndoPersistFailed =>
      'Impossible d’enregistrer le résultat de l’annulation.';

  @override
  String get desktopUndoRepoUnverified =>
      'Impossible de vérifier le dépôt de la réponse. Reconnectez-vous et vérifiez à nouveau.';

  @override
  String get desktopReconnectToRefreshModels =>
      'Reconnectez l’ordinateur pour actualiser les modèles.';

  @override
  String get desktopAccessModeNotApplied =>
      'L’ordinateur n’a pas appliqué le mode d’accès demandé.';

  @override
  String get desktopSubagentOfflineCached => 'Hors ligne · détails en cache';

  @override
  String get desktopSubagentLoading => 'Chargement des détails de l’agent';

  @override
  String get desktopSubagentLoaded => 'Détails chargés';

  @override
  String get desktopSubagentIdentityUnknown => 'Identité de l’agent inconnue';

  @override
  String get desktopSubagentLoadFailed =>
      'Impossible de charger les détails de l’agent';

  @override
  String get desktopSavedDeviceChanged =>
      'Cet appareil enregistré a changé. Choisissez-le à nouveau.';

  @override
  String get desktopMacIdentityMismatch =>
      'L’identité du Mac sélectionné ne correspond pas.';

  @override
  String get desktopOfflineChatsOpenFailed =>
      'Impossible d’ouvrir les discussions hors ligne. Déverrouillez votre appareil ou reconnectez-vous pour les charger.';

  @override
  String get desktopOfflineChatsSaveFailed =>
      'Impossible d’enregistrer les discussions hors ligne. Déverrouillez votre appareil et réessayez.';

  @override
  String get desktopChoosePairedDesktop => 'Choisissez un ordinateur jumelé.';

  @override
  String get desktopSavedLocallyUnconfirmed =>
      'Enregistré sur cet appareil. La modification sur votre ordinateur n’a pas pu être confirmée ; actualisez avant de réessayer.';

  @override
  String get desktopImageEmptyOrTooLarge =>
      'L’image sélectionnée est vide ou trop lourde. Choisissez une image plus petite.';

  @override
  String get desktopImageUnsupported =>
      'Le fichier sélectionné n’est pas une image prise en charge.';

  @override
  String get desktopImageResizeFailed =>
      'Cet appareil n’a pas pu redimensionner l’image. Choisissez une image de 1600 pixels au maximum.';

  @override
  String get desktopImageTooLarge =>
      'L’image sélectionnée est trop lourde. Choisissez une image plus petite.';

  @override
  String get desktopContextFolderChanged =>
      'Le dossier du projet a changé. Retirez le contexte existant ou revenez à son dossier d’origine.';

  @override
  String get desktopPickerOpenFailed =>
      'Impossible d’ouvrir le sélecteur. Veuillez réessayer.';

  @override
  String get desktopWorktreeStale =>
      'L’ordinateur connecté ou la discussion a changé. Relancez cette action d’arbre de travail.';

  @override
  String get desktopNotGitRepository => 'Ce dossier n’est plus un dépôt Git.';

  @override
  String get desktopBranchAlreadyExists => 'La branche existe déjà';

  @override
  String get desktopWorktreeUnidentified =>
      'L’ordinateur n’a pas identifié de nouvel arbre de travail. Actualisez avant de réessayer.';

  @override
  String get desktopForkUnverified =>
      'Le résultat de la duplication n’a pas pu être vérifié.';

  @override
  String get desktopHandoffUnverified =>
      'L’ordinateur n’a pas confirmé la destination du transfert. Vérifiez les deux dossiers avant de réessayer.';

  @override
  String get desktopWorktreePathUnavailable =>
      'Le chemin de l’arbre de travail n’est pas disponible.';

  @override
  String get desktopLocalCheckoutUnresolved =>
      'Impossible de trouver la copie locale associée à cet arbre de travail.';

  @override
  String get desktopWorktreeHandoffFailed =>
      'Échec du transfert vers l’arbre de travail';

  @override
  String get desktopWorktreeForkFailed =>
      'Échec de la duplication dans l’arbre de travail';

  @override
  String desktopAccessModeNotAppliedBy(String method) {
    return '$method n’a pas appliqué le mode d’accès sélectionné.';
  }

  @override
  String desktopApprovalReviewerNotApplied(String method) {
    return '$method n’a pas appliqué le vérificateur d’approbation sélectionné.';
  }

  @override
  String desktopApprovalPolicyNotApplied(String method) {
    return '$method n’a pas appliqué la règle d’approbation sélectionnée.';
  }

  @override
  String desktopSandboxNotApplied(String method) {
    return '$method n’a pas appliqué les autorisations de bac à sable sélectionnées.';
  }

  @override
  String desktopForkResultUnknown(String error) {
    return '$error Le résultat de la duplication est peut-être inconnu. Actualisez avant de réessayer.';
  }

  @override
  String desktopSendResultUnknown(String error) {
    return '$error Le résultat de l’envoi est peut-être inconnu. Actualisez la discussion avant de réessayer.';
  }

  @override
  String desktopQueuePaused(String reason) {
    return 'File d’attente en pause : $reason';
  }

  @override
  String desktopWorktreeExists(String branch) {
    return 'Un arbre de travail existe déjà pour « $branch ». Choisissez un autre nom.';
  }

  @override
  String desktopRollbackFailed(String reason) {
    return 'Les modifications suivies n’ont pas pu être restaurées automatiquement : $reason. Vérifiez les deux dossiers avant de réessayer.';
  }

  @override
  String desktopWorktreeKeptAt(String path) {
    return 'Le nouvel arbre de travail a été conservé dans $path. Vérifiez-le avant de réessayer.';
  }

  @override
  String get desktopWorktreeMayExist =>
      'Un arbre de travail a peut-être été créé. Il a été conservé ; actualisez et examinez-le avant de réessayer.';

  @override
  String get pairingEnterTenCharCode =>
      'Saisissez le code à dix caractères affiché dans les paramètres « À distance » de l’ordinateur.';

  @override
  String get pairingSecureRelayRequired =>
      'Le jumelage nécessite une URL de relais sécurisée.';

  @override
  String get pairingPairedMac => 'Mac jumelé';

  @override
  String get pairingNotAPairingCode =>
      'Ce n’est pas un QR code ni un code de jumelage DJL.';

  @override
  String get pairingUpdateDesktop =>
      'Mettez à jour DJL sur votre ordinateur : ce jumelage utilise un autre protocole.';

  @override
  String get pairingProofMismatch =>
      'Le code de jumelage ou le code QR ne correspond pas. Générez-en un nouveau et réessayez.';

  @override
  String get pairingInvalidIdentifier =>
      'Identifiant d’appareil ou de session non valide.';

  @override
  String get pairingInvalidIdentityKey =>
      'Clé d’identité de l’ordinateur non valide.';

  @override
  String get pairingCodeExpired =>
      'Ce code de jumelage a expiré. Générez-en un nouveau sur votre Mac.';

  @override
  String get pairingPrefsUnavailable =>
      'Les préférences de l’appareil enregistrées ne sont pas disponibles.';

  @override
  String get pairingDeviceChangedReopen =>
      'Cet appareil enregistré a changé. Fermez puis rouvrez l’éditeur.';

  @override
  String get pairingRecoverSelectionFailed =>
      'Impossible de récupérer la sélection enregistrée. Déverrouillez votre appareil et réessayez avant de choisir un Mac.';

  @override
  String get pairingDeviceChangedChooseAgain =>
      'L’appareil enregistré a changé. Choisissez-le à nouveau.';

  @override
  String get pairingConfirmSavedFailed =>
      'Impossible de confirmer l’enregistrement du Mac sélectionné. Déverrouillez votre appareil et choisissez un Mac enregistré pour récupérer.';

  @override
  String get pairingRelayDifferentIdentity =>
      'Le relais de confiance a renvoyé une autre identité d’ordinateur. Jumelez à nouveau.';

  @override
  String get pairingRelayTemporarilyUnavailable =>
      'Le relais de l’ordinateur est temporairement indisponible.';

  @override
  String get pairingRelayInvalidResponse =>
      'Le relais de l’ordinateur a renvoyé une réponse non valide.';

  @override
  String get pairingTrustedComputerOffline =>
      'L’ordinateur de confiance est hors ligne.';

  @override
  String get pairingServiceUnavailable =>
      'Le service de jumelage de l’ordinateur n’est pas disponible.';

  @override
  String get pairingRelayUnreachable =>
      'Impossible de joindre le relais de l’ordinateur.';

  @override
  String get pairingRelayUnsupportedMethod =>
      'Le relais ne prend pas en charge cette méthode de jumelage.';

  @override
  String get pairingRelayRequired => 'Une URL de relais est requise.';

  @override
  String get pairingEnterOneTimeCode => 'Saisissez le code à usage unique';

  @override
  String get pairingFindCodeHint =>
      'Votre code se trouve dans DJL sur ordinateur, sous Paramètres → À distance.';

  @override
  String get pairingCodeLabel => 'Code de jumelage';

  @override
  String get pairingRelayConfigured => 'Relais configuré';

  @override
  String get pairingRelaySettings => 'Paramètres du relais';

  @override
  String get pairingInProgress => 'Jumelage…';

  @override
  String get pairingPair => 'Jumeler';

  @override
  String get pairingSecureDetailsTitle => 'Détails du jumelage sécurisé';

  @override
  String get pairingSecureDetailsBody =>
      'Ouvrez DJL sur l’ordinateur → Paramètres → À distance. Collez son code de jumelage ou configurez le relais utilisé par votre code à usage unique.';

  @override
  String get pairingPasteCode => 'Coller le code de jumelage';

  @override
  String get pairingPayloadHint => 'RMX1:… ou JSON du QR code';

  @override
  String get pairingPairSecurely => 'Jumeler en toute sécurité';

  @override
  String get pairingRelayUrlLabel => 'URL du relais de l’ordinateur';

  @override
  String get pairingSwitchDeviceTitle => 'Changer d’appareil ?';

  @override
  String get pairingSwitchDeviceBody =>
      'DJL va tenter d’arrêter les exécutions en cours sur ce Mac et de recharger les discussions de l’autre appareil.';

  @override
  String get pairingSwitch => 'Changer';

  @override
  String get pairingCancellingSwitch => 'Annulation du changement…';

  @override
  String get pairingSwitchingDevice => 'Changement d’appareil…';

  @override
  String get pairingCancelSwitch => 'Annuler le changement';

  @override
  String get pairingChooseMatchingMac =>
      'Choisissez le Mac enregistré qui correspond à l’identité vérifiée de ce lien.';

  @override
  String get pairingChooseMacForLink =>
      'Choisissez un Mac enregistré pour ouvrir la discussion liée.';

  @override
  String get pairingOpeningLinkedConversation =>
      'Ouverture de la discussion liée sur l’ordinateur…';

  @override
  String get pairingRetryDesktopLink => 'Réessayer le lien';

  @override
  String get pairingCancelDesktopLink => 'Annuler le lien';

  @override
  String get pairingMatchesLinkIdentity =>
      'Correspond à l’identité vérifiée de ce lien';

  @override
  String get pairingDifferentIdentity => 'Identité d’ordinateur différente';

  @override
  String get pairingSavedVerifiedIdentity =>
      'Identité d’ordinateur enregistrée et vérifiée';

  @override
  String get pairingReconnect => 'Reconnecter';

  @override
  String get pairingConnections => 'Connexions';

  @override
  String get pairingScanQrCode => 'Scanner le QR code';

  @override
  String get pairingPairWithCode => 'Jumeler avec un code';

  @override
  String get pairingConnectToDesktop => 'Se connecter à DJL sur ordinateur';

  @override
  String get pairingChooseSavedMac => 'Choisir un Mac enregistré';

  @override
  String get pairingFirstPairingHint =>
      'Ouvrez DJL sur votre Mac ou votre PC Windows, puis allez dans Paramètres → À distance.';

  @override
  String get pairingGetDesktop => 'Obtenir DJL pour Mac ou PC';

  @override
  String get pairingScanTitle => 'Scanner le QR code de DJL';

  @override
  String get pairingCameraDenied =>
      'L’accès à l’appareil photo est refusé. Vous pouvez coller le code de jumelage à la place.';

  @override
  String get pairingScanUnsupported =>
      'Le scan de QR code n’est pas disponible sur cet appareil. Vous pouvez coller le code de jumelage à la place.';

  @override
  String get pairingCameraUnavailable =>
      'L’appareil photo n’est pas disponible. Vous pouvez coller le code de jumelage à la place.';

  @override
  String get pairingSwitchDevice => 'Changer d’appareil';

  @override
  String get pairingSwitchTo => 'Passer à';

  @override
  String get pairingStatusSwitching => 'Changement…';

  @override
  String get pairingStatusConnected => 'Connecté';

  @override
  String get pairingStatusSelected => 'Sélectionné';

  @override
  String get pairingStatusPrevious => 'Précédent';

  @override
  String get pairingStatusSaved => 'Enregistré';

  @override
  String get pairingForget => 'Oublier';

  @override
  String get pairingForgetDeviceTitle => 'Oublier cet appareil ?';

  @override
  String pairingForgetDeviceBody(String name) {
    return '$name sera retiré de ce téléphone. Scannez à nouveau son QR code pour vous reconnecter.';
  }

  @override
  String get pairingActiveBadge => 'Actif';

  @override
  String pairingShowInMenu(String name) {
    return 'Afficher $name dans le menu des appareils';
  }

  @override
  String get pairingMenuVisibilityUnavailable =>
      'Affichage dans le menu indisponible';

  @override
  String get pairingClose => 'Fermer';

  @override
  String get pairingActiveDevice => 'Appareil actif';

  @override
  String pairingActiveDeviceNamed(String name) {
    return 'Appareil actif, $name';
  }

  @override
  String pairingDevicesInMenu(int count) {
    return '$count appareils dans le menu';
  }

  @override
  String get pairingDevices => 'Appareils';

  @override
  String get pairingNoDevices => 'Aucun appareil jumelé pour l’instant.';

  @override
  String get pairingScanQr => 'Scanner un QR code';

  @override
  String get pairingForgetDesktop => 'Oublier l’ordinateur';

  @override
  String get pairingRecencyNow => 'à l’instant';

  @override
  String pairingRecencyMinutes(int count) {
    return '$count min';
  }

  @override
  String pairingRecencyHours(int count) {
    return '$count h';
  }

  @override
  String pairingRecencyDays(int count) {
    return '$count j';
  }

  @override
  String pairingRecencyAgo(String age) {
    return 'il y a $age';
  }

  @override
  String pairingRecencyIn(String age) {
    return 'dans $age';
  }

  @override
  String get chatUiCloseNavigation => 'Fermer la navigation';

  @override
  String get chatUiRuntime => 'Environnement';

  @override
  String get chatUiContinueIn => 'Continuer dans';

  @override
  String get chatUiLocal => 'Local';

  @override
  String get chatUiWorktree => 'Arbre de travail';

  @override
  String get chatUiCurrentBranch => 'Branche actuelle';

  @override
  String get chatUiCollapseProjectControls => 'Replier les options du projet';

  @override
  String get chatUiExpandProjectControls => 'Déplier les options du projet';

  @override
  String get chatUiQueuedMessages => 'Messages en attente';

  @override
  String get chatUiQueuedHint =>
      'Affiche les messages de suivi en attente dans une feuille';

  @override
  String get chatUiQueued => 'En attente';

  @override
  String get chatUiQueuedNeedsPlanModel =>
      'Choisissez un modèle compatible avec le mode planification avant de placer ce brouillon dans la zone de saisie.';

  @override
  String chatUiImageCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count images',
      one: '$count image',
    );
    return '$_temp0';
  }

  @override
  String get chatUiAttachedContext => 'Contexte joint';

  @override
  String get chatUiMoveDraftToInput =>
      'Placer le brouillon dans la zone de saisie';

  @override
  String get chatUiSteerQueued => 'Réorienter avec le message en attente';

  @override
  String get chatUiSteer => 'Réorienter';

  @override
  String get chatUiDeleteQueued => 'Supprimer le message en attente';

  @override
  String get chatUiCopyResponse => 'Copier la réponse';

  @override
  String get chatUiCopied => 'Copié';

  @override
  String get chatUiEffortLow => 'Faible';

  @override
  String get chatUiEffortMedium => 'Moyen';

  @override
  String get chatUiEffortHigh => 'Élevé';

  @override
  String get chatUiEffortExtraHigh => 'Très élevé';

  @override
  String get chatUiLoading => 'Chargement…';

  @override
  String get chatUiSelectModel => 'Choisir un modèle';

  @override
  String get chatUiModel => 'Modèle';

  @override
  String get chatUiSpeed => 'Vitesse';

  @override
  String get chatUiSpeedFast => 'Rapide';

  @override
  String get chatUiSpeedNormal => 'Normale';

  @override
  String get chatUiChatControls => 'Options de la discussion';

  @override
  String get chatUiControlsConnectionChanged =>
      'La connexion a changé. Rouvrez les options de la discussion.';

  @override
  String get chatUiLoadingModelsEllipsis => 'Chargement des modèles…';

  @override
  String get chatUiOtherModels => 'Autres modèles…';

  @override
  String get chatUiIntelligence => 'Intelligence';

  @override
  String get chatUiCopySessionId => 'Copier l’ID de session';

  @override
  String get chatUiRenameChat => 'Renommer la discussion';

  @override
  String get chatUiUnpinChat => 'Désépingler';

  @override
  String get chatUiPinChat => 'Épingler';

  @override
  String get chatUiUnarchiveChat => 'Désarchiver';

  @override
  String get chatUiArchiveChat => 'Archiver';

  @override
  String get chatUiRemoveFromDevice => 'Retirer de cet appareil';

  @override
  String get chatUiSessionIdCopied => 'ID de session copié.';

  @override
  String get chatUiRemoveChatTitle =>
      'Retirer cette discussion de cet appareil ?';

  @override
  String get chatUiRemoveChatBodyArchived =>
      'La discussion reste sur votre ordinateur. Les discussions des sous-agents sont archivées localement.';

  @override
  String get chatUiRemoveChatBody =>
      'La discussion reste sur votre ordinateur, où elle sera aussi archivée. Les discussions des sous-agents sont archivées localement.';

  @override
  String get chatUiRemoveChat => 'Retirer la discussion';

  @override
  String get chatUiChatName => 'Nom de la discussion';

  @override
  String get chatUiSaveName => 'Enregistrer le nom';

  @override
  String get chatUiCopyPathFailed =>
      'Impossible de copier le chemin. Réessayez.';

  @override
  String get chatUiConversationChanged => 'La discussion a changé';

  @override
  String get chatUiCloseLocation => 'Fermer l’emplacement';

  @override
  String get chatUiThreadLabel => 'Discussion';

  @override
  String get chatUiRenameConversation => 'Renommer la discussion';

  @override
  String get chatUiPathLabel => 'Chemin';

  @override
  String get chatUiPathCopied => 'Chemin copié';

  @override
  String get chatUiCopyPath => 'Copier le chemin';

  @override
  String get chatUiLocationStale =>
      'Fermez cette feuille et rouvrez l’emplacement de la discussion.';

  @override
  String get chatUiMoreThreadActions => 'Autres actions';

  @override
  String chatUiPreviousMessages(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count messages précédents',
      one: '$count message précédent',
    );
    return '$_temp0';
  }

  @override
  String chatUiMoreToolCalls(int count) {
    return '+$count appels d’outils';
  }

  @override
  String chatUiRanCommands(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count commandes exécutées',
      one: '$count commande exécutée',
    );
    return '$_temp0';
  }

  @override
  String chatUiCommandsFailed(int count) {
    return '$count en échec';
  }

  @override
  String chatUiCommandsStopped(int count) {
    return '$count arrêtées';
  }

  @override
  String get chatUiCollapsePreviousMessages =>
      'Replier les messages précédents';

  @override
  String get chatUiExpandPreviousMessages => 'Déplier les messages précédents';

  @override
  String get chatUiCollapseCommands => 'Replier les commandes';

  @override
  String get chatUiExpandCommands => 'Déplier les commandes';

  @override
  String get chatUiCollapseToolCalls => 'Replier les appels d’outils';

  @override
  String get chatUiExpandToolCalls => 'Déplier les appels d’outils';

  @override
  String get chatUiQuestions => 'Questions';

  @override
  String chatUiQuestionPage(int page, int total) {
    return '$page sur $total';
  }

  @override
  String get chatUiQuestionResponseUnknown =>
      'Une réponse précédente a peut-être été envoyée. Vérifiez l’état sur l’ordinateur avant de répondre à nouveau.';

  @override
  String get chatUiBack => 'Retour';

  @override
  String get chatUiQuestionClosing => 'Fermeture…';

  @override
  String get chatUiQuestionEsc => 'Échap';

  @override
  String get chatUiNext => 'Suivant';

  @override
  String get chatUiResponseSent => 'Réponse envoyée';

  @override
  String get chatUiSendingDots => 'Envoi…';

  @override
  String get chatUiSend => 'Envoyer';

  @override
  String chatUiSelectUpTo(int limit) {
    return 'Choisissez-en jusqu’à $limit';
  }

  @override
  String get chatUiOtherAnswer => 'Autre réponse';

  @override
  String get chatUiYourAnswer => 'Votre réponse';

  @override
  String get settingsFontSystem => 'Système';

  @override
  String get settingsUnlockReason =>
      'Déverrouillez DJL et vos sessions de code à distance.';

  @override
  String get settingsUsageWeekly => 'Hebdomadaire';

  @override
  String settingsUsageWeeks(int count) {
    return '$count sem.';
  }

  @override
  String settingsUsageDays(int count) {
    return '$count j';
  }

  @override
  String settingsUsageHours(int count) {
    return '$count h';
  }

  @override
  String settingsUsageMinutes(int count) {
    return '$count min';
  }

  @override
  String get settingsThemeSystem => 'Système';

  @override
  String get settingsThemeLight => 'Clair';

  @override
  String get settingsThemeDark => 'Sombre';

  @override
  String get settingsAppearance => 'Apparence';

  @override
  String get settingsFont => 'Police';

  @override
  String get settingsLiquidGlass => 'Liquid Glass';

  @override
  String get settingsTheme => 'Thème';

  @override
  String get settingsNotifications => 'Notifications';

  @override
  String get settingsInAppAlertsFooter =>
      'Afficher une bannière quand la tâche d’une autre discussion se termine.';

  @override
  String get settingsInAppAlerts => 'Alertes dans l’app';

  @override
  String get settingsVoice => 'Voix';

  @override
  String get settingsVoiceFooter =>
      'Relisez la dictée avant l’envoi. Les réponses utilisent la voix de votre appareil.';

  @override
  String get settingsSpeakReplies => 'Lire les nouvelles réponses à voix haute';

  @override
  String get settingsRetryReading => 'Recharger les paramètres';

  @override
  String get settingsErrorPartialSave =>
      'Certains paramètres par défaut ont peut-être été enregistrés en partie. Vérifiez les choix rechargés et réessayez.';

  @override
  String get settingsErrorPartialReload =>
      'Les paramètres par défaut ont peut-être été enregistrés en partie. Impossible de recharger les préférences. Rechargez d’abord les paramètres.';

  @override
  String get settingsErrorRead =>
      'Impossible de lire les paramètres enregistrés. Réessayez pour conserver vos préférences.';

  @override
  String get settingsErrorSave =>
      'Impossible d’enregistrer ce paramètre. Votre choix précédent est conservé. Réessayez.';

  @override
  String settingsUsageResets(String when) {
    return 'réinitialisation $when';
  }

  @override
  String get settingsUsage => 'Utilisation';

  @override
  String get settingsUsageFooter =>
      'Limites d’utilisation du compte, issues de votre appareil jumelé.';

  @override
  String get settingsUsageLoading => 'Chargement des limites actuelles…';

  @override
  String get settingsUsageConnect =>
      'Connectez votre appareil jumelé pour charger les limites actuelles.';

  @override
  String get settingsUsageUnavailable =>
      'Les limites d’utilisation ne sont pas disponibles pour ce compte.';

  @override
  String settingsUsageLeft(int percent) {
    return '$percent % restants';
  }

  @override
  String get settingsUsageStale =>
      'Dernières limites connues. Reconnectez-vous ou actualisez pour les mettre à jour.';

  @override
  String get settingsUsageRefreshTooltip => 'Actualiser l’utilisation';

  @override
  String get settingsUsageRefreshing => 'Actualisation…';

  @override
  String get settingsUsageRefresh => 'Actualiser';

  @override
  String get settingsUsageRuntimeUnavailable =>
      'Les limites d’utilisation ne sont pas disponibles pour cet environnement.';

  @override
  String get settingsUsageLoadFailed =>
      'Impossible de charger les limites actuelles. Réessayez.';

  @override
  String get settingsTitle => 'Paramètres';

  @override
  String get settingsOpenCloudChat => 'Ouvrir la discussion DJL Cloud';

  @override
  String get settingsSignInCloud => 'Se connecter à DJL Cloud';

  @override
  String get settingsCloudSubtitle =>
      'Discussions, images et tâches en arrière-plan, sans votre Mac';

  @override
  String get settingsDevicePermissions => 'Autorisations de l’appareil';

  @override
  String get settingsDevice => 'Appareil';

  @override
  String get settingsMyMacs => 'Mes Mac';

  @override
  String get settingsLocked => 'DJL est verrouillé';

  @override
  String get settingsPreparing => 'Préparation de DJL';

  @override
  String get settingsStartFailed => 'Impossible de démarrer DJL';

  @override
  String get settingsPrivateNote =>
      'Vos sessions à distance restent privées quand vous vous absentez.';

  @override
  String get settingsRetryStartup => 'Relancer le démarrage';

  @override
  String get settingsUnlockHint =>
      'Authentification par Face ID, Touch ID ou le code de votre appareil';

  @override
  String get settingsUnlocking => 'Déverrouillage…';

  @override
  String get settingsUnlock => 'Déverrouiller DJL';

  @override
  String get settingsLockSetup =>
      'Configurez Face ID, Touch ID ou un code d’appareil pour déverrouiller DJL.';

  @override
  String get settingsLockStillLocked =>
      'DJL est toujours verrouillé. Déverrouillez DJL pour continuer.';

  @override
  String get settingsLockCancelled =>
      'L’authentification a été annulée ou n’est pas disponible. Déverrouillez DJL pour continuer.';

  @override
  String get settingsBridgeUnknown => 'Inconnu';

  @override
  String get settingsBridgeInstalled => 'Installé';

  @override
  String get settingsBridgeUpToDate => 'À jour';

  @override
  String get settingsBridgeUpdateAvailable => 'Mise à jour disponible';

  @override
  String get settingsBridgeDifferentBuild => 'Autre build';

  @override
  String get settingsBridgeConnectHint =>
      'Connectez-vous à votre Mac pour voir sa version de DJL.';

  @override
  String get settingsBridgeStaleHint =>
      'Dernière version connue. Reconnectez-vous pour vérifier à nouveau.';

  @override
  String get settingsBridgeMatches =>
      'DJL sur votre Mac correspond à la dernière version.';

  @override
  String get settingsBridgeNewer =>
      'Une nouvelle version de DJL est disponible. Mettez à jour DJL sur votre Mac.';

  @override
  String get settingsBridgeDifferent =>
      'Votre Mac utilise un autre build que la dernière version.';

  @override
  String get settingsBridgeStatus => 'État';

  @override
  String settingsBridgeLastKnown(String status) {
    return 'Dernier état connu · $status';
  }

  @override
  String get settingsVersion => 'Version';

  @override
  String get settingsBridgeLatest => 'Dernière';

  @override
  String get settingsBridgeUpdate => 'Mettre à jour DJL sur votre Mac';

  @override
  String get settingsBridgeCheck => 'Rechercher une mise à jour de DJL';

  @override
  String settingsElapsedDays(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: '$days jours',
      one: '$days jour',
    );
    return '$_temp0';
  }

  @override
  String settingsElapsedHours(int hours, int minutes) {
    String _temp0 = intl.Intl.pluralLogic(
      hours,
      locale: localeName,
      other: '$hours h',
      one: '$hours h',
    );
    return '$_temp0 $minutes min';
  }

  @override
  String settingsElapsedMinutes(int minutes, int seconds) {
    return '$minutes min $seconds s';
  }

  @override
  String settingsElapsedSeconds(int seconds) {
    return '$seconds s';
  }

  @override
  String get settingsArchived => 'Archivées';

  @override
  String get settingsArchivedChats => 'Discussions archivées';

  @override
  String settingsArchivedSaved(int count) {
    return '$count enregistrées localement';
  }

  @override
  String get settingsArchivedActions => 'Actions sur les discussions archivées';

  @override
  String get settingsUnarchive => 'Désarchiver';

  @override
  String get settingsRemoveFromPhone => 'Retirer du téléphone';

  @override
  String get settingsRemove => 'Retirer';

  @override
  String get settingsNoArchived => 'Aucune discussion archivée';

  @override
  String settingsRemoveTitle(String title) {
    return 'Retirer « $title » de ce téléphone ?';
  }

  @override
  String get settingsRemoveBody =>
      'La discussion est seulement retirée de DJL sur ce téléphone. Rien n’est supprimé de votre ordinateur jumelé.';

  @override
  String get settingsCloudRefreshFailed =>
      'Impossible d’actualiser le compte et les paramètres Cloud.';

  @override
  String get settingsLinkFailed => 'Impossible d’ouvrir ce lien. Réessayez.';

  @override
  String get settingsOpenNotificationsFailed =>
      'Impossible d’ouvrir les réglages des notifications. Réessayez.';

  @override
  String get settingsAlertsUnavailable => 'Indisponible';

  @override
  String get settingsAlertsOff => 'Désactivées';

  @override
  String get settingsAlertsEnabled => 'Activées';

  @override
  String get settingsAlertsNotEnabled => 'Non activées';

  @override
  String get settingsBack => 'Retour';

  @override
  String get settingsOpenNavigation => 'Ouvrir la navigation';

  @override
  String get settingsRetry => 'Réessayer';

  @override
  String get settingsAccount => 'Compte';

  @override
  String get settingsDjlAccount => 'Compte DJL';

  @override
  String get settingsAvailableCredits => 'Crédits disponibles';

  @override
  String get settingsConversations => 'Discussions';

  @override
  String get settingsArchivedChatsRow => 'Discussions archivées';

  @override
  String get settingsRemoteAccess => 'Accès à distance';

  @override
  String get settingsBackgroundAlerts => 'Alertes en arrière-plan';

  @override
  String get settingsEnableBackgroundAlerts =>
      'Activer les alertes en arrière-plan';

  @override
  String get settingsOpenNotificationSettings =>
      'Ouvrir les réglages des notifications';

  @override
  String get settingsVoiceIos =>
      'La dictée reste sur votre iPhone. Relisez le texte avant l’envoi. Les réponses utilisent la voix de l’iPhone.';

  @override
  String get settingsVoiceDevice =>
      'La dictée reste sur votre appareil. Relisez le texte avant l’envoi. Les réponses utilisent la voix de votre appareil.';

  @override
  String get settingsAbout => 'À propos';

  @override
  String get settingsTerms => 'Conditions';

  @override
  String get settingsPrivacy => 'Confidentialité';

  @override
  String get settingsRetryLocalPrefs => 'Recharger les préférences locales';

  @override
  String get settingsDeviceNameOnPhone => 'Nom de l’appareil sur ce téléphone';

  @override
  String get settingsEditDeviceNameTooltip => 'Modifier le nom de l’appareil';

  @override
  String get settingsClose => 'Fermer';

  @override
  String get settingsEditDeviceNameTitle => 'Modifier le nom de l’appareil';

  @override
  String get settingsDeviceName => 'Nom de l’appareil';

  @override
  String get settingsNicknameNote =>
      'Ce nom reste sur ce téléphone et s’affiche partout où cet appareil apparaît.';

  @override
  String get settingsDeviceChanged =>
      'Cet appareil enregistré a changé. Fermez puis rouvrez l’éditeur.';

  @override
  String get settingsUseDefault => 'Nom par défaut';

  @override
  String get settingsSave => 'Enregistrer';

  @override
  String get settingsAboutFooter =>
      'Les discussions sont chiffrées de bout en bout entre votre téléphone et l’appareil jumelé.';

  @override
  String get settingsHowDjlWorks => 'Fonctionnement de DJL';

  @override
  String get settingsChatSupport => 'Discussion et assistance';

  @override
  String get settingsPrivacyPolicy => 'Politique de confidentialité';

  @override
  String get settingsTermsOfUse => 'Conditions d’utilisation';

  @override
  String get settingsAboutRouteBridgeDevice =>
      'Passerelle sur votre appareil jumelé';

  @override
  String get settingsAboutRouteBridge => 'Passerelle';

  @override
  String settingsAboutRouteLabel(String from, String to, String via) {
    return '$from vers $to via $via';
  }

  @override
  String get settingsAboutIntro => 'Pilotez **Codex** depuis votre téléphone.';

  @override
  String get settingsAboutIntroNote =>
      'L’environnement Codex reste sur votre appareil jumelé. Votre téléphone sert de télécommande sécurisée, connectée via un relais.';

  @override
  String get settingsAboutHowItWorks => 'Fonctionnement';

  @override
  String get settingsAboutBridge =>
      'Votre appareil jumelé exécute une **passerelle** légère qui se connecte à un **serveur relais** via WebSocket.';

  @override
  String get settingsAboutStep1 =>
      'Vous envoyez une requête depuis votre téléphone.';

  @override
  String get settingsAboutStep2 =>
      'Elle passe par le relais jusqu’à la passerelle de votre appareil jumelé.';

  @override
  String get settingsAboutStep3 =>
      'La passerelle la transmet à `codex app-server` via JSON-RPC.';

  @override
  String get settingsAboutStep4 =>
      'Les réponses reviennent par le même chemin, en temps réel.';

  @override
  String get settingsAboutWorkspaceNote =>
      'Les outils de l’espace de travail et les modifications de fichiers s’exécutent sur votre appareil jumelé. Le relais achemine le trafic chiffré ; il n’exécute pas votre espace de travail.';

  @override
  String get settingsAboutArchitecture => 'Architecture';

  @override
  String get settingsAboutRelay => 'Le relais';

  @override
  String get settingsAboutRelayIntro =>
      'Un serveur WebSocket léger achemine les messages entre votre téléphone et l’appareil jumelé.';

  @override
  String get settingsAboutRelayDiscovery =>
      'Il gère la découverte des sessions pour que votre téléphone trouve la session active de l’appareil.';

  @override
  String get settingsAboutRelayPrivate =>
      'Il ne voit jamais le contenu déchiffré des messages après l’échange sécurisé.';

  @override
  String get settingsAboutRelayMetadata =>
      'Il voit les métadonnées de connexion, comme les ID de session, les ID d’appareil et les horaires.';

  @override
  String get settingsAboutRelaySelfHost =>
      'Vous pouvez **héberger vous-même** le relais ou utiliser le point d’accès hébergé configuré par votre passerelle.';

  @override
  String get settingsAboutAppServerIntro =>
      'Pour l’environnement Codex, la passerelle se connecte à **`codex app-server`**, l’interface JSON-RPC utilisée par les clients Codex.';

  @override
  String get settingsAboutAppServerSessions =>
      'Les discussions sur téléphone sont des sessions Codex à part entière.';

  @override
  String get settingsAboutAppServerRollout =>
      'Codex produit des fichiers de rollout JSONL dans `~/.codex/sessions/`.';

  @override
  String get settingsAboutAppServerHandoff =>
      'Utilisez l’action de transfert vers l’ordinateur de DJL pour poursuivre une discussion du téléphone sur l’appareil jumelé.';

  @override
  String get settingsAboutPairing => 'Jumelage et sécurité';

  @override
  String get settingsAboutPairingQr =>
      'Lors de la première connexion, scannez le **QR code** de la passerelle. Il identifie le relais, la session, l’appareil jumelé et la clé publique d’identité de la passerelle.';

  @override
  String get settingsAboutPairingAfter => 'Après l’échange sécurisé :';

  @override
  String get settingsAboutPairingTrusted =>
      'Votre téléphone enregistre la passerelle comme **appareil de confiance** dans le stockage sécurisé du système.';

  @override
  String get settingsAboutPairingIdentity =>
      'La passerelle conserve localement l’identité de votre téléphone.';

  @override
  String get settingsAboutPairingReconnect =>
      'Les appareils de confiance enregistrés peuvent se reconnecter sans nouveau scan.';

  @override
  String get settingsAboutPairingRecovery =>
      'Le QR code reste une solution de secours si la confiance change ou si la session actuelle est introuvable. Un code à usage unique permet aussi de jumeler quand le même relais est configuré.';

  @override
  String get settingsAboutEncryption => 'Chiffrement de bout en bout';

  @override
  String get settingsAboutEncryptionIntro =>
      'Après le jumelage, les messages sont envoyés dans des enveloppes chiffrées.';

  @override
  String get settingsAboutCipher => 'Chiffrement';

  @override
  String get settingsAboutKeyDerivation => 'Dérivation de clés';

  @override
  String get settingsAboutKeyDerivationValue => 'HKDF-SHA256, une clé par sens';

  @override
  String get settingsAboutKeyExchange => 'Échange de clés';

  @override
  String get settingsAboutKeyExchangeValue => 'Clés éphémères X25519';

  @override
  String get settingsAboutIdentity => 'Identité';

  @override
  String get settingsAboutIdentityValue => 'Signatures Ed25519';

  @override
  String get settingsAboutReplayProtection => 'Protection contre le rejeu';

  @override
  String get settingsAboutReplayProtectionValue => 'Compteurs monotones';

  @override
  String get settingsAboutCacheKey => 'Clé du cache du téléphone';

  @override
  String get settingsAboutCacheKeyValue =>
      'Protégée par le stockage sécurisé du système';

  @override
  String get settingsAboutEncryptionNote =>
      'Ceci décrit le **mode appareil jumelé**. DJL Cloud est un service distinct, avec son propre compte.';

  @override
  String get settingsAboutGit => 'Git et espace de travail';

  @override
  String get settingsAboutGitIntro =>
      'La passerelle exécute les commandes Git localement sur l’appareil jumelé :';

  @override
  String get settingsAboutGitRevert =>
      'DJL permet aussi d’**annuler dans l’espace de travail** : prévisualisez et appliquez des patchs inverses pour annuler les modifications de l’assistant. Lisez la confirmation avant d’appliquer les modifications.';

  @override
  String get settingsAboutResilience => 'Résilience de la connexion';

  @override
  String get settingsAboutReconnect =>
      'La reconnexion automatique utilise un délai d’attente progressif et plafonné.';

  @override
  String get settingsAboutReplay =>
      'Des curseurs de reprise chiffrés aident à récupérer les événements manqués. Les actions incertaines ne sont pas renvoyées en silence après une déconnexion.';

  @override
  String get settingsAboutRuntimeDrop =>
      'L’environnement peut continuer à travailler pendant une brève coupure de connexion du téléphone.';

  @override
  String get settingsAboutShutdown =>
      'La passerelle s’arrête proprement sur `SIGINT` et `SIGTERM`.';

  @override
  String get settingsAboutDesktop => 'Intégration à l’app pour ordinateur';

  @override
  String get settingsAboutDesktopRollout =>
      'Codex enregistre les discussions du téléphone sous forme de fichiers de rollout sur l’appareil jumelé.';

  @override
  String get settingsAboutDesktopHandoff =>
      'L’app pour ordinateur ne recharge pas toujours en direct les écritures externes. Utilisez **Continuer sur l’ordinateur** dans DJL pour transférer la discussion en cours.';

  @override
  String get settingsAboutDjl => 'À propos de DJL';

  @override
  String get settingsOpenSource => 'Open source';

  @override
  String get settingsMitLicense => 'Licence MIT';

  @override
  String get hostYourMac => 'Votre Mac';

  @override
  String get hostUpdating =>
      'DJL se met à jour sur votre Mac. Ce téléphone se reconnectera dès son retour.';

  @override
  String get hostCheckingVersion =>
      'Vérification de la version de DJL sur votre Mac…';

  @override
  String hostNowVersion(String version) {
    return 'DJL est maintenant en version $version sur votre Mac.';
  }

  @override
  String hostStillVersion(String version) {
    return 'DJL est toujours en version $version sur votre Mac. Il est peut-être déjà à jour.';
  }

  @override
  String get hostConnectedFooter =>
      'Vos discussions vont directement à DJL sur votre Mac, chiffrées de bout en bout.';

  @override
  String get hostReconnectFooter =>
      'Ouvrez DJL sur votre Mac pour vous reconnecter.';

  @override
  String get hostDjlVersion => 'Version de DJL';

  @override
  String get hostCheckFailedNow =>
      'Impossible de vérifier votre Mac pour le moment.';

  @override
  String get hostReconnecting => 'Reconnexion…';

  @override
  String get hostWakeScreen => 'Réveiller l’écran';

  @override
  String get hostWakeScreenDetail =>
      'Allume l’écran de votre Mac pendant que DJL fonctionne.';

  @override
  String get hostKeepAwake => 'Garder le Mac éveillé';

  @override
  String get hostKeepAwakeDetail =>
      'Empêche votre Mac de se mettre en veille tant que DJL est ouvert. Idéal quand il est en charge.';

  @override
  String get hostUpdates => 'Mises à jour';

  @override
  String get hostUpdateDjl => 'Mettre à jour DJL';

  @override
  String get hostUpdateDjlDetail =>
      'Installe la dernière version de DJL sur votre Mac, puis se reconnecte.';

  @override
  String get hostNotConnected => 'Non connecté';

  @override
  String get hostConnectedChecking => 'Connecté · vérification';

  @override
  String get hostConnected => 'Connecté';

  @override
  String hostStatusLabel(String status) {
    return 'DJL sur votre Mac, $status';
  }

  @override
  String get hostDjlOnYourMac => 'DJL sur votre Mac';

  @override
  String get hostUpdateTitle => 'Mettre à jour DJL sur votre Mac ?';

  @override
  String hostUpdateCurrent(String version) {
    return 'Votre Mac a DJL $version.';
  }

  @override
  String get hostUpdateBody =>
      'DJL redémarre sur votre Mac pour installer la dernière version. Ce téléphone se déconnecte un instant, puis se reconnecte tout seul.';

  @override
  String get hostUpdate => 'Mettre à jour';

  @override
  String get hostContinueOnDesktop => 'Continuer sur l’ordinateur';

  @override
  String get hostContinueTitle => 'Continuer sur l’ordinateur ?';

  @override
  String get hostContinueBody =>
      'Ouvrir cette discussion dans DJL sur votre Mac.';

  @override
  String get hostContinue => 'Continuer';

  @override
  String get hostActionFinished => 'Action terminée.';

  @override
  String get hostErrorUnsupported =>
      'DJL sur votre Mac ne peut pas encore faire cela. Mettez à jour DJL sur votre Mac.';

  @override
  String get hostErrorRefused =>
      'Votre Mac a refusé. Vérifiez DJL sur votre Mac et réessayez.';

  @override
  String get hostErrorUncertain =>
      'Impossible de savoir si cela a fonctionné. Vérifiez votre Mac avant de réessayer.';

  @override
  String get hostCheckFailed => 'Impossible de vérifier votre Mac. Réessayez.';

  @override
  String get hostCheckingFirst =>
      'Vérification de votre Mac en cours. Réessayez dans un instant.';

  @override
  String get hostConnectFirst => 'Connectez-vous d’abord à votre Mac.';

  @override
  String get hostNotConfirmed =>
      'Votre Mac n’a pas confirmé. Vérifiez-le avant de réessayer.';

  @override
  String get hostOpenedOnMac => 'Ouvert dans DJL sur votre Mac.';

  @override
  String get hostReconnectFirst => 'Reconnectez-vous d’abord à votre Mac.';

  @override
  String get hostReachFailed =>
      'Impossible de joindre DJL sur votre Mac. Vérifiez qu’il est ouvert, puis réessayez.';

  @override
  String get hostWaking => 'L’écran de votre Mac se réveille.';

  @override
  String get hostPrefReadFailed =>
      'Impossible de lire la préférence enregistrée. Réessayez.';

  @override
  String get hostPrefSaveFailed =>
      'Impossible d’enregistrer cette préférence. Votre choix précédent est conservé. Réessayez.';

  @override
  String get hostPrefUnconfirmed =>
      'Enregistré sur ce téléphone, mais votre Mac ne l’a pas encore confirmé.';

  @override
  String get pushTitle => 'Notifications push';

  @override
  String get pushUnsupported =>
      'Ce téléphone ne peut pas encore recevoir de notifications push de DJL. Ouvrez DJL pour voir quand un agent a terminé.';

  @override
  String get pushDenied =>
      'Les notifications de DJL sont désactivées dans les Réglages de votre téléphone.';

  @override
  String get pushReady =>
      'Recevez une notification quand un agent a terminé ou attend votre réponse.';

  @override
  String get pushSimulator =>
      'Ce simulateur ne peut pas recevoir de notifications push.';

  @override
  String get pushUnavailableVersion =>
      'Les notifications push ne sont pas disponibles dans cette version.';

  @override
  String get pushFailed =>
      'Impossible d’activer les notifications. Réessayez une fois en ligne.';

  @override
  String get pushUnavailableNow =>
      'Les notifications push ne sont pas disponibles pour le moment.';

  @override
  String get pushReadFailed =>
      'Impossible de lire la préférence de notification. Réessayez.';

  @override
  String get pushUpdateFailed =>
      'Impossible de modifier la préférence de notification. Réessayez.';

  @override
  String get whatsNewTitle => 'Nouveautés';

  @override
  String get whatsNewIntro => 'Voici les nouveautés de DJL.';

  @override
  String get whatsNewOnce =>
      'Ce message ne s’affiche qu’une fois par version de l’app.';

  @override
  String get whatsNewGotIt => 'Compris';

  @override
  String get whatsNewDismiss => 'Fermer les nouveautés';

  @override
  String get whatsNew100Design => 'Un design noir et blanc plus apaisé.';

  @override
  String get whatsNew100Groups =>
      'Discussions de groupe : parlez à plusieurs agents à la fois et suivez leurs réponses en direct.';

  @override
  String get whatsNew100Files =>
      'Envoyez des fichiers et des photos dans une discussion de groupe.';

  @override
  String get whatsNew100Mac =>
      'Les discussions vont directement à DJL sur votre Mac.';

  @override
  String get accountSomethingWrong => 'Un problème est survenu';

  @override
  String get accountTypeDeleteToConfirm => 'Saisissez DELETE pour confirmer.';

  @override
  String get accountOk => 'OK';

  @override
  String get accountDone => 'OK';

  @override
  String get accountEmail => 'E-mail';

  @override
  String get accountPlan => 'Forfait';

  @override
  String get accountCredits => 'Crédits';

  @override
  String get accountUsageFooter =>
      'Une réinitialisation en réserve remet les deux limites à zéro et relance votre semaine. Les réserves expirent 90 jours après leur attribution.';

  @override
  String get accountFiveHourLimit => 'Limite sur 5 heures';

  @override
  String get accountWeeklyLimit => 'Limite hebdomadaire';

  @override
  String get accountBankedResets => 'Réinitialisations en réserve';

  @override
  String accountNextExpires(String date, String year) {
    return 'Prochaine expiration : $date $year';
  }

  @override
  String get accountNone => 'Aucune';

  @override
  String accountUseOne(int count) {
    return 'En utiliser 1 sur $count';
  }

  @override
  String get accountDeleteFooter =>
      'La suppression de votre compte efface vos discussions, fichiers et crédits. Vous avez 30 jours pour changer d’avis en contactant l’assistance.';

  @override
  String get accountSignOut => 'Se déconnecter';

  @override
  String get accountDelete => 'Supprimer le compte';

  @override
  String accountUsedPercent(int percent) {
    return '$percent % utilisés';
  }

  @override
  String get accountResetsNow => 'Réinitialisation maintenant';

  @override
  String get accountResetsTomorrow => 'Réinitialisation demain';

  @override
  String get accountResetsYesterday => 'Réinitialisé hier';

  @override
  String get accountResetsNextWeek => 'Réinitialisation la semaine prochaine';

  @override
  String get accountResetsLastWeek => 'Réinitialisé la semaine dernière';

  @override
  String accountResetsIn(String quantity) {
    return 'Réinitialisation dans $quantity';
  }

  @override
  String accountResetsAgo(String quantity) {
    return 'Réinitialisé il y a $quantity';
  }

  @override
  String accountSeconds(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count secondes',
      one: '$count seconde',
    );
    return '$_temp0';
  }

  @override
  String accountMinutes(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count minutes',
      one: '$count minute',
    );
    return '$_temp0';
  }

  @override
  String accountHours(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count heures',
      one: '$count heure',
    );
    return '$_temp0';
  }

  @override
  String accountDays(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count jours',
      one: '$count jour',
    );
    return '$_temp0';
  }

  @override
  String accountWeeks(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count semaines',
      one: '$count semaine',
    );
    return '$_temp0';
  }

  @override
  String get accountDeleteTitle => 'Supprimer votre compte ?';

  @override
  String get accountDeleteBody =>
      'Cette action est irréversible au-delà de 30 jours. Saisissez DELETE pour confirmer.';

  @override
  String get accountTypeDelete => 'Saisissez DELETE';

  @override
  String get accountSignOutTitle => 'Se déconnecter de DJL Cloud ?';

  @override
  String get notificationsTitle => 'Notifications';

  @override
  String get notificationsMarkAllRead => 'Tout marquer comme lu';

  @override
  String get notificationsCaughtUp => 'Vous êtes à jour';

  @override
  String get notificationsEmptyHint => 'Les tâches terminées apparaîtront ici.';

  @override
  String get notificationsTaskComplete => 'Tâche terminée';

  @override
  String get notificationsLoadMore => 'Afficher plus';

  @override
  String notificationsStatus(String status) {
    String _temp0 = intl.Intl.selectLogic(status, {
      'succeeded': 'réussie',
      'failed': 'en échec',
      'other': '$status',
    });
    return '$_temp0';
  }

  @override
  String get notificationsTaskStopped => 'Tâche arrêtée';

  @override
  String get notificationsTaskFinished => 'Tâche terminée';

  @override
  String get notificationsOpenResult => 'Ouvrez DJL pour voir le résultat';

  @override
  String get notificationsDismiss => 'Ignorer la notification';

  @override
  String get reportOffensive => 'Offensant ou haineux';

  @override
  String get reportHarmful => 'Nuisible ou dangereux';

  @override
  String get reportWrong => 'Faux ou trompeur';

  @override
  String get reportOther => 'Autre chose';

  @override
  String get reportThanks => 'Merci. Nous allons examiner cette réponse.';

  @override
  String get reportTitle => 'Signaler cette réponse';

  @override
  String get reportRateLimited =>
      'Trop de signalements pour le moment. Réessayez plus tard.';

  @override
  String get reportFailed => 'Impossible d’envoyer le signalement. Réessayez.';

  @override
  String get reportIntro =>
      'DJL examine les signalements pour garantir des réponses sûres. Quel est le problème ?';

  @override
  String get reportDetailsHint => 'Ajouter des détails (facultatif)';

  @override
  String get reportSending => 'Envoi…';

  @override
  String get reportSend => 'Envoyer le signalement';

  @override
  String get attachmentsNoApp =>
      'Aucune app ne peut ouvrir ce fichier ici. Choisissez-en une à laquelle l’envoyer.';

  @override
  String get attachmentsOpenFailed => 'Impossible d’ouvrir ce fichier';

  @override
  String get attachmentsCheckMac =>
      'Vérifiez que votre Mac est connecté, puis réessayez.';

  @override
  String get attachmentsImageUnshowable =>
      'Impossible d’afficher cette image ici';

  @override
  String get attachmentsOpenElsewhere => 'Ouvrir dans une autre app';

  @override
  String get attachmentsOpen => 'Ouvrir';

  @override
  String get attachmentsShare => 'Partager';

  @override
  String get imagesSquare => 'Carré';

  @override
  String get imagesLandscape => 'Paysage';

  @override
  String get imagesPortrait => 'Portrait';

  @override
  String get imagesOnePerRequest =>
      'Une image par demande. Vous pouvez quitter la discussion pendant que DJL travaille.';

  @override
  String get imagesCreate => 'Créer une image';

  @override
  String get imagesMakeYours => 'Créez quelque chose qui vous ressemble.';

  @override
  String get imagesDescribe =>
      'Décrivez le sujet, le style et les détails que vous imaginez.';

  @override
  String get imagesPromptHint =>
      'Un atelier paisible dans la lumière du matin…';

  @override
  String get imagesShape => 'Format';

  @override
  String get imagesNotConfigured =>
      'La génération d’images n’est pas encore configurée sur ce serveur. Vos images enregistrées restent disponibles.';

  @override
  String get imagesStarting => 'Démarrage…';

  @override
  String get imagesOpenImage => 'Ouvrir l’image';

  @override
  String get imagesGenerated => 'Image générée';

  @override
  String get imagesOpenChat => 'Ouvrir la discussion';

  @override
  String get imagesActions => 'Actions sur l’image';

  @override
  String get imagesEditInChat => 'Modifier dans la discussion';

  @override
  String get imagesTitle => 'Images';

  @override
  String get imagesYourImages => 'Vos images';

  @override
  String get imagesEmpty =>
      'Créez une image : elle apparaîtra ici, prête à être enregistrée ou partagée.';

  @override
  String get imagesEmptyNotConfigured =>
      'La création d’images n’est pas encore configurée. Les images enregistrées apparaîtront ici.';

  @override
  String get imagesLoadMore => 'Afficher plus';

  @override
  String get imagesYourImage => 'Votre image';

  @override
  String get imagesShare => 'Partager';

  @override
  String get imagesSaveToPhotos => 'Enregistrer dans Photos';

  @override
  String get imagesSaved => 'Enregistrée dans Photos.';

  @override
  String get authSocialNotConfigured =>
      'La connexion n’est pas configurée pour cette app. Continuez avec votre e-mail.';

  @override
  String get authSocialOpenFailed =>
      'Impossible d’ouvrir la connexion. Réessayez.';

  @override
  String get authSignInOptionsFailed =>
      'Impossible de charger les options de connexion.';

  @override
  String get authCloudSignInFailed =>
      'Impossible de se connecter à DJL Cloud. Réessayez.';

  @override
  String get authSecureStorageFailed =>
      'Impossible d’ouvrir le stockage sécurisé. Déverrouillez votre appareil et réessayez.';

  @override
  String get authCheckEmailForCode =>
      'Consultez vos e-mails pour obtenir un code de vérification.';

  @override
  String get authRequestSent => 'Demande envoyée. Consultez vos e-mails.';

  @override
  String get authCloudDataNotCleared =>
      'Certaines données Cloud enregistrées n’ont pas pu être effacées.';

  @override
  String get authLinkOpenFailed => 'Impossible d’ouvrir ce lien. Réessayez.';

  @override
  String get authWelcomeTitle => 'Bienvenue dans DJL';

  @override
  String get authWelcomeSubtitle =>
      'Vos idées, vos discussions et votre Mac.\nRéunis dans DJL.';

  @override
  String get authRetrySignInOptions => 'Recharger les options de connexion';

  @override
  String get authLoadingSignInOptions => 'Chargement des options de connexion';

  @override
  String get authContinueWithApple => 'Continuer avec Apple';

  @override
  String get authContinueWithGoogle => 'Continuer avec Google';

  @override
  String get authContinueWithEmail => 'Continuer avec un e-mail';

  @override
  String get authPairWithMac => 'Jumeler avec un Mac';

  @override
  String get authNoMacHint =>
      'Pas de Mac ? Connectez-vous pour discuter avec DJL Cloud.';

  @override
  String get authTerms => 'Conditions';

  @override
  String get authPrivacy => 'Confidentialité';

  @override
  String get authVerifyAndContinue => 'Vérifier et continuer';

  @override
  String get authSignIn => 'Se connecter';

  @override
  String get authEmailMeCode => 'Recevoir un code par e-mail';

  @override
  String get authCreateAccount => 'Créer un compte';

  @override
  String get authSignInIncomplete =>
      'Impossible de finaliser la connexion. Réessayez.';

  @override
  String get authPassword => 'Mot de passe';

  @override
  String get authEmailCode => 'Code par e-mail';

  @override
  String get authName => 'Nom';

  @override
  String get authEmail => 'E-mail';

  @override
  String get authSixDigitCode => 'Code à 6 chiffres';

  @override
  String authCodeSent(String email) {
    return 'Nous avons envoyé un code à $email. Il expire dans 10 minutes.';
  }

  @override
  String get authCreateAccountHint =>
      'Au moins 10 caractères. Nous vous enverrons un code par e-mail pour confirmer votre adresse.';

  @override
  String get authResendCode => 'Renvoyer le code';

  @override
  String authResendIn(int seconds) {
    return 'Renvoyer dans $seconds s';
  }

  @override
  String get authUseAnotherEmail => 'Utiliser une autre adresse';

  @override
  String get authForgotPassword => 'Mot de passe oublié ?';

  @override
  String get authResetPassword => 'Réinitialiser le mot de passe';

  @override
  String get authPasswordUpdated => 'Mot de passe mis à jour';

  @override
  String get authSignInWithNewPassword =>
      'Connectez-vous avec votre nouveau mot de passe.';

  @override
  String get authBackToSignIn => 'Retour à la connexion';

  @override
  String get authNewPassword => 'Nouveau mot de passe';

  @override
  String get authRecoveryHint =>
      'Nous enverrons un code de récupération si un compte existe pour cette adresse.';

  @override
  String get authRecoveryCodeHint =>
      'Saisissez votre code de récupération et un mot de passe de 10 à 256 caractères.';

  @override
  String get authSendRecoveryCode => 'Envoyer le code de récupération';

  @override
  String get chatUiWorktreeHandoffFailed =>
      'Échec du transfert vers l’arbre de travail';

  @override
  String get chatUiOk => 'OK';

  @override
  String get chatUiSelectFolder => 'Choisir un dossier';

  @override
  String get chatUiBrowseFolders => 'Parcourir les dossiers locaux…';

  @override
  String get chatUiBranchOpenElsewhere => 'Branche déjà ouverte ailleurs';

  @override
  String chatUiBranchOpenElsewhereChat(String branch) {
    return '« $branch » est déjà extraite dans un autre arbre de travail. Ouvrez cette discussion pour y continuer.';
  }

  @override
  String chatUiBranchOpenElsewhereSidebar(String branch) {
    return '« $branch » est déjà extraite dans un autre arbre de travail. Ouvrez cette discussion depuis la barre latérale pour y continuer.';
  }

  @override
  String get chatUiOpenChat => 'Ouvrir la discussion';

  @override
  String get chatUiWorktreeChatGone =>
      'La discussion de l’arbre de travail n’est plus disponible. Ouvrez-la depuis la barre latérale.';

  @override
  String get chatUiPhotoLibrary => 'Photothèque';

  @override
  String get chatUiTakePhoto => 'Prendre une photo';

  @override
  String get chatUiPlanMode => 'Mode planification';

  @override
  String get chatUiFastMode => 'Mode rapide';

  @override
  String get chatUiImage => 'Image';

  @override
  String get chatUiOpensThreadLocation =>
      'Ouvre l’emplacement de la discussion';

  @override
  String get chatUiDesktopChat => 'Discussion sur l’ordinateur';

  @override
  String get chatUiNewThread => 'Nouvelle discussion';

  @override
  String get chatUiHandOffToDesktop => 'Transférer vers l’ordinateur';

  @override
  String get chatUiHandOffToLocal => 'Transférer en local';

  @override
  String get chatUiHandOffToWorktree => 'Transférer vers un arbre de travail';

  @override
  String get chatUiGoal => 'Objectif';

  @override
  String get chatUiForkChat => 'Dupliquer cette discussion';

  @override
  String get chatUiForkIntoFolder => 'Dupliquer dans un autre dossier';

  @override
  String get chatUiForkIntoWorktree =>
      'Dupliquer dans un nouvel arbre de travail';

  @override
  String get chatUiWorkspaceFiles => 'Fichiers de l’espace de travail';

  @override
  String get chatUiTurnChanges => 'Modifications par tour et restauration';

  @override
  String get chatUiRefreshFromDesktop => 'Actualiser depuis l’ordinateur';

  @override
  String get chatUiDesktopDisconnected =>
      'Ordinateur déconnecté. Votre message n’a pas été renvoyé.';

  @override
  String get chatUiLinkedPositionUnavailable =>
      'La position liée n’est pas disponible dans l’historique chargé.';

  @override
  String get chatUiReviewResponseChanges =>
      'Examiner les modifications exactes de la réponse';

  @override
  String get chatUiResponseUndone => 'Réponse annulée';

  @override
  String get chatUiUndoResponse => 'Annuler cette réponse';

  @override
  String get chatUiApprovalRequired => 'Approbation requise';

  @override
  String get chatUiApprovalSent =>
      'Réponse envoyée. En attente de l’ordinateur.';

  @override
  String get chatUiDecline => 'Refuser';

  @override
  String get chatUiApproveOnce => 'Approuver une fois';

  @override
  String get chatUiBranch => 'Branche';

  @override
  String get chatUiPreparingWorktree => 'Préparation de l’arbre de travail…';

  @override
  String get chatUiNewWorktree => 'Nouvel arbre de travail';

  @override
  String chatUiGoalChip(String status, String elapsed) {
    return 'Objectif $status · $elapsed';
  }

  @override
  String get chatUiReturnToParent => 'Revenir à la discussion parente';

  @override
  String chatUiReturnTo(String title) {
    return 'Revenir à $title';
  }

  @override
  String get chatUiAskDjl => 'Demander à DJL';

  @override
  String get chatUiFollowUp => 'Poursuivre';

  @override
  String get workspaceRestoreFailed =>
      'L’ordinateur n’a pas confirmé la restauration. Actualisez avant de réessayer.';

  @override
  String workspaceRestoredFiles(int count) {
    return '$count fichiers restaurés.';
  }

  @override
  String get workspaceBackupSaved =>
      ' Un point de sauvegarde a été enregistré sur votre Mac.';

  @override
  String get workspaceNoLocalFolders =>
      'Aucun dossier local n’est disponible sur cet appareil.';

  @override
  String get workspaceUndoReviewChanged =>
      'La réponse ou la connexion a changé. Rouvrez cet aperçu.';

  @override
  String get workspaceUndoPreviewFailed =>
      'Impossible de prévisualiser le patch exact. Actualisez l’aperçu avant de réessayer.';

  @override
  String get workspaceUndoRepositoryChanged =>
      'La réponse ou le dépôt a changé. Rouvrez cet aperçu.';

  @override
  String get workspaceUndoResultUnknownChanged =>
      'La connexion ou la réponse a changé. Le résultat de l’annulation est inconnu ; actualisez et vérifiez-le.';

  @override
  String get workspaceUndoRefused =>
      'L’ordinateur n’a pas annulé la réponse. Vérifiez les conflits actuels et les fichiers indexés.';

  @override
  String get workspaceUndoResultUnknown =>
      'Le résultat de l’annulation est inconnu. Actualisez et vérifiez le patch exact avant une nouvelle tentative.';

  @override
  String get workspaceUndoSaveAfterSuccessFailed =>
      'L’annulation a réussi, mais l’enregistrement ou l’actualisation du résultat local a échoué. Reconnectez-vous pour vérifier les fichiers.';

  @override
  String get workspaceUndoSaveFailed =>
      'Impossible d’enregistrer le résultat de l’annulation. Reconnectez-vous et vérifiez les fichiers actuels.';

  @override
  String get workspaceUndoTitle => 'Annuler cette réponse';

  @override
  String workspaceUndoWorkspace(String path) {
    return 'Espace de travail : $path';
  }

  @override
  String get workspaceUndoIntro =>
      'Examinez les modifications exactes de cette réponse. Les modifications ultérieures sont conservées là où le patch inverse peut s’appliquer. L’ordinateur vérifie à nouveau les conflits quand vous confirmez.';

  @override
  String get workspaceUndoOverlap =>
      'D’autres réponses touchent ces fichiers. Vérifiez attentivement : l’annulation peut chevaucher des modifications de cette discussion ou d’une autre.';

  @override
  String get workspaceUndoUncertain =>
      'Le résultat d’une annulation précédente est inconnu. Actualisez cet aperçu et examinez les fichiers actuels avant de confirmer une nouvelle tentative.';

  @override
  String get workspaceUndoStale =>
      'Cet aperçu n’est plus à jour. Fermez-le et rouvrez la réponse.';

  @override
  String get workspaceUndoDone => 'Cette réponse a été annulée.';

  @override
  String workspaceUndoStagedBlock(String files) {
    return 'Des fichiers indexés bloquent l’annulation : $files';
  }

  @override
  String workspaceUndoConflict(String conflict) {
    return 'Conflit : $conflict';
  }

  @override
  String get workspaceUndoCannotReverse =>
      'L’ordinateur ne peut pas inverser ce patch sans risque.';

  @override
  String get workspaceClose => 'Fermer';

  @override
  String get workspaceRefreshReview => 'Actualiser l’aperçu';

  @override
  String get workspaceUndoResponse => 'Annuler la réponse';

  @override
  String get workspaceConflictFallback => 'Conflit';

  @override
  String get workspaceAlreadyUndone => 'Cette réponse a déjà été annulée.';

  @override
  String get workspaceStillRunning => 'Cette réponse est toujours en cours.';

  @override
  String get workspaceNoDesktopWorkspace =>
      'La réponse n’a pas d’espace de travail sur l’ordinateur.';

  @override
  String get workspaceNoPatchCaptured =>
      'Aucun patch exact pris en charge n’a été enregistré pour cette réponse.';

  @override
  String get workspaceRestoreTitle =>
      'Restaurer l’espace de travail avant ce tour ?';

  @override
  String get workspaceRestoreBody =>
      'Cette action remplace les fichiers actuels de l’espace de travail et supprime les fichiers non suivis. Vérifiez les fichiers concernés avant de restaurer. Le Mac enregistre d’abord un point de sauvegarde.';

  @override
  String get workspaceNoAffectedFiles => 'Aucun fichier concerné.';

  @override
  String get workspaceStagedFiles => 'Fichiers indexés';

  @override
  String get workspaceUntrackedFiles => 'Fichiers non suivis';

  @override
  String get workspaceRestoreFiles => 'Restaurer les fichiers';

  @override
  String get workspaceTurnChanges => 'Modifications par tour';

  @override
  String get workspaceReloadTurnChanges => 'Recharger les modifications';

  @override
  String get workspaceConversationTurn => 'Tour de discussion';

  @override
  String workspaceTurnNumber(int number) {
    return 'Tour $number';
  }

  @override
  String get workspaceNoSavedChanges =>
      'Aucune modification enregistrée pour ce tour.';

  @override
  String get workspaceNoCompletedTurns => 'Aucun tour terminé pour l’instant.';

  @override
  String get workspaceChooseTurn =>
      'Choisissez un tour pour voir les modifications enregistrées de l’espace de travail.';

  @override
  String get workspaceStopBeforeRestore =>
      'Arrêtez le tour en cours avant de restaurer des fichiers.';

  @override
  String get workspacePreviewRestore =>
      'Prévisualiser la restauration avant ce tour';

  @override
  String get workspaceFileFallbackTitle => 'Fichier de l’espace de travail';

  @override
  String get workspaceCopyFileContents => 'Copier le contenu du fichier';

  @override
  String get workspaceFileContentsCopied => 'Contenu du fichier copié.';

  @override
  String get workspaceReloadFile => 'Recharger le fichier';

  @override
  String get workspaceFilePathOnMac => 'Chemin du fichier sur votre Mac';

  @override
  String get workspaceSegmentText => 'Texte';

  @override
  String get workspaceSegmentImage => 'Image';

  @override
  String get workspaceOpen => 'Ouvrir';

  @override
  String get workspaceSvgRenderFailed => 'Impossible d’afficher ce SVG.';

  @override
  String get workspaceImageRenderFailed =>
      'Ce format d’image ne peut pas être affiché sur cet appareil.';

  @override
  String get workspaceOpenFileToPreview =>
      'Ouvrez un fichier de l’espace de travail pour le prévisualiser.';

  @override
  String get workspaceSavedToPhotos => 'Enregistrée dans Photos.';

  @override
  String get workspaceImageTitle => 'Image';

  @override
  String get workspaceOk => 'OK';

  @override
  String get workspaceLoadingFile => 'Chargement du fichier';

  @override
  String get workspaceUnableToLoadFile => 'Impossible de charger le fichier.';

  @override
  String get workspaceRetry => 'Réessayer';

  @override
  String get workspaceCloseFilePreview => 'Fermer l’aperçu du fichier';

  @override
  String get workspaceDone => 'OK';

  @override
  String get workspaceFindInFile => 'Rechercher dans le fichier';

  @override
  String workspaceLineCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count lignes',
      one: '$count ligne',
    );
    return '$_temp0';
  }

  @override
  String workspaceByteCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count octets',
      one: '$count octet',
    );
    return '$_temp0';
  }

  @override
  String get workspaceCloseSvgPreview => 'Fermer l’aperçu SVG';

  @override
  String get workspaceReloadSvgPreview => 'Recharger l’aperçu SVG';

  @override
  String get workspaceShare => 'Partager';

  @override
  String get workspaceSaveToPhotos => 'Enregistrer dans Photos';

  @override
  String get workspaceUnableToDisplayImage => 'Impossible d’afficher l’image.';

  @override
  String get workspaceFileContents => 'Contenu du fichier';

  @override
  String get workspaceSearching => 'Recherche…';

  @override
  String workspaceMatchPosition(int index, int total) {
    return '$index sur $total';
  }

  @override
  String get workspacePreviousMatch => 'Résultat précédent';

  @override
  String get workspaceNextMatch => 'Résultat suivant';

  @override
  String get workspaceCloseFind => 'Fermer la recherche';

  @override
  String get workspaceAddLocalFolder => 'Ajouter un dossier local';

  @override
  String get workspaceCreateFolderOnMac => 'Créer un dossier sur le Mac';

  @override
  String get workspaceUse => 'Utiliser';

  @override
  String get workspaceParentFolder => 'Dossier parent';

  @override
  String get workspaceSearchingFolders => 'Recherche de dossiers…';

  @override
  String get workspaceLoading => 'Chargement';

  @override
  String get workspaceNoMatchingFolders =>
      'Aucun dossier correspondant dans ce dossier.';

  @override
  String get workspaceNoChildFolders => 'Aucun sous-dossier ici.';

  @override
  String get workspaceSearchFolders => 'Rechercher un dossier';

  @override
  String get workspaceClearFolderSearch => 'Effacer la recherche';

  @override
  String get workspaceLocations => 'Emplacements';

  @override
  String get workspaceCurrentFolder => 'Dossier actuel';

  @override
  String get workspaceLoadingFolders => 'Chargement des dossiers…';

  @override
  String get workspaceNoFolderSelected => 'Aucun dossier sélectionné.';

  @override
  String get workspaceMatchingFolders => 'Dossiers correspondants';

  @override
  String get workspaceFolders => 'Dossiers';

  @override
  String get workspaceNewFolder => 'Nouveau dossier';

  @override
  String get workspaceNewFolderBody =>
      'Créez ce dossier sur votre appareil et démarrez-y une discussion.';

  @override
  String get workspaceFolderName => 'Nom du dossier';

  @override
  String get workspaceCreate => 'Créer';

  @override
  String get workspaceDesktopChangedPicker =>
      'L’ordinateur connecté a changé. Rouvrez le sélecteur de projet.';

  @override
  String get workspaceDesktopChanged =>
      'L’ordinateur connecté a changé. Rouvrez cet espace de travail.';

  @override
  String get workspaceChooseWorkspaceFirst =>
      'Choisissez d’abord un espace de travail sur votre ordinateur.';

  @override
  String get workspaceNoTextInPreview =>
      'L’aperçu du fichier ne contenait pas de texte. Rechargez-le depuis l’espace de travail.';

  @override
  String get workspaceNoImageInPreview =>
      'L’aperçu de l’image ne contenait pas de données. Rechargez-le depuis l’espace de travail.';

  @override
  String get workspaceRestorePreviewOtherWorkspace =>
      'Cet aperçu de restauration appartient à un autre espace de travail. Prévisualisez-le à nouveau.';

  @override
  String get cloudChatNewChat => 'Nouvelle discussion';

  @override
  String get cloudChatLostConnection =>
      'Connexion perdue. Touchez Reconnecter pour reprendre cette réponse.';

  @override
  String get cloudChatImageToEdit => 'Image à modifier';

  @override
  String get cloudChatNoContent => 'Réponse vide.';

  @override
  String get cloudChatThinking => 'Réflexion…';

  @override
  String get cloudChatResponseStopped => 'Réponse arrêtée.';

  @override
  String get cloudChatResponseFailed => 'La réponse a échoué.';

  @override
  String get cloudChatWaitingForUsageReset =>
      'En attente de la réinitialisation des limites.';

  @override
  String get cloudChatModelChoiceLoadFailed =>
      'Impossible de charger votre choix de modèle. Réessayez.';

  @override
  String get cloudChatModelChoiceSaveFailed =>
      'Impossible d’enregistrer votre choix de modèle. Réessayez.';

  @override
  String get cloudChatDraftSaveFailed =>
      'Impossible d’enregistrer votre brouillon. Gardez le texte ici et réessayez.';

  @override
  String get cloudChatDraftLoadFailed =>
      'Impossible de charger votre brouillon. Réessayez avant de le modifier.';

  @override
  String get cloudChatInterruptedImage =>
      'Une demande d’image interrompue est enregistrée en lieu sûr. Réessayez pour vérifier son résultat.';

  @override
  String get cloudChatInterruptedMessage =>
      'Un message interrompu est enregistré en lieu sûr. Réessayez pour vérifier son résultat.';

  @override
  String get cloudChatModelCannotViewImages =>
      'Choisissez un modèle capable de voir les images avant d’envoyer cette pièce jointe.';

  @override
  String get cloudChatImageGenerationUnavailable =>
      'La génération d’images n’est pas configurée pour ce service.';

  @override
  String get cloudChatUseBankedResetTitle =>
      'Utiliser une réinitialisation en réserve ?';

  @override
  String get cloudChatUseBankedResetBody =>
      'Vos limites sur 5 heures et hebdomadaire repartent de zéro dès maintenant, et votre semaine recommence aujourd’hui.';

  @override
  String get cloudChatUseReset => 'Utiliser';

  @override
  String get cloudChatLimitFreesSoon => 'Votre limite se libère bientôt.';

  @override
  String get cloudChatResetsNow => 'Réinitialisation maintenant.';

  @override
  String get cloudChatResetsTomorrow => 'Réinitialisation demain.';

  @override
  String cloudChatResetsInDays(int days) {
    return 'Réinitialisation dans $days jours.';
  }

  @override
  String cloudChatResetsOn(String date) {
    return 'Réinitialisation le $date.';
  }

  @override
  String get cloudChatResetsInAMoment => 'Réinitialisation dans un instant.';

  @override
  String cloudChatResetsInMinutes(int minutes) {
    String _temp0 = intl.Intl.pluralLogic(
      minutes,
      locale: localeName,
      other: 'Réinitialisation dans $minutes minutes.',
      one: 'Réinitialisation dans $minutes minute.',
    );
    return '$_temp0';
  }

  @override
  String cloudChatResetsInHours(int hours) {
    String _temp0 = intl.Intl.pluralLogic(
      hours,
      locale: localeName,
      other: 'Réinitialisation dans $hours heures.',
      one: 'Réinitialisation dans $hours heure.',
    );
    return '$_temp0';
  }

  @override
  String get cloudChatUsageLimitReached =>
      'Vous avez atteint votre limite d’utilisation';

  @override
  String get cloudChatRetryUsage => 'Recharger l’utilisation';

  @override
  String cloudChatUseBankedReset(int count) {
    return 'Utiliser une réinitialisation en réserve ($count restantes)';
  }

  @override
  String get cloudChatPickerFailed =>
      'Impossible d’ouvrir le sélecteur. Veuillez réessayer.';

  @override
  String get cloudChatModel => 'Modèle';

  @override
  String get cloudChatShareLink => 'Partager le lien';

  @override
  String get cloudChatTaskPrompt => 'Sur quoi DJL doit-il travailler ?';

  @override
  String get cloudChatHowCanIHelp => 'Comment puis-je vous aider ?';

  @override
  String get cloudChatTaskHint =>
      'Lancez une tâche et revenez au résultat quand il est prêt.';

  @override
  String cloudChatStepProgress(String step, String total) {
    return 'Étape $step sur $total';
  }

  @override
  String get cloudChatRetry => 'Réessayer';

  @override
  String get cloudChatRetryDraft => 'Recharger le brouillon';

  @override
  String get cloudChatRetryModelChoice => 'Recharger le choix du modèle';

  @override
  String get cloudChatMessageHint => 'Écrire à DJL';

  @override
  String get cloudChatAttachTooltip => 'Joindre un fichier ou une image';

  @override
  String get cloudChatCreateImage => 'Créer une image';

  @override
  String get cloudChatChooseFile => 'Choisir un fichier';

  @override
  String get cloudChatPhotoLibrary => 'Photothèque';

  @override
  String get cloudChatCamera => 'Appareil photo';

  @override
  String get cloudChatTaskMode => 'Mode tâche';

  @override
  String get cloudChatTask => 'Tâche';

  @override
  String get cloudChatStopDictation => 'Arrêter la dictée';

  @override
  String get cloudChatStartDictation => 'Démarrer la dictée';

  @override
  String get cloudChatStopResponse => 'Arrêter la réponse';

  @override
  String get cloudChatSendMessage => 'Envoyer le message';

  @override
  String get cloudChatEditMessage => 'Modifier le message';

  @override
  String get cloudChatSend => 'Envoyer';

  @override
  String get cloudChatDisableWordWrap => 'Désactiver le retour à la ligne';

  @override
  String get cloudChatEnableWordWrap => 'Activer le retour à la ligne';

  @override
  String get cloudChatCopied => 'Copié';

  @override
  String get cloudChatCopyCode => 'Copier le code';

  @override
  String get cloudChatCodeLabel => 'Code';

  @override
  String get cloudChatEdit => 'Modifier';

  @override
  String get cloudChatPreviousBranch => 'Version précédente';

  @override
  String get cloudChatNextBranch => 'Version suivante';

  @override
  String get cloudChatCopyMessage => 'Copier le message';

  @override
  String get cloudChatRegenerateReply => 'Régénérer la réponse';

  @override
  String get cloudChatStopReading => 'Arrêter la lecture';

  @override
  String get cloudChatReadAloud => 'Lire à voix haute';

  @override
  String get cloudChatReportAnswer => 'Signaler cette réponse';

  @override
  String cloudChatToolResult(String name, String status) {
    return '$name · $status';
  }

  @override
  String get cloudChatToolFailed => 'Échec';

  @override
  String get cloudChatToolDone => 'Terminé';

  @override
  String get cloudChatNeedsNewerVersion =>
      'Ce message contient du contenu qui nécessite une version plus récente.';

  @override
  String get cloudChatImageUnavailableRetry => 'Image indisponible · Réessayer';

  @override
  String get cloudChatConversationImage => 'Image de la discussion';

  @override
  String get cloudChatImageDisplayFailed =>
      'Impossible d’afficher cette image.';

  @override
  String get cloudChatShareFailed =>
      'Impossible d’ouvrir le partage. Réessayez.';

  @override
  String get cloudChatShareLinkCreated => 'Lien de partage créé';

  @override
  String get cloudChatShareLinkBody =>
      'Toute personne disposant du lien peut lire cette discussion dans son état actuel. Les messages envoyés ensuite ne sont pas partagés.';

  @override
  String get cloudChatCopyLink => 'Copier le lien';

  @override
  String get cloudChatShare => 'Partager';

  @override
  String get conversationsPinned => 'Épinglées';

  @override
  String get conversationsPinnedEmpty =>
      'Touchez longuement une discussion pour l’épingler.';

  @override
  String get conversationsRecentEmpty => 'Vos discussions apparaissent ici.';

  @override
  String get conversationsCloudConversationHint => 'Discussion Cloud';

  @override
  String get conversationsChat => 'Discussion';

  @override
  String get conversationsSearchChats => 'Rechercher';

  @override
  String get conversationsRemote => 'À distance';

  @override
  String get conversationsRecentChats => 'Discussions récentes';

  @override
  String get conversationsLoadMore => 'Afficher plus';

  @override
  String get conversationsSettings => 'Paramètres';

  @override
  String get conversationsArchivedChats => 'Discussions archivées';

  @override
  String get conversationsRestore => 'Restaurer';

  @override
  String get conversationsNoArchivedChats => 'Aucune discussion archivée';

  @override
  String get conversationsPin => 'Épingler';

  @override
  String get conversationsUnpin => 'Désépingler';

  @override
  String get conversationsRename => 'Renommer';

  @override
  String get conversationsArchive => 'Archiver';

  @override
  String get conversationsDelete => 'Supprimer';

  @override
  String get conversationsDeleteChatQuestion => 'Supprimer cette discussion ?';

  @override
  String get plansCompleted => 'Terminé';

  @override
  String get plansInProgress => 'En cours';

  @override
  String get plansPending => 'À faire';

  @override
  String get plansOpenActivePlan => 'Ouvrir le plan en cours';

  @override
  String get plansPlan => 'Plan';

  @override
  String plansStepOf(int current, int total) {
    return 'Étape $current sur $total';
  }

  @override
  String plansStepFraction(int current, int total) {
    return 'Étape $current/$total';
  }

  @override
  String plansStatusValue(String status, String position) {
    return '$status, $position';
  }

  @override
  String get plansImage => 'Image';

  @override
  String get plansActivePlan => 'Plan en cours';

  @override
  String get plansDone => 'OK';

  @override
  String get plansNoLongerAvailable => 'Ce plan n’est plus disponible.';

  @override
  String get plansProposedPlan => 'Plan proposé';

  @override
  String get plansCollapsePlan => 'Replier le plan';

  @override
  String get plansExpandPlan => 'Déplier le plan';

  @override
  String get plansCollapse => 'Replier';

  @override
  String get plansExpand => 'Déplier';

  @override
  String get plansStarting => 'Démarrage…';

  @override
  String get plansImplement => 'Mettre en œuvre';

  @override
  String get plansNextStepQuestion => 'Que doit produire Codex ensuite ?';

  @override
  String get plansNextStepHeader => 'Étape suivante';

  @override
  String get voiceAllowMicrophone =>
      'Autorisez l’accès au micro et à la reconnaissance vocale dans les réglages de l’appareil pour dicter.';

  @override
  String get voiceDictationUnavailable =>
      'La dictée sur l’appareil n’est pas disponible pour cette langue ou cet appareil. Vous pouvez toujours écrire votre message.';

  @override
  String get voiceSpeechAccessRequired =>
      'Autorisez l’accès au micro et à la reconnaissance vocale dans les réglages de l’appareil. La reconnaissance vocale sur l’appareil doit être disponible pour votre langue.';

  @override
  String get voiceInputUnavailable =>
      'La saisie vocale n’est pas disponible. Vous pouvez toujours écrire votre message.';

  @override
  String get voiceStopFailed => 'Impossible d’arrêter la saisie vocale.';

  @override
  String get voicePlaybackUnavailable =>
      'La lecture vocale n’est pas disponible sur cet appareil.';

  @override
  String get voiceStopUnclean =>
      'La saisie vocale ne s’est pas arrêtée correctement. Fermez cet écran avant de continuer.';

  @override
  String get goalsStatusActive => 'Actif';

  @override
  String get goalsStatusPaused => 'En pause';

  @override
  String get goalsStatusBlocked => 'Bloqué';

  @override
  String get goalsStatusUsageLimited => 'Limite d’utilisation atteinte';

  @override
  String get goalsStatusBudgetLimited => 'Budget atteint';

  @override
  String get goalsStatusComplete => 'Terminé';

  @override
  String goalsTokenUsage(String used, String budget) {
    return '$used / $budget jetons';
  }

  @override
  String get goalsUnsupported =>
      'Les objectifs ne sont pas disponibles dans cet environnement. Mettez à jour Codex sur votre Mac et activez les objectifs.';

  @override
  String get goalsEphemeral =>
      'Les objectifs nécessitent une discussion enregistrée. Cette discussion est temporaire.';

  @override
  String get goalsDesktopChanged =>
      'L’ordinateur connecté a changé. Rouvrez cet objectif.';

  @override
  String get goalsOtherChatGoal =>
      'L’environnement a renvoyé l’objectif d’une autre discussion.';

  @override
  String get goalsBudgetInvalid =>
      'Le budget de jetons doit être un nombre entier positif.';

  @override
  String get goalsUnexpectedResponse =>
      'L’environnement a renvoyé une réponse inattendue pour l’objectif.';

  @override
  String get goalsReconnect =>
      'Reconnectez-vous à votre ordinateur pour gérer cet objectif.';

  @override
  String get goalsDescribeFirst => 'Décrivez d’abord l’objectif.';

  @override
  String get goalsReplaceTitle => 'Remplacer l’objectif actuel ?';

  @override
  String get goalsReplaceBody =>
      'Cet objectif n’est pas atteint. Le remplacer démarre un nouvel objectif et remet à zéro le suivi de son utilisation.';

  @override
  String get goalsReplaceAction => 'Remplacer l’objectif';

  @override
  String get goalsClearTitle => 'Effacer cet objectif ?';

  @override
  String get goalsClearBody =>
      'L’ordinateur cesse de poursuivre cet objectif et efface le suivi de sa progression.';

  @override
  String get goalsClearAction => 'Effacer l’objectif';

  @override
  String get goalsTitle => 'Objectif';

  @override
  String get goalsReload => 'Recharger l’objectif';

  @override
  String get goalsShowingLastKnown =>
      'Dernier objectif connu. Reconnectez-vous pour le gérer.';

  @override
  String get goalsNewGoal => 'Nouvel objectif';

  @override
  String get goalsEditGoal => 'Modifier l’objectif';

  @override
  String get goalsDescribeHint =>
      'Décrivez le résultat attendu, comment le vérifier et ce qui ne doit pas régresser.';

  @override
  String get goalsObjective => 'Objectif';

  @override
  String get goalsBudgetLabel => 'Budget de jetons (facultatif)';

  @override
  String get goalsBudgetHelper => 'Laissez vide pour ne pas fixer de budget.';

  @override
  String get goalsStart => 'Lancer l’objectif';

  @override
  String get goalsSave => 'Enregistrer l’objectif';

  @override
  String get goalsCancelEditing => 'Annuler la modification';

  @override
  String goalsTokensRemaining(String tokens) {
    return '$tokens jetons restants';
  }

  @override
  String get goalsActiveExplainer =>
      'L’ordinateur continue de travailler à cet objectif quand la discussion est inactive, jusqu’à ce qu’il soit atteint, mis en pause ou qu’une limite soit atteinte.';

  @override
  String get goalsPause => 'Mettre en pause';

  @override
  String get goalsResume => 'Reprendre l’objectif';

  @override
  String get goalsEditObjective => 'Modifier l’objectif';

  @override
  String get groupsKindSpreadsheet => 'Feuille de calcul';

  @override
  String get groupsKindText => 'Texte';

  @override
  String get groupsKindArchive => 'Archive';

  @override
  String get groupsKindImage => 'Image';

  @override
  String get groupsKindVideo => 'Vidéo';

  @override
  String get groupsKindAudio => 'Audio';

  @override
  String get groupsKindFile => 'Fichier';

  @override
  String get groupsMacUnreachable =>
      'Impossible de joindre votre Mac. Réessayez.';

  @override
  String get groupsCreateFailed => 'Impossible de créer le groupe. Réessayez.';

  @override
  String get groupsNewGroup => 'Nouveau groupe';

  @override
  String get groupsChooseMembers => 'Choisissez qui participe à la discussion.';

  @override
  String get groupsNameOptional => 'Nom (facultatif)';

  @override
  String get groupsCreateGroup => 'Créer le groupe';

  @override
  String groupsCreateGroupWith(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Créer un groupe avec $count agents',
      one: 'Créer un groupe avec $count agent',
    );
    return '$_temp0';
  }

  @override
  String get groupsSignInOnMac =>
      'Connectez-vous sur votre Mac pour l’utiliser';

  @override
  String get groupsUpdateMacTitle => 'Mettez à jour DJL sur votre Mac';

  @override
  String get groupsUpdateMacBody =>
      'Les discussions de groupe nécessitent la dernière version de DJL sur votre Mac. Mettez-la à jour, puis revenez.';

  @override
  String get groupsConnectMacTitle => 'Connectez-vous à votre Mac';

  @override
  String get groupsConnectMacBody =>
      'Les discussions de groupe se trouvent sur votre Mac. Elles apparaissent ici dès qu’il est connecté.';

  @override
  String get groupsLoadFailed => 'Impossible de charger vos groupes';

  @override
  String get groupsEmptyTitle => 'Réunissez vos agents dans une discussion';

  @override
  String get groupsEmptyBody =>
      'Posez votre question une seule fois : Claude, Codex et les autres répondent ensemble.';

  @override
  String groupsMemberWriting(String name) {
    return '$name écrit';
  }

  @override
  String groupsAgentsWriting(int count) {
    return '$count agents écrivent';
  }

  @override
  String get groupsPausedWaiting => 'En pause, vous attend';

  @override
  String groupsAgentCount(int count) {
    return '$count agents';
  }

  @override
  String get groupsMacDidNotKeepFile =>
      'Votre Mac n’a pas conservé le fichier.';

  @override
  String get groupsFileStillSending =>
      'Ce fichier est encore en cours d’envoi.';

  @override
  String get groupsMacTimeout =>
      'Votre Mac n’a pas répondu à temps. Vérifiez que DJL y est ouvert.';

  @override
  String get groupsMacNotConnected =>
      'Votre Mac n’est pas connecté pour le moment.';

  @override
  String groupsRemoveAttachment(String name) {
    return 'Retirer $name';
  }

  @override
  String get groupsSendingFiles => 'Envoi des fichiers';

  @override
  String groupsImageNamed(String name) {
    return 'Image $name';
  }

  @override
  String get groupsAttach => 'Joindre';

  @override
  String get groupsPhotos => 'Photos';

  @override
  String get groupsFiles => 'Fichiers';

  @override
  String groupsFileUnsupported(String name) {
    return 'Impossible d’envoyer $name. Formats acceptés : photos, PDF, Word, Excel, PowerPoint, fichiers texte et code.';
  }

  @override
  String groupsFileTooLarge(String name, String size) {
    return '$name dépasse $size.';
  }

  @override
  String groupsTooManyFiles(int count) {
    return 'Un message peut contenir $count fichiers.';
  }

  @override
  String get groupsOpenFailed =>
      'Impossible d’ouvrir cet élément. Veuillez réessayer.';

  @override
  String get groupsAskEveryoneTitle => 'Demander à tout le monde ?';

  @override
  String groupsAskEveryoneBody(int count) {
    return 'Les $count agents répondront à ce message.';
  }

  @override
  String get groupsDontAskAgain => 'Ne plus demander';

  @override
  String get groupsAskEveryone => 'Demander à tous';

  @override
  String get groupsGroupGone => 'Ce groupe n’est plus sur votre Mac.';

  @override
  String groupsSayHelloPrompt(String everyone) {
    return '$everyone Dites bonjour en une ligne.';
  }

  @override
  String get groupsReconnectingToMac => 'Reconnexion à votre Mac…';

  @override
  String groupsHeaderLabel(String name, int count) {
    return '$name, $count agents';
  }

  @override
  String get groupsMembers => 'Membres';

  @override
  String get groupsYou => 'Vous';

  @override
  String get groupsCouldNotReply => 'N’a pas pu répondre';

  @override
  String get groupsNothingToAdd => 'Rien à ajouter';

  @override
  String get groupsImageOnMac => 'Image sur votre Mac';

  @override
  String get groupsRemovedAgent => 'Agent retiré';

  @override
  String get groupsWaitingTurn => 'Attend son tour';

  @override
  String get groupsWriting => 'Écrit';

  @override
  String get groupsAttachTooltip => 'Joindre des fichiers ou des photos';

  @override
  String get groupsMentionAgent => 'Mentionner un agent';

  @override
  String get groupsMessageHint => 'Message';

  @override
  String get groupsStopAgents => 'Arrêter les agents';

  @override
  String get groupsEveryone => 'Tout le monde';

  @override
  String get groupsPausedTitle => 'Les agents ont fait une pause';

  @override
  String get groupsPausedBody =>
      'Ils discutent entre eux depuis un moment et ont encore des choses à dire.';

  @override
  String get groupsEndItHere => 'Arrêter là';

  @override
  String get groupsLetThemContinue => 'Les laisser continuer';

  @override
  String get groupsOfflineHint =>
      'Les messages apparaissent ici dès que votre Mac est connecté.';

  @override
  String get groupsLoadingMessages => 'Chargement des messages';

  @override
  String get groupsEveryoneIsHere => 'Tout le monde est là';

  @override
  String get groupsEmptyChatHint =>
      'Tapez @ pour choisir qui répond. Votre premier message est envoyé à tout le monde.';

  @override
  String get groupsAskEveryoneToSayHello => 'Demander à chacun de dire bonjour';

  @override
  String get groupsManageOnMac =>
      'Ajoutez ou retirez des agents dans DJL sur votre Mac.';

  @override
  String get groupsReady => 'Prêt';

  @override
  String get groupsStop => 'Arrêter';

  @override
  String get guardianLiveReason =>
      'Les approbations de nouvelle tentative ne sont disponibles que pendant la session en direct.';

  @override
  String get guardianExpiredReason =>
      'Cette nouvelle tentative n’est plus disponible. Attendez que Codex redemande l’action.';

  @override
  String get guardianDesktopReason =>
      'Approuvez cette nouvelle tentative dans Codex sur ordinateur.';

  @override
  String get guardianUnsafeReason =>
      'Cette action ne peut pas être relancée en toute sécurité ici. Approuvez-la dans Codex.';

  @override
  String get guardianSubmittedReason =>
      'Approbation envoyée. Vérifiez Codex avant de réessayer.';

  @override
  String get guardianUncertainReason =>
      'L’approbation n’est peut-être pas parvenue à Codex. Vérifiez Codex avant de réessayer.';

  @override
  String get guardianRequestedAction => 'Action demandée';

  @override
  String get guardianRunCommand => 'Exécuter une commande';

  @override
  String get guardianApplyFileChanges =>
      'Appliquer des modifications de fichiers';

  @override
  String guardianEditFile(String file) {
    return 'Modifier $file';
  }

  @override
  String guardianEditFiles(int count, String files) {
    return 'Modifier $count fichiers : $files';
  }

  @override
  String get guardianAccessNetwork => 'Accéder au réseau';

  @override
  String guardianAccessHost(String host) {
    return 'Accéder à $host';
  }

  @override
  String get guardianRequestPermissions =>
      'Demander des autorisations supplémentaires';

  @override
  String get guardianRequestNetwork => 'Demander l’accès au réseau';

  @override
  String get guardianRequestFileAccess => 'Demander l’accès aux fichiers';

  @override
  String get guardianRequestNetworkAndFileAccess =>
      'Demander l’accès au réseau et aux fichiers';

  @override
  String get guardianReviewing => 'Vérification';

  @override
  String get guardianApproved => 'Approuvé';

  @override
  String get guardianDenied => 'Refusé';

  @override
  String get guardianTimedOut => 'Délai dépassé';

  @override
  String get guardianStopped => 'Arrêté';

  @override
  String guardianUpdatedStatus(String status) {
    return 'Mis à jour ($status)';
  }

  @override
  String get guardianDetailsUnavailable =>
      'Détails de la vérification indisponibles.';

  @override
  String guardianAutoReviewTitle(String status) {
    return 'Vérification auto · $status';
  }

  @override
  String get guardianRiskLow => 'Risque faible';

  @override
  String get guardianRiskMedium => 'Risque moyen';

  @override
  String get guardianRiskHigh => 'Risque élevé';

  @override
  String guardianRiskOther(String level) {
    return 'Risque $level';
  }

  @override
  String guardianAuthorization(String value) {
    return 'Autorisation : $value';
  }

  @override
  String get guardianApprovalRecorded =>
      'Approbation enregistrée ; la nouvelle tentative sera tout de même vérifiée';

  @override
  String get guardianSubmittingApproval => 'Envoi de l’approbation…';

  @override
  String get guardianApproveOneRetry => 'Approuver une nouvelle tentative';

  @override
  String get subagentsSubagent => 'Sous-agent';

  @override
  String get subagentsSpawnAgent => 'Lancer un agent';

  @override
  String get subagentsWaitForAgents => 'Attendre les agents';

  @override
  String get subagentsUpdateAgent => 'Mettre à jour l’agent';

  @override
  String get subagentsResumeAgent => 'Reprendre l’agent';

  @override
  String get subagentsCloseAgent => 'Fermer l’agent';

  @override
  String get subagentsActivity => 'Activité des sous-agents';

  @override
  String get subagentsMetadataUnavailable =>
      'Métadonnées du sous-agent indisponibles';

  @override
  String get activityCommand => 'Commande';

  @override
  String get activityFileChanges => 'Modifications de fichiers';

  @override
  String activityFilesChanged(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count fichiers modifiés',
      one: '$count fichier modifié',
    );
    return '$_temp0';
  }

  @override
  String get activityToolActivity => 'Activité des outils';

  @override
  String get activityReadFile => 'Lecture d’un fichier';

  @override
  String activityReadValue(String value) {
    return 'Lecture de $value';
  }

  @override
  String get activitySearchFiles => 'Recherche de fichiers';

  @override
  String activitySearchValue(String value) {
    return 'Recherche de $value';
  }

  @override
  String get activityListFiles => 'Liste des fichiers';

  @override
  String activityListFilesValue(String value) {
    return 'Liste des fichiers $value';
  }

  @override
  String get statusTaskStatus => 'État des tâches';

  @override
  String get statusAllowed =>
      'L’état des tâches est autorisé sur cet appareil.';

  @override
  String get statusDenied =>
      'Autorisez l’état des tâches local dans les réglages de l’appareil. Les discussions fonctionnent sans.';

  @override
  String get statusUnsupported =>
      'L’état des tâches n’est pas disponible sur cet appareil.';

  @override
  String get statusChecking => 'Vérification de l’autorisation…';

  @override
  String get statusEnable => 'Activer';

  @override
  String get statusRefresh => 'Actualiser l’état des tâches';

  @override
  String get statusSystemSettings => 'Ouvrir les réglages';

  @override
  String pairingStateLabel(String state) {
    String _temp0 = intl.Intl.selectLogic(state, {
      'disconnected': 'déconnecté',
      'resolving': 'résolution',
      'connecting': 'connexion',
      'connected': 'connecté',
      'offline': 'ordinateur hors ligne',
      'suspended': 'suspendu',
      'other': '$state',
    });
    return '$_temp0';
  }

  @override
  String get settingsLanguage => 'Langue';

  @override
  String get settingsLanguageSystem => 'Langue du système';

  @override
  String get workspaceUndoNoExactPatch =>
      'Aucun patch unifié complet et exact n’a été enregistré.';

  @override
  String get workspaceUndoRenames =>
      'Les renommages ne peuvent pas être annulés ici.';

  @override
  String get workspaceUndoBinary =>
      'Les modifications binaires, de nom, de mode ou de lien symbolique ne peuvent pas être annulées ici.';
}
