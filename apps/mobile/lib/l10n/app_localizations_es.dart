// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Spanish Castilian (`es`).
class AppLocalizationsEs extends AppLocalizations {
  AppLocalizationsEs([String locale = 'es']) : super(locale);

  @override
  String get appName => 'DJL';

  @override
  String get commonCancel => 'Cancelar';

  @override
  String get commonTryAgain => 'Reintentar';

  @override
  String get chatUiAccessAskTitle => 'Pedir aprobación';

  @override
  String get chatUiAccessAskDetail =>
      'Preguntar siempre antes de editar archivos externos y usar internet';

  @override
  String get chatUiAccessAutoTitle => 'Aprobar por mí';

  @override
  String get chatUiAccessAutoDetail =>
      'Preguntar solo por acciones que podrían ser inseguras';

  @override
  String get chatUiAccessFullTitle => 'Acceso completo';

  @override
  String get chatUiAccessFullDetail =>
      'Acceso total a la computadora (mayor riesgo)';

  @override
  String get chatUiAccessHint => 'Cambia cómo Codex pide permiso';

  @override
  String get chatUiAccessFullConfirmTitle =>
      '¿Permitir acceso completo a la computadora?';

  @override
  String get chatUiAccessFullConfirmBody =>
      'El agente podrá cambiar archivos y ejecutar comandos fuera del espacio de trabajo sin pedir aprobación.';

  @override
  String get chatUiAccessFullConfirm => 'Permitir acceso completo';

  @override
  String get chatUiAttentionNoMatches => 'No hay elementos que coincidan';

  @override
  String get chatUiAttentionAllCaughtUp => 'Estás al día';

  @override
  String get chatUiAttentionNoMatchesHint =>
      'Prueba con otro proyecto, chat o estado.';

  @override
  String get chatUiAttentionEmptyHint =>
      'Aquí aparecerán aprobaciones, preguntas de agentes, ejecuciones fallidas y trabajo terminado.';

  @override
  String get chatUiAttentionNeedsYou => 'TE NECESITA';

  @override
  String get chatUiAttentionReadyToReview => 'LISTO PARA REVISAR';

  @override
  String get chatUiAgoNow => 'ahora';

  @override
  String chatUiAgoMinutes(int minutes) {
    return 'hace $minutes min';
  }

  @override
  String chatUiAgoHours(int hours) {
    return 'hace $hours h';
  }

  @override
  String chatUiAgoDays(int days) {
    return 'hace $days d';
  }

  @override
  String get chatUiAttentionTitle => 'Pendientes';

  @override
  String get chatUiAttentionConnectionChanged =>
      'La conexión cambió. Vuelve atrás para abrir Pendientes de nuevo.';

  @override
  String get chatUiAttentionSearch => 'Buscar en pendientes';

  @override
  String get appSavedConnectionsUnreadable =>
      'No se pudieron leer los datos de conexión guardados. Tus conexiones guardadas se conservaron.';

  @override
  String get appRestoreMacsFailed =>
      'No se pudieron restaurar las Mac guardadas. Desbloquea tu dispositivo y vuelve a intentarlo.';

  @override
  String get appLinkedConversationFailed =>
      'No se pudo abrir la conversación vinculada. Revisa tu conexión y vuelve a intentarlo.';

  @override
  String get appLinkedAccountUnavailable =>
      'Los datos de la cuenta aún no están disponibles. Vuelve a abrir la conversación vinculada cuando carguen.';

  @override
  String get appAccountStillLoading =>
      'Los datos de la cuenta aún se están cargando. Vuelve a intentarlo.';

  @override
  String get appRenameChat => 'Cambiar nombre del chat';

  @override
  String get appRenameChatPlaceholder => 'Título';

  @override
  String get appSave => 'Guardar';

  @override
  String get appOpenNavigation => 'Abrir navegación';

  @override
  String get appAccountUnavailable =>
      'Los datos de la cuenta no están disponibles.';

  @override
  String get appRetryAccount => 'Reintentar cuenta';

  @override
  String get appImages => 'Imágenes';

  @override
  String get appNotifications => 'Notificaciones';

  @override
  String get appRetryLinkedConversation => 'Reintentar conversación vinculada';

  @override
  String get coreBack => 'Atrás';

  @override
  String get coreMenu => 'Menú';

  @override
  String get coreChatActions => 'Acciones del chat';

  @override
  String get coreSessionEnded => 'Tu sesión terminó. Vuelve a iniciar sesión.';

  @override
  String coreCloudRequestFailed(int status) {
    return 'Falló la solicitud a DJL Cloud ($status).';
  }

  @override
  String get coreAccountChanged => 'La cuenta cambió.';

  @override
  String get corePleaseSignIn => 'Inicia sesión.';

  @override
  String get coreNoAccessToken => 'DJL Cloud no devolvió un token de acceso.';

  @override
  String get coreCloudTimeout => 'DJL Cloud tardó demasiado en responder.';

  @override
  String get coreCloudUnreachable =>
      'No se pudo conectar con DJL Cloud. Revisa tu conexión.';

  @override
  String get corePleaseSignInAgain => 'Vuelve a iniciar sesión.';

  @override
  String get coreInvalidPushRegistration =>
      'El registro de notificaciones no es válido.';

  @override
  String get corePushNotAcknowledged => 'No se confirmó el registro.';

  @override
  String get coreCloudResponseUnreadable =>
      'Esta versión no pudo leer la respuesta de DJL Cloud.';

  @override
  String get coreInvalidDesktopEnvelope =>
      'Mensaje de la computadora no válido o repetido.';

  @override
  String get coreDesktopMessageUnauthenticated =>
      'No se pudo verificar el mensaje de la computadora.';

  @override
  String get gitThreadChangedReopenAction =>
      'La actividad del hilo cambió. Vuelve a abrir esta acción de rama o árbol de trabajo.';

  @override
  String get gitWaitForThread =>
      'Espera a que este hilo termine antes de cambiar de rama o de árbol de trabajo.';

  @override
  String get gitWaitForOperation =>
      'Espera a que termine la operación de Git en curso antes de cambiar de rama o de árbol de trabajo.';

  @override
  String get gitNotRepositorySentence =>
      'Esta carpeta no es un repositorio Git.';

  @override
  String get gitNotRepository => 'Esta carpeta no es un repositorio Git';

  @override
  String get gitNoLongerRepository =>
      'Esta carpeta ya no es un repositorio Git. Actualiza antes de crear una rama o un árbol de trabajo.';

  @override
  String get gitContinue => 'Continuar';

  @override
  String get gitOk => 'Aceptar';

  @override
  String get gitCreate => 'Crear';

  @override
  String get gitClose => 'Cerrar';

  @override
  String get gitDone => 'Listo';

  @override
  String get gitGenerating => 'Generando…';

  @override
  String get gitGenerateMessage => 'Generar mensaje';

  @override
  String get gitCommitAllTitle => 'Hacer commit de todos los cambios';

  @override
  String get gitCommitPublishTitle => 'Hacer commit y publicar cambios';

  @override
  String get gitCommitMessageLabel => 'Mensaje de commit';

  @override
  String get gitPublishBranchTitle => '¿Publicar esta rama?';

  @override
  String get gitPublishCommitPushBody =>
      'Hace commit de todos los cambios actuales y hace push de esta rama a su remoto.';

  @override
  String get gitPublishFeatureBranchPrBody =>
      'Prepara una rama de función, hace commit de todos los cambios, hace push de la rama y crea un pull request en GitHub.';

  @override
  String get gitPublishCommitPrBody =>
      'Hace commit de todos los cambios, hace push de la rama y crea un pull request en GitHub.';

  @override
  String get gitCommitCreateSwitch => 'Commit, crear y cambiar';

  @override
  String get gitCreateManagedWorktree => 'Crear árbol de trabajo administrado';

  @override
  String get gitCreateWorktree => 'Crear árbol de trabajo';

  @override
  String get gitBranchName => 'Nombre de la rama';

  @override
  String get gitBaseBranch => 'Rama base';

  @override
  String get gitMoveCurrentChanges => 'Mover cambios actuales';

  @override
  String get gitCopyCurrentChanges => 'Copiar cambios actuales';

  @override
  String get gitLeaveChangesHere => 'Dejar cambios aquí';

  @override
  String get gitInitializeTitle => '¿Inicializar Git?';

  @override
  String get gitInitializeBody =>
      'Crea un repositorio Git en este espacio de trabajo.';

  @override
  String get gitPushTitle => '¿Hacer push de la rama?';

  @override
  String get gitPushBody =>
      'Envía los cambios con commit al remoto configurado.';

  @override
  String get gitLocalChangesNeedAttention => 'Hay cambios locales que revisar';

  @override
  String get gitUpdateRepositoryTitle => '¿Actualizar repositorio?';

  @override
  String get gitDirtyAndBehindBody =>
      'Tienes cambios locales y la rama remota avanzó. Haz pull con rebase solo si estás listo para conciliar esos cambios.';

  @override
  String get gitPullBody => 'Trae los commits remotos a esta rama.';

  @override
  String get gitPullAndRebase => 'Pull y rebase';

  @override
  String get gitUpdate => 'Actualizar';

  @override
  String get gitTransferChangesTitle => 'Transferir cambios';

  @override
  String get gitTargetWorkspacePath => 'Ruta del espacio de trabajo de destino';

  @override
  String get gitRemoveWorktreeTitle => '¿Quitar este árbol de trabajo?';

  @override
  String get gitRemoveWorktreeBody =>
      'Quita el árbol de trabajo administrado de esta rama. La computadora no permitirá quitar la copia principal.';

  @override
  String get gitDiscardTitle => '¿Descartar cambios locales?';

  @override
  String get gitDiscardBody =>
      'Descarta los cambios locales en archivos y restablece esta rama a su remoto.';

  @override
  String get gitPrDraftTitle => 'Borrador de pull request';

  @override
  String get gitCopyDraft => 'Copiar borrador';

  @override
  String get gitCreatePrTitle => '¿Crear pull request?';

  @override
  String get gitCreatePrBody =>
      'La computadora hará push de esta rama si hace falta, generará un título y una descripción a partir de los cambios con commit y creará el pull request en GitHub.';

  @override
  String get gitNoChangesToShow =>
      'No hay cambios en el repositorio para mostrar.';

  @override
  String get gitBranchSwitchFailed => 'No se pudo cambiar de rama';

  @override
  String get gitBranchOpenElsewhere =>
      'No se puede cambiar de rama: esta rama ya está abierta en otro árbol de trabajo.';

  @override
  String get gitErrorTitle => 'Error de Git';

  @override
  String get gitOpenPr => 'Abrir PR';

  @override
  String get gitLoadingChanges => 'Cargando cambios';

  @override
  String get gitLoadingChangesEllipsis => 'Cargando cambios…';

  @override
  String get gitChangesUnavailable => 'Cambios no disponibles';

  @override
  String get gitNoChanges => 'Sin cambios';

  @override
  String get gitDesktopChanged =>
      'La computadora conectada cambió. Vuelve a abrir Git desde su espacio de trabajo.';

  @override
  String get gitChooseWorkspace =>
      'Elige un espacio de trabajo de la computadora antes de usar Git.';

  @override
  String get gitWorking => 'Trabajando…';

  @override
  String get gitRetryStatus => 'Reintentar estado de Git';

  @override
  String get gitWorktreeUnavailable => 'Árbol de trabajo no disponible';

  @override
  String get gitActionsLabel => 'Acciones de Git';

  @override
  String get gitRefreshStatus => 'Actualizar estado de Git';

  @override
  String get gitShowMenu => 'Mostrar menú';

  @override
  String get gitInitializeRepository => 'Inicializar repositorio';

  @override
  String get gitCreateBranch => 'Crear rama';

  @override
  String get gitTransferToWorkspace =>
      'Transferir cambios al espacio de trabajo';

  @override
  String get gitRemoveManagedWorktree => 'Quitar árbol de trabajo administrado';

  @override
  String get gitGeneratePrDraft => 'Generar borrador de PR';

  @override
  String get gitCreatePullRequest => 'Crear pull request';

  @override
  String get gitCommitAndPushMenu => 'Commit y push';

  @override
  String get gitCommitPushCreatePrMenu => 'Commit, push y crear PR';

  @override
  String get gitDiscardAndReset => 'Descartar y restablecer al remoto';

  @override
  String get gitWorktreeReady => 'Árbol de trabajo listo';

  @override
  String get gitOpenChat => 'Abrir chat';

  @override
  String get gitOpenPullRequest => 'Abrir pull request';

  @override
  String get gitDetachedHead => 'HEAD separado';

  @override
  String get gitNoUpstream => 'Sin rama upstream';

  @override
  String gitAheadBehind(int ahead, int behind) {
    return '$ahead adelante · $behind atrás';
  }

  @override
  String get gitCommitChanges => 'Hacer commit de cambios';

  @override
  String get gitPush => 'Push';

  @override
  String get gitPullTitle => '¿Hacer pull de cambios?';

  @override
  String get gitPull => 'Pull';

  @override
  String get gitViewDiff => 'Ver diferencias';

  @override
  String get gitCurrentBranch => 'Rama actual';

  @override
  String get gitBranchFallback => 'Rama';

  @override
  String get gitWriterModel => 'Modelo para Git';

  @override
  String get gitConnectCodexModel =>
      'Conecta un modelo de Codex en tu Mac para generar mensajes de commit y borradores de PR.';

  @override
  String gitChangedFilesCount(int count) {
    return '$count archivos modificados';
  }

  @override
  String get gitActionInitialize => 'Inicializar Git';

  @override
  String get gitActionChanges => 'Cambios';

  @override
  String get gitActionCommit => 'Commit';

  @override
  String get gitActionCommitAndPush => 'Commit y push';

  @override
  String get gitActionCommitPushPr => 'Commit, push y PR';

  @override
  String get gitActionCreatePr => 'Crear PR';

  @override
  String get gitSectionSetup => 'Configuración';

  @override
  String get gitSectionWrite => 'Escribir';

  @override
  String get gitStatusNotInitialized => 'Git no está inicializado';

  @override
  String get gitStatusUpToDate => 'Repositorio al día';

  @override
  String get gitStatusAheadOnly => 'La rama local va por delante del remoto';

  @override
  String get gitStatusBehindOnly => 'La rama remota va por delante de la local';

  @override
  String get gitStatusDiverged => 'Las ramas local y remota divergieron';

  @override
  String get gitStatusDirty => 'El repositorio local tiene cambios sin commit';

  @override
  String get gitStatusDirtyAndBehind =>
      'Hay cambios locales y la rama remota avanzó';

  @override
  String get gitStatusNoUpstream => 'Rama aún no publicada';

  @override
  String get gitStatusDetachedHead => 'Rama actual no disponible';

  @override
  String get gitStatusUnavailable => 'Estado del repositorio no disponible';

  @override
  String gitReviewLocalCommits(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count commits locales',
      one: '1 commit local',
    );
    return '$_temp0';
  }

  @override
  String get gitReviewTheCurrentBranch => 'la rama actual';

  @override
  String gitReviewCreatingFrom(String name, String source) {
    return 'Estás creando “$name” a partir de $source. Lleva tus cambios locales a la nueva rama, o haz commit primero y luego crea y cambia.';
  }

  @override
  String gitReviewCommitsStayPrefix(
    String base,
    String commits,
    String message,
  ) {
    return '$base ya tiene $commits que no están en el remoto. Esos commits se quedan en el historial de $base. $message';
  }

  @override
  String get gitReviewFilesWithChanges => 'Archivos con cambios locales:';

  @override
  String gitReviewMoreFiles(int count) {
    return '+$count archivos más';
  }

  @override
  String gitReviewBringChangesTitle(String name) {
    return '¿Llevar los cambios locales a “$name”?';
  }

  @override
  String get gitReviewCarryToNewBranch => 'Llevar a la nueva rama';

  @override
  String gitReviewCommitsStayTitle(String base) {
    return 'Los commits locales se quedan en $base';
  }

  @override
  String gitReviewBranchCommitsStay(String base, String commits, String name) {
    return '$base ya tiene $commits que no están en el remoto. Crear “$name” ahora inicia la nueva rama desde el HEAD actual, pero esos commits se quedan en el historial de $base.';
  }

  @override
  String get gitReviewCreateAnyway => 'Crear de todos modos';

  @override
  String get gitReviewManagedWorktreeNoun => 'un árbol de trabajo administrado';

  @override
  String gitReviewQuotedName(String name) {
    return '“$name”';
  }

  @override
  String get gitReviewCopyTitle => 'Copiar cambios locales de la rama actual';

  @override
  String get gitReviewMoveTitle => 'Mover cambios locales de la rama actual';

  @override
  String get gitReviewVerbCopy => 'copiar';

  @override
  String get gitReviewVerbMove => 'mover';

  @override
  String gitReviewOnlyCurrentBranch(
    String target,
    String verb,
    String current,
  ) {
    return 'Al crear $target solo se pueden $verb cambios locales de la rama actual. Cambia la rama base a “$current” o limpia los cambios locales antes de crear el árbol de trabajo.';
  }

  @override
  String gitReviewCopiedInto(String worktree) {
    return ' Los cambios locales también se copiarán a $worktree; los archivos ignorados se quedan aquí.';
  }

  @override
  String gitReviewMovedInto(String worktree) {
    return ' Los cambios locales se moverán a $worktree; los archivos ignorados se quedan aquí.';
  }

  @override
  String get gitReviewTheManagedWorktree => 'el árbol de trabajo administrado';

  @override
  String get gitReviewTheNewWorktree => 'el nuevo árbol de trabajo';

  @override
  String gitReviewWorktreeCommitsStay(
    String base,
    String commits,
    String target,
    String from,
    String suffix,
  ) {
    return '$base ya tiene $commits que no están en el remoto. Crear $target a partir de $from empieza desde el HEAD actual, pero esos commits también se quedan en el historial de $base.$suffix';
  }

  @override
  String get gitBadgeOpenWorktree => 'Abrir árbol de trabajo';

  @override
  String get gitBadgeOpenElsewhere => 'Abierta en otro lugar';

  @override
  String get gitActionCompleted => 'Acción de Git completada.';

  @override
  String gitActionFailed(String error) {
    return '$error Actualiza antes de reintentar una acción cuyo resultado se desconoce.';
  }

  @override
  String get gitDismissMenu => 'Cerrar menú';

  @override
  String get gitDiffPatch => 'Parche';

  @override
  String gitDiffLine(int line) {
    return 'Línea $line';
  }

  @override
  String gitDiffLines(int first, int last) {
    return 'Líneas $first-$last';
  }

  @override
  String get gitDismissBranchPicker => 'Cerrar selector de ramas';

  @override
  String get gitBadgeCurrent => 'Actual';

  @override
  String get gitBadgeDefault => 'Predeterminada';

  @override
  String get gitCloseBranchPicker => 'Cerrar selector de ramas';

  @override
  String get gitBranchPickerStale =>
      'El hilo o la computadora cambió. Cierra y vuelve a abrir el selector de ramas.';

  @override
  String get gitSearchBranches => 'Buscar ramas';

  @override
  String get gitClearBranchSearch => 'Borrar búsqueda de ramas';

  @override
  String get gitBranches => 'Ramas';

  @override
  String get gitNoBranchesFound => 'No se encontraron ramas';

  @override
  String get gitNoBranchesHint =>
      'Prueba otra búsqueda o actualiza la lista de ramas.';

  @override
  String gitCreateAndCheckout(String name) {
    return 'Crear y cambiar a “$name”';
  }

  @override
  String get gitNewBranchEllipsis => 'Nueva rama...';

  @override
  String get gitSwitching => 'Cambiando...';

  @override
  String get gitRefreshing => 'Actualizando...';

  @override
  String get gitReloadBranchList => 'Recargar lista de ramas';

  @override
  String get gitCloseWorktreeReview => 'Cerrar revisión del árbol de trabajo';

  @override
  String get gitHandoffTitle => 'Pasar el hilo a un árbol de trabajo';

  @override
  String get gitForkTitle => 'Bifurcar el hilo en un nuevo árbol de trabajo';

  @override
  String get gitHandoff => 'Pasar';

  @override
  String get gitFork => 'Bifurcar';

  @override
  String get gitHandoffMessage =>
      'Crea una rama en un nuevo árbol de trabajo y cámbiate a ella para seguir en paralelo. La rama se normaliza con el prefijo djl/.';

  @override
  String get gitForkMessage =>
      'Crea una rama en un nuevo árbol de trabajo y cámbiate a ella; luego bifurca esta conversación en esa copia como un chat nuevo.';

  @override
  String get gitStartsFromBase => 'Empieza desde esta rama base.';

  @override
  String get gitLoadingWorktreeBranches =>
      'Cargando ramas del árbol de trabajo';

  @override
  String get gitPreparingWorktree => 'Preparando árbol de trabajo';

  @override
  String get gitNewBranch => 'Nueva rama';

  @override
  String get gitNewBranchBody =>
      'La rama se creará localmente y se cambiará a ella. Los cambios sin commit se quedan en esta copia de trabajo.';

  @override
  String get gitThreadChangedReopenGit =>
      'La actividad del hilo cambió. Cierra y vuelve a abrir esta acción de Git.';

  @override
  String get gitRepositoryChanges => 'Cambios del repositorio';

  @override
  String gitFilesChanged(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count archivos modificados',
      one: '1 archivo modificado',
    );
    return '$_temp0';
  }

  @override
  String get gitExpandAll => 'Expandir todo';

  @override
  String get gitCollapseAll => 'Contraer todo';

  @override
  String gitPatchIndex(int index, int total) {
    return 'Parche $index de $total';
  }

  @override
  String get chatUiComposerOptions => 'Opciones del editor';

  @override
  String get chatUiStopDictation => 'Detener dictado';

  @override
  String get chatUiStartDictation => 'Iniciar dictado';

  @override
  String get chatUiResumeQueued => 'Reanudar mensajes en cola';

  @override
  String get chatUiStopTurn => 'Detener turno';

  @override
  String get chatUiSendToDesktop => 'Enviar a la computadora';

  @override
  String get chatUiStartingRun => 'Iniciando ejecución';

  @override
  String get chatUiRemoveImage => 'Quitar imagen';

  @override
  String get chatUiAttachedImage => 'Imagen adjunta';

  @override
  String chatUiDesktopImage(String source) {
    return 'Imagen de la computadora: $source';
  }

  @override
  String get chatUiImagePreviewUnavailable => 'Vista previa no disponible';

  @override
  String get chatUiContextSkills => 'Habilidades';

  @override
  String get chatUiContextPlugins => 'Complementos';

  @override
  String get chatUiContextFiles => 'Archivos';

  @override
  String chatUiContextUnsupported(String kind) {
    return 'Este entorno de la computadora no admite $kind.';
  }

  @override
  String get chatUiContextStale =>
      'La conversación cambió. Vuelve a abrir el selector de contexto.';

  @override
  String get chatUiContextRetry => 'Reintentar búsqueda';

  @override
  String chatUiContextSearchFilesIn(String path) {
    return 'Buscar archivos en $path';
  }

  @override
  String get chatUiContextSelectFolder =>
      'Selecciona una carpeta de proyecto para buscar archivos en la computadora.';

  @override
  String chatUiContextNoneFound(String kind) {
    return 'No se encontraron $kind.';
  }

  @override
  String get chatUiAddDesktopContext => 'Agregar contexto de la computadora';

  @override
  String get chatUiContextSearchFiles => 'Buscar archivos en tu computadora';

  @override
  String chatUiContextSearchKind(String kind) {
    return 'Buscar $kind';
  }

  @override
  String get chatUiContextDisabled => 'Desactivado en la computadora';

  @override
  String get chatUiContextOnDesktop => 'En la computadora vinculada';

  @override
  String get chatUiEmptyGeneralTitle => '¿En qué trabajamos?';

  @override
  String get chatUiEmptyFolderPrefix => '¿Qué hacemos en ';

  @override
  String get chatUiEmptyFolderSuffix => '?';

  @override
  String get chatUiEmptyGreeting => '¡Hola! ¿En qué te puedo ayudar?';

  @override
  String get chatUiEncryptedCaption =>
      'Los chats tienen cifrado de extremo a extremo';

  @override
  String get chatUiUserMessage => 'Mensaje del usuario';

  @override
  String get chatUiAssistantMessage => 'Mensaje del asistente';

  @override
  String get chatUiThreadActions => 'Acciones del hilo';

  @override
  String get chatUiBranchesAndWorktrees => 'Ramas y árboles de trabajo';

  @override
  String get chatUiGitActions => 'Acciones de Git';

  @override
  String get chatUiWorking => 'Trabajando…';

  @override
  String get chatUiScrollToLatest => 'Ir al último mensaje';

  @override
  String get chatUiSavedToPhotos => 'Se guardó en Fotos.';

  @override
  String get chatUiShareImageFailed =>
      'No se pudo compartir esta imagen. Vuelve a intentarlo.';

  @override
  String get chatUiSaveImageFailed =>
      'No se pudo guardar esta imagen. Vuelve a intentarlo.';

  @override
  String get chatUiLoadImageFailed => 'No se pudo cargar esta imagen.';

  @override
  String get chatUiRetry => 'Reintentar';

  @override
  String get chatUiImageReopenWorkspace =>
      'Vuelve a conectarte o abre esta imagen de nuevo desde su espacio de trabajo.';

  @override
  String get chatUiImageReopenChat =>
      'Abre esta imagen de nuevo desde su chat vinculado.';

  @override
  String chatUiOpenImage(String name) {
    return 'Abrir imagen $name';
  }

  @override
  String get chatUiClose => 'Cerrar';

  @override
  String get chatUiShare => 'Compartir';

  @override
  String get chatUiSaveToPhotos => 'Guardar en Fotos';

  @override
  String get chatUiModelsGroup => 'Modelos';

  @override
  String get chatUiRefreshModels => 'Actualizar modelos';

  @override
  String get chatUiProviderAndModel => 'Proveedor y modelo';

  @override
  String get chatUiDone => 'Listo';

  @override
  String get chatUiAllProviders => 'Todos los proveedores';

  @override
  String get chatUiModelsConnectionChanged =>
      'La conexión cambió. Vuelve a abrir la selección de modelo.';

  @override
  String get chatUiLoadingModels => 'Cargando modelos';

  @override
  String get chatUiNoModels => 'No hay modelos disponibles';

  @override
  String get chatUiNoModelsHint =>
      'Conecta un proveedor en DJL en tu computadora y luego actualiza la lista de modelos.';

  @override
  String get chatUiNoMatchingModels => 'No hay modelos que coincidan';

  @override
  String get chatUiSearchModels => 'Buscar proveedores o modelos';

  @override
  String get chatUiClearModelSearch => 'Borrar búsqueda de modelos';

  @override
  String get chatUiNavCloudChat => 'Chat en la nube';

  @override
  String get chatUiNavRemote => 'Remoto';

  @override
  String get chatUiNavSearchFailed => 'No se pudieron buscar los chats.';

  @override
  String get chatUiNavRetrySearch => 'Reintentar búsqueda';

  @override
  String get chatUiNavSearching => 'Buscando chats…';

  @override
  String get chatUiNavPinned => 'Fijados';

  @override
  String get chatUiNavPinnedEmpty =>
      'Ten tus chats favoritos a mano.\nMantén presionado un chat para fijarlo.';

  @override
  String get chatUiNavRecent => 'Chats recientes';

  @override
  String get chatUiNavRecentEmpty => 'Tus chats aparecerán aquí.';

  @override
  String get chatUiNoMatchingChats => 'No hay chats que coincidan';

  @override
  String get chatUiCloseSearch => 'Cerrar búsqueda';

  @override
  String get chatUiSearchChats => 'Buscar chats';

  @override
  String get chatUiChatButton => 'Chat';

  @override
  String get chatUiNewChat => 'Nuevo chat';

  @override
  String get chatUiSettings => 'Configuración';

  @override
  String get chatUiMoreActions => 'Más acciones';

  @override
  String get chatUiMenuNewChat => 'Nuevo chat';

  @override
  String get chatUiMenuQuickChat => 'Chat rápido';

  @override
  String get chatUiMenuNewProject => 'Nuevo proyecto';

  @override
  String get chatUiMenuConnections => 'Conexiones';

  @override
  String get chatUiMenuSecurePairing => 'Detalles de la vinculación segura';

  @override
  String get chatUiMenuYourMac => 'Tu Mac';

  @override
  String get chatUiMenuActiveChats => 'Chats activos';

  @override
  String get chatUiArchivedChats => 'Chats archivados';

  @override
  String get chatUiMenuRefresh => 'Actualizar';

  @override
  String get chatUiMenuDisconnect => 'Desconectar';

  @override
  String get chatUiOpenNavigation => 'Abrir navegación';

  @override
  String get chatUiSearchConversations => 'Buscar conversaciones';

  @override
  String get chatUiDismissSearch => 'Cerrar búsqueda';

  @override
  String get chatUiStatusConnecting => 'Conectando';

  @override
  String get chatUiStatusDeviceOffline => 'Dispositivo sin conexión';

  @override
  String chatUiStatusDeviceOfflineSince(String time) {
    return 'En reposo o sin conexión desde las $time';
  }

  @override
  String get chatUiStatusOffline => 'Sin conexión';

  @override
  String chatUiConnectionStatus(String status) {
    return 'Estado de la conexión: $status';
  }

  @override
  String get chatUiGroups => 'Grupos';

  @override
  String get homeTabChats => 'Chats';

  @override
  String get chatUiExpandAll => 'Expandir todo';

  @override
  String get chatUiCollapseAll => 'Contraer todo';

  @override
  String chatUiCollapseChildChats(String title) {
    return 'Contraer los chats secundarios de $title';
  }

  @override
  String chatUiExpandChildChats(String title) {
    return 'Expandir los chats secundarios de $title';
  }

  @override
  String get chatUiDesktopChatActions => 'Acciones del chat de la computadora';

  @override
  String get chatUiArchiveProject => 'Archivar proyecto';

  @override
  String get chatUiRemoveFromPhone => 'Quitar del teléfono';

  @override
  String chatUiArchiveProjectTitle(String name) {
    return '¿Archivar “$name”?';
  }

  @override
  String get chatUiArchiveProjectBody =>
      'Se archivarán todos los chats activos de este proyecto.';

  @override
  String chatUiRemoveProjectTitle(String name) {
    return '¿Quitar “$name” de este teléfono?';
  }

  @override
  String get chatUiRemoveProjectBody =>
      'Los chats de este proyecto se eliminarán solo de DJL en este teléfono. No se borra nada de tu dispositivo ni del observador de Codex.';

  @override
  String chatUiExpandProject(String name) {
    return 'Expandir proyecto $name';
  }

  @override
  String chatUiCollapseProject(String name) {
    return 'Contraer proyecto $name';
  }

  @override
  String chatUiNewChatIn(String name) {
    return 'Nuevo chat en $name';
  }

  @override
  String get chatUiNewGroup => 'Nuevo grupo';

  @override
  String get chatUiGroupButton => 'Grupo';

  @override
  String get chatUiOfflineSavedChats =>
      'Sin conexión · mostrando chats guardados';

  @override
  String get chatUiReconnect => 'Reconectar';

  @override
  String get chatUiNoMatchingChatsPeriod => 'No hay chats que coincidan.';

  @override
  String get chatUiNoStudioThreads => 'No hay hilos de Studio';

  @override
  String get chatUiNoProjectChats => 'No hay chats de proyecto';

  @override
  String get desktopAttentionApproval => 'Necesita aprobación';

  @override
  String get desktopAttentionQuestion => 'El agente tiene una pregunta';

  @override
  String get desktopAttentionFailedRun => 'La ejecución falló';

  @override
  String get desktopAttentionBlockedGoal => 'El objetivo necesita atención';

  @override
  String get desktopAttentionCompletedRun => 'Listo para revisar';

  @override
  String get desktopFailurePermission =>
      'Revisa el acceso solicitado o cambia el modo de acceso de este chat y vuelve a ejecutarlo.';

  @override
  String get desktopFailureSignIn =>
      'Vuelve a iniciar sesión en tu Mac y luego reintenta la ejecución.';

  @override
  String get desktopFailureTimeout =>
      'Revisa la conexión con la Mac y luego reintenta la ejecución.';

  @override
  String get desktopFailureNetwork =>
      'Comprueba que la Mac y el relay estén en línea y luego reintenta la ejecución.';

  @override
  String get desktopFailureCheck =>
      'Abre el chat para revisar la comprobación que falla, corrígela y vuelve a intentarlo.';

  @override
  String get desktopFailureGeneric =>
      'Abre el chat para revisar el último paso, corrige el problema y vuelve a intentarlo.';

  @override
  String desktopAttentionAllowCommand(String command) {
    return '¿Permitir que Codex ejecute “$command”?';
  }

  @override
  String get desktopAttentionAwaitingPermission =>
      'Codex espera tu permiso para continuar.';

  @override
  String get desktopAttentionAnswerAgent =>
      'Abre el chat para responder al agente.';

  @override
  String get desktopGoalBlocked =>
      'El objetivo está bloqueado. Abre el chat para ver qué necesita el agente.';

  @override
  String get desktopGoalUsageLimited =>
      'Los límites de uso pausaron este objetivo. Revisa el chat antes de reanudarlo.';

  @override
  String get desktopGoalBudgetLimited =>
      'El objetivo alcanzó su presupuesto. Revisa el resultado antes de decidir qué hacer.';

  @override
  String get desktopRunFinishedReview =>
      'La ejecución terminó. Revisa el resultado y los cambios en archivos antes de continuar.';

  @override
  String get desktopScopeStudio => 'Studio';

  @override
  String get desktopScopeProjects => 'Proyectos';

  @override
  String get desktopNoProject => 'Sin proyecto';

  @override
  String get desktopGroupPinned => 'Fijados';

  @override
  String get desktopUntitledChat => 'Chat sin título';

  @override
  String get desktopComposerTooManyImages =>
      'Elige cuatro imágenes como máximo.';

  @override
  String get desktopContextIncomplete =>
      'Un contexto seleccionado está incompleto. Quítalo y vuelve a seleccionarlo.';

  @override
  String get desktopApproveForMeUnsupported =>
      'Este entorno no admite Aprobar por mí. Actualiza Codex en tu Mac y vuelve a intentarlo.';

  @override
  String get desktopEnterChatName => 'Escribe un nombre para el chat.';

  @override
  String get desktopContextPickerStale =>
      'La computadora conectada cambió. Vuelve a abrir el selector de contexto.';

  @override
  String get desktopNoSkillList =>
      'La computadora no devolvió la lista de habilidades.';

  @override
  String get desktopNoPluginList =>
      'La computadora no devolvió la lista de complementos.';

  @override
  String get desktopNoFileMatches =>
      'La computadora no devolvió archivos que coincidan.';

  @override
  String get desktopPairedDisconnectedOrChanged =>
      'La computadora vinculada se desconectó o cambió.';

  @override
  String get desktopPairedChangedRefreshOverview =>
      'La computadora vinculada cambió. Actualiza su resumen.';

  @override
  String get desktopPairedChangedRefreshChats =>
      'La computadora vinculada cambió. Actualiza sus chats.';

  @override
  String get desktopIdentityMismatch =>
      'La identidad de la computadora o el protocolo seguro no coinciden con la vinculación.';

  @override
  String get desktopHandshakeUnverified =>
      'No se pudo verificar la firma del enlace seguro con la computadora.';

  @override
  String get desktopHandshakeTimedOut =>
      'Se agotó el tiempo del enlace seguro con la computadora.';

  @override
  String get desktopSecureConnectionRefused =>
      'La computadora rechazó la conexión segura.';

  @override
  String get desktopHandshakeInterrupted =>
      'La conexión con la computadora se interrumpió durante el enlace seguro.';

  @override
  String get desktopSecureConnectionRejected =>
      'Se rechazó la conexión segura con la computadora.';

  @override
  String get desktopInvalidFrame => 'Trama de la computadora no válida.';

  @override
  String get desktopSecureTransportFailed =>
      'Falló el transporte seguro con la computadora.';

  @override
  String get desktopUnencryptedRejected =>
      'Se rechazó tráfico sin cifrar de la app de la computadora.';

  @override
  String get desktopPayloadDecodeFailed =>
      'No se pudo decodificar parte de los datos de la computadora.';

  @override
  String get desktopRequestFailed => 'Falló la solicitud a la computadora.';

  @override
  String get desktopIsDisconnected => 'La computadora está desconectada.';

  @override
  String get desktopConnectionChanged =>
      'La conexión con la computadora cambió.';

  @override
  String get desktopRequestTimedOut =>
      'Se agotó el tiempo de la solicitud a la computadora. Su resultado es desconocido; actualiza antes de reintentar.';

  @override
  String get desktopDisconnectedRefresh =>
      'La computadora se desconectó; actualiza antes de reintentar una acción.';

  @override
  String get desktopVerifiedHostRequired =>
      'Se necesita un host verificado guardado.';

  @override
  String get desktopResponseFailed =>
      'La computadora no pudo completar esta respuesta. Revisa la configuración del proveedor y vuelve a intentarlo.';

  @override
  String get desktopWaitBeforeMovingProject =>
      'Espera a que termine la operación actual del chat antes de mover su proyecto.';

  @override
  String get desktopProviderUnavailable =>
      'El proveedor de esta conversación no está disponible. Conéctalo en tu computadora o elige otro proveedor.';

  @override
  String get desktopReopenBeforeRestore =>
      'Vuelve a abrir este chat para verificar el turno antes de restaurar cambios.';

  @override
  String get desktopSwitchCancelled =>
      'Cambio cancelado. Elige un dispositivo para reconectar.';

  @override
  String get desktopSelectionClearUnconfirmed =>
      'No se pudo confirmar que se borró la selección guardada. Desbloquea tu dispositivo y elige una Mac guardada para recuperarla.';

  @override
  String get desktopLinkIdentityUnavailable =>
      'La identidad de la Mac guardada para este enlace no está disponible. Abre el chat desde una Mac verificada.';

  @override
  String get desktopChooseMatchingMac =>
      'Elige la Mac guardada que corresponde a este enlace. Su identidad verificada debe coincidir.';

  @override
  String get desktopWaitingForMac =>
      'Esperando la Mac seleccionada. Vuelve a intentarlo cuando esté disponible.';

  @override
  String get desktopLinkedConversationUnavailable =>
      'La conversación vinculada de la computadora no está disponible.';

  @override
  String get desktopLinkedConversationLoadFailed =>
      'No se pudo cargar la conversación vinculada. Vuelve a intentarlo en la Mac seleccionada.';

  @override
  String get desktopDevicePreferencesLoadFailed =>
      'No se pudieron cargar las preferencias locales del dispositivo. Desbloquea tu dispositivo y vuelve a intentarlo.';

  @override
  String get desktopSavedDesktopsOpenFailed =>
      'No se pudieron abrir las computadoras guardadas. Desbloquea tu dispositivo y vuelve a intentarlo.';

  @override
  String get desktopModelUnavailable =>
      'El modelo seleccionado no está disponible en la computadora. Elige un modelo disponible.';

  @override
  String get desktopStopRunsUnconfirmed =>
      'No se pudo confirmar que se detuvieron las ejecuciones; puede que sigan en curso en la otra Mac.';

  @override
  String get desktopPairingIdentityReadFailed =>
      'No se pudo leer tu identidad de vinculación segura. Desbloquea tu dispositivo y elige Reconectar.';

  @override
  String get desktopRuntimeOtherHistory =>
      'El entorno devolvió el historial de otro chat.';

  @override
  String get desktopLinkedHistoryUnverified =>
      'No se pudo verificar el historial de la conversación vinculada.';

  @override
  String get desktopIdleChatAndProjectRequired =>
      'Se necesitan el chat actual inactivo y un proyecto válido.';

  @override
  String get desktopProjectChangeUnverified =>
      'El entorno no verificó el cambio de proyecto de este chat.';

  @override
  String get desktopForkUnidentified =>
      'El entorno no identificó la bifurcación creada. Actualiza antes de volver a intentarlo.';

  @override
  String get desktopForkNotSeparate =>
      'El entorno no creó una conversación separada.';

  @override
  String get desktopForkUnsupported =>
      'Este entorno no admite bifurcar conversaciones. Actualiza DJL en tu computadora y vuelve a intentarlo.';

  @override
  String get desktopReadSettingsFirst =>
      'Lee la configuración guardada antes de crear un chat nuevo.';

  @override
  String get desktopConnectMacWithModels =>
      'Conecta una Mac con modelos disponibles antes de crear un chat nuevo.';

  @override
  String get desktopChatCreatedElsewhere =>
      'La computadora creó el chat en otra carpeta de proyecto. Se conservó tu borrador local.';

  @override
  String get desktopDraftContextOtherFolder =>
      'El contexto del borrador pertenece a otra carpeta de proyecto. Quítalo y vuelve a seleccionar el contexto.';

  @override
  String get desktopQueuedPlanModelRequired =>
      'Elige un modelo disponible que admita el modo de planificación antes de enviar este borrador en cola.';

  @override
  String get desktopChooseModelFirst =>
      'Primero elige un modelo disponible en la computadora.';

  @override
  String get desktopRunChangedBeforeQueue =>
      'La ejecución activa cambió antes de enviar la cola. Actualiza antes de reanudar.';

  @override
  String get desktopRunChangedBeforeSteer =>
      'La ejecución activa cambió. Actualiza antes de volver a guiarla.';

  @override
  String get desktopModelBeforeLeavingPlan =>
      'Elige un modelo disponible antes de salir del modo de planificación.';

  @override
  String get desktopPlanModeUnsupported =>
      'Este entorno no admite el modo de planificación. Se envió como un turno normal.';

  @override
  String get desktopRunIdPending =>
      'La ejecución activa aún no publicó su ID. Vuelve a intentarlo en un momento.';

  @override
  String get desktopRuntimeOtherTurnPage =>
      'El entorno devolvió la página de turnos de otro chat.';

  @override
  String get desktopRuntimeNoTurnState =>
      'El entorno no devolvió el estado del turno de este chat.';

  @override
  String get desktopRuntimeInvalidTurnState =>
      'El entorno devolvió un estado de turno no válido.';

  @override
  String get desktopRetryApprovalUnacknowledged =>
      'La computadora no confirmó la aprobación para reintentar.';

  @override
  String get desktopDeviceFallbackName => 'Dispositivo';

  @override
  String get desktopDeviceChangeUnconfirmed =>
      'No se pudo confirmar el cambio. Revisa el nombre guardado y vuelve a intentarlo. Si este dispositivo se olvidó o se reemplazó, cierra y vuelve a abrir el editor.';

  @override
  String get desktopPreferencesReloadFailed =>
      'No se pudieron confirmar ni recargar las preferencias locales. Desbloquea tu dispositivo y vuelve a intentarlo antes de guardar otra vez.';

  @override
  String get desktopRunChangedBeforePlan =>
      'La ejecución activa cambió. Actualiza antes de implementar este plan.';

  @override
  String get desktopQueueMessageArrived =>
      'El mensaje llegó. Revisa su resultado antes de reanudar los mensajes en cola.';

  @override
  String get desktopQueueDeliveryUnconfirmed =>
      'No se confirmó el envío de la cola. Vuelve a abrir este chat antes de reintentar.';

  @override
  String get desktopRequestFromEarlierSession =>
      'Esta solicitud pertenece a una sesión anterior de la computadora. Actualiza el chat.';

  @override
  String get desktopUndoReconnect =>
      'Vuelve a conectarte a tu computadora antes de revisar el deshacer.';

  @override
  String get desktopUndoReopen =>
      'Vuelve a abrir este chat para verificar la respuesta antes de deshacer cambios.';

  @override
  String get desktopUndoRepoBusy =>
      'Hay un chat en ejecución en este repositorio. Espera antes de deshacer una respuesta.';

  @override
  String get desktopUndoWaitResponse =>
      'Espera a que termine la respuesta activa antes de deshacer cambios.';

  @override
  String get desktopUndoPersistFailed =>
      'No se pudo guardar el resultado de deshacer.';

  @override
  String get desktopUndoRepoUnverified =>
      'No se pudo verificar el repositorio de la respuesta. Vuelve a conectarte y revísalo otra vez.';

  @override
  String get desktopReconnectToRefreshModels =>
      'Vuelve a conectar la computadora para actualizar los modelos.';

  @override
  String get desktopAccessModeNotApplied =>
      'La computadora no aplicó el modo de acceso solicitado.';

  @override
  String get desktopSubagentOfflineCached =>
      'Sin conexión · detalles guardados';

  @override
  String get desktopSubagentLoading => 'Cargando detalles del agente';

  @override
  String get desktopSubagentLoaded => 'Detalles cargados';

  @override
  String get desktopSubagentIdentityUnknown =>
      'Identidad del agente desconocida';

  @override
  String get desktopSubagentLoadFailed =>
      'No se pudieron cargar los detalles del agente';

  @override
  String get desktopSavedDeviceChanged =>
      'Este dispositivo guardado cambió. Vuelve a elegirlo.';

  @override
  String get desktopMacIdentityMismatch =>
      'La identidad de la Mac seleccionada no coincide.';

  @override
  String get desktopOfflineChatsOpenFailed =>
      'No se pudieron abrir los chats sin conexión. Desbloquea tu dispositivo o vuelve a conectarte para cargarlos.';

  @override
  String get desktopOfflineChatsSaveFailed =>
      'No se pudieron guardar los chats sin conexión. Desbloquea tu dispositivo y vuelve a intentarlo.';

  @override
  String get desktopChoosePairedDesktop => 'Elige una computadora vinculada.';

  @override
  String get desktopSavedLocallyUnconfirmed =>
      'Se guardó en este dispositivo. No se pudo confirmar el cambio en tu computadora; actualiza antes de reintentar.';

  @override
  String get desktopImageEmptyOrTooLarge =>
      'La imagen seleccionada está vacía o es demasiado grande. Elige una imagen más pequeña.';

  @override
  String get desktopImageUnsupported =>
      'El archivo seleccionado no es una imagen compatible.';

  @override
  String get desktopImageResizeFailed =>
      'Este dispositivo no pudo cambiar el tamaño de la imagen. Elige una imagen de 1600 píxeles como máximo.';

  @override
  String get desktopImageTooLarge =>
      'La imagen seleccionada es demasiado grande. Elige una imagen más pequeña.';

  @override
  String get desktopContextFolderChanged =>
      'La carpeta del proyecto cambió. Quita el contexto existente o vuelve a su carpeta original.';

  @override
  String get desktopPickerOpenFailed =>
      'No se pudo abrir el selector. Vuelve a intentarlo.';

  @override
  String get desktopWorktreeStale =>
      'La computadora conectada o el chat cambiaron. Vuelve a abrir esta acción del árbol de trabajo.';

  @override
  String get desktopNotGitRepository =>
      'Esta carpeta ya no es un repositorio Git.';

  @override
  String get desktopBranchAlreadyExists => 'La rama ya existe';

  @override
  String get desktopWorktreeUnidentified =>
      'La computadora no identificó un nuevo árbol de trabajo. Actualiza antes de volver a intentarlo.';

  @override
  String get desktopForkUnverified =>
      'No se pudo verificar el resultado de la bifurcación.';

  @override
  String get desktopHandoffUnverified =>
      'La computadora no verificó el destino del traspaso. Revisa ambas carpetas antes de reintentar.';

  @override
  String get desktopWorktreePathUnavailable =>
      'La ruta del árbol de trabajo no está disponible.';

  @override
  String get desktopLocalCheckoutUnresolved =>
      'No se pudo encontrar la copia local vinculada a este árbol de trabajo.';

  @override
  String get desktopWorktreeHandoffFailed =>
      'Falló el traspaso al árbol de trabajo';

  @override
  String get desktopWorktreeForkFailed =>
      'Falló la bifurcación al árbol de trabajo';

  @override
  String desktopAccessModeNotAppliedBy(String method) {
    return '$method no aplicó el modo de acceso seleccionado.';
  }

  @override
  String desktopApprovalReviewerNotApplied(String method) {
    return '$method no aplicó el revisor de aprobaciones seleccionado.';
  }

  @override
  String desktopApprovalPolicyNotApplied(String method) {
    return '$method no aplicó la política de aprobación seleccionada.';
  }

  @override
  String desktopSandboxNotApplied(String method) {
    return '$method no aplicó los permisos de sandbox seleccionados.';
  }

  @override
  String desktopForkResultUnknown(String error) {
    return '$error Es posible que no se sepa el resultado de la bifurcación. Actualiza antes de volver a intentarlo.';
  }

  @override
  String desktopSendResultUnknown(String error) {
    return '$error Es posible que no se sepa si se envió. Actualiza la conversación antes de volver a intentarlo.';
  }

  @override
  String desktopQueuePaused(String reason) {
    return 'Cola en pausa: $reason';
  }

  @override
  String desktopWorktreeExists(String branch) {
    return 'Ya existe un árbol de trabajo para “$branch”. Elige otro nombre.';
  }

  @override
  String desktopRollbackFailed(String reason) {
    return 'No se pudieron devolver automáticamente los cambios rastreados: $reason. Revisa ambas carpetas antes de reintentar.';
  }

  @override
  String desktopWorktreeKeptAt(String path) {
    return 'El nuevo árbol de trabajo se conservó en $path. Revísalo antes de volver a intentarlo.';
  }

  @override
  String get desktopWorktreeMayExist =>
      'Es posible que se haya creado un árbol de trabajo. Se conservó; actualiza y revísalo antes de volver a intentarlo.';

  @override
  String get pairingEnterTenCharCode =>
      'Escribe el código de diez caracteres que aparece en la configuración Remoto de la computadora.';

  @override
  String get pairingSecureRelayRequired =>
      'La vinculación requiere una URL de relay segura.';

  @override
  String get pairingPairedMac => 'Mac vinculada';

  @override
  String get pairingNotAPairingCode =>
      'Esto no es un QR de vinculación de DJL ni un código que se pueda pegar.';

  @override
  String get pairingUpdateDesktop =>
      'Actualiza DJL en tu computadora: esta vinculación usa otro protocolo.';

  @override
  String get pairingProofMismatch =>
      'El código de vinculación o el código QR no coincidió. Genera uno nuevo e inténtalo otra vez.';

  @override
  String get pairingInvalidIdentifier =>
      'Identificador de dispositivo o sesión no válido.';

  @override
  String get pairingInvalidIdentityKey =>
      'Clave de identidad de la computadora no válida.';

  @override
  String get pairingCodeExpired =>
      'Este código de vinculación venció. Genera uno nuevo en tu Mac.';

  @override
  String get pairingPrefsUnavailable =>
      'Las preferencias guardadas del dispositivo no están disponibles.';

  @override
  String get pairingDeviceChangedReopen =>
      'Este dispositivo guardado cambió. Cierra y vuelve a abrir el editor.';

  @override
  String get pairingRecoverSelectionFailed =>
      'No se pudo recuperar la selección guardada. Desbloquea tu dispositivo y vuelve a intentarlo antes de elegir una Mac.';

  @override
  String get pairingDeviceChangedChooseAgain =>
      'El dispositivo guardado cambió. Vuelve a elegirlo.';

  @override
  String get pairingConfirmSavedFailed =>
      'No se pudo confirmar que se guardó la Mac seleccionada. Desbloquea tu dispositivo y elige una Mac guardada para recuperarla.';

  @override
  String get pairingRelayDifferentIdentity =>
      'El relay de confianza devolvió otra identidad de computadora. Vuelve a vincular.';

  @override
  String get pairingRelayTemporarilyUnavailable =>
      'El relay de la computadora no está disponible por el momento.';

  @override
  String get pairingRelayInvalidResponse =>
      'El relay de la computadora devolvió una respuesta no válida.';

  @override
  String get pairingTrustedComputerOffline =>
      'La computadora de confianza está sin conexión.';

  @override
  String get pairingServiceUnavailable =>
      'El servicio de vinculación de la computadora no está disponible.';

  @override
  String get pairingRelayUnreachable =>
      'No se pudo conectar con el relay de la computadora.';

  @override
  String get pairingRelayUnsupportedMethod =>
      'El relay no admite este método de vinculación.';

  @override
  String get pairingRelayRequired => 'Se necesita una URL de relay.';

  @override
  String get pairingEnterOneTimeCode => 'Escribe el código de un solo uso';

  @override
  String get pairingFindCodeHint =>
      'Encuentra tu código en DJL para computadora, en Configuración → Remoto.';

  @override
  String get pairingCodeLabel => 'Código de vinculación';

  @override
  String get pairingRelayConfigured => 'Relay configurado';

  @override
  String get pairingRelaySettings => 'Configuración del relay';

  @override
  String get pairingInProgress => 'Vinculando…';

  @override
  String get pairingPair => 'Vincular';

  @override
  String get pairingSecureDetailsTitle => 'Detalles de la vinculación segura';

  @override
  String get pairingSecureDetailsBody =>
      'Abre DJL en la computadora → Configuración → Remoto. Pega sus datos de vinculación o configura el relay que usa tu código de un solo uso.';

  @override
  String get pairingPasteCode => 'Pegar código de vinculación';

  @override
  String get pairingPayloadHint => 'RMX1:… o JSON del QR';

  @override
  String get pairingPairSecurely => 'Vincular de forma segura';

  @override
  String get pairingRelayUrlLabel => 'URL del relay de la computadora';

  @override
  String get pairingSwitchDeviceTitle => '¿Cambiar de dispositivo?';

  @override
  String get pairingSwitchDeviceBody =>
      'DJL intentará detener las ejecuciones en curso en esta Mac y cargará los chats del otro dispositivo.';

  @override
  String get pairingSwitch => 'Cambiar';

  @override
  String get pairingCancellingSwitch => 'Cancelando el cambio…';

  @override
  String get pairingSwitchingDevice => 'Cambiando de dispositivo…';

  @override
  String get pairingCancelSwitch => 'Cancelar cambio';

  @override
  String get pairingChooseMatchingMac =>
      'Elige la Mac guardada que coincide con la identidad verificada de este enlace.';

  @override
  String get pairingChooseMacForLink =>
      'Elige una Mac guardada para abrir la conversación vinculada.';

  @override
  String get pairingOpeningLinkedConversation =>
      'Abriendo la conversación vinculada de la computadora…';

  @override
  String get pairingRetryDesktopLink => 'Reintentar enlace';

  @override
  String get pairingCancelDesktopLink => 'Cancelar enlace';

  @override
  String get pairingMatchesLinkIdentity =>
      'Coincide con la identidad verificada de este enlace';

  @override
  String get pairingDifferentIdentity => 'Otra identidad de computadora';

  @override
  String get pairingSavedVerifiedIdentity =>
      'Identidad de computadora guardada y verificada';

  @override
  String get pairingReconnect => 'Reconectar';

  @override
  String get pairingConnections => 'Conexiones';

  @override
  String get pairingScanQrCode => 'Escanear código QR';

  @override
  String get pairingPairWithCode => 'Vincular con código';

  @override
  String get pairingConnectToDesktop => 'Conectar con DJL para computadora';

  @override
  String get pairingChooseSavedMac => 'Elige una Mac guardada';

  @override
  String get pairingFirstPairingHint =>
      'Abre DJL en tu Mac o PC con Windows y ve a Configuración → Remoto.';

  @override
  String get pairingGetDesktop => 'Descarga DJL para tu Mac o PC';

  @override
  String get pairingScanTitle => 'Escanea el QR de DJL en la computadora';

  @override
  String get pairingCameraDenied =>
      'No hay acceso a la cámara. Puedes pegar el código de vinculación.';

  @override
  String get pairingScanUnsupported =>
      'Este dispositivo no puede escanear códigos QR. Puedes pegar el código de vinculación.';

  @override
  String get pairingCameraUnavailable =>
      'La cámara no está disponible. Puedes pegar el código de vinculación.';

  @override
  String get pairingSwitchDevice => 'Cambiar de dispositivo';

  @override
  String get pairingSwitchTo => 'Cambiar a';

  @override
  String get pairingStatusSwitching => 'Cambiando…';

  @override
  String get pairingStatusConnected => 'Conectado';

  @override
  String get pairingStatusSelected => 'Seleccionado';

  @override
  String get pairingStatusPrevious => 'Anterior';

  @override
  String get pairingStatusSaved => 'Guardado';

  @override
  String get pairingForget => 'Olvidar';

  @override
  String get pairingForgetDeviceTitle => '¿Olvidar este dispositivo?';

  @override
  String pairingForgetDeviceBody(String name) {
    return '$name se quitará de este teléfono. Vuelve a escanear su código QR para reconectar.';
  }

  @override
  String get pairingActiveBadge => 'Activo';

  @override
  String pairingShowInMenu(String name) {
    return 'Mostrar $name en el menú de dispositivos';
  }

  @override
  String get pairingMenuVisibilityUnavailable =>
      'Visibilidad en el menú no disponible';

  @override
  String get pairingClose => 'Cerrar';

  @override
  String get pairingActiveDevice => 'Dispositivo activo';

  @override
  String pairingActiveDeviceNamed(String name) {
    return 'Dispositivo activo, $name';
  }

  @override
  String pairingDevicesInMenu(int count) {
    return '$count dispositivos en el menú';
  }

  @override
  String get pairingDevices => 'Dispositivos';

  @override
  String get pairingNoDevices => 'Aún no hay dispositivos vinculados.';

  @override
  String get pairingScanQr => 'Escanear QR';

  @override
  String get pairingForgetDesktop => 'Olvidar computadora';

  @override
  String get pairingRecencyNow => 'ahora';

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
    return '$count d';
  }

  @override
  String pairingRecencyAgo(String age) {
    return 'hace $age';
  }

  @override
  String pairingRecencyIn(String age) {
    return 'en $age';
  }

  @override
  String get chatUiCloseNavigation => 'Cerrar navegación';

  @override
  String get chatUiRuntime => 'Entorno';

  @override
  String get chatUiContinueIn => 'Continuar en';

  @override
  String get chatUiLocal => 'Local';

  @override
  String get chatUiWorktree => 'Árbol de trabajo';

  @override
  String get chatUiCurrentBranch => 'Rama actual';

  @override
  String get chatUiCollapseProjectControls => 'Contraer controles del proyecto';

  @override
  String get chatUiExpandProjectControls => 'Expandir controles del proyecto';

  @override
  String get chatUiQueuedMessages => 'Mensajes en cola';

  @override
  String get chatUiQueuedHint => 'Muestra los mensajes en cola en una hoja';

  @override
  String get chatUiQueued => 'En cola';

  @override
  String get chatUiQueuedNeedsPlanModel =>
      'Elige un modelo que admita el modo de planificación antes de pasar este borrador al campo de texto.';

  @override
  String chatUiImageCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count imágenes',
      one: '1 imagen',
    );
    return '$_temp0';
  }

  @override
  String get chatUiAttachedContext => 'Contexto adjunto';

  @override
  String get chatUiMoveDraftToInput => 'Pasar borrador al campo de texto';

  @override
  String get chatUiSteerQueued => 'Guiar con el mensaje en cola';

  @override
  String get chatUiSteer => 'Guiar';

  @override
  String get chatUiDeleteQueued => 'Eliminar mensaje en cola';

  @override
  String get chatUiCopyResponse => 'Copiar respuesta';

  @override
  String get chatUiCopied => 'Copiado';

  @override
  String get chatUiEffortLow => 'Bajo';

  @override
  String get chatUiEffortMedium => 'Medio';

  @override
  String get chatUiEffortHigh => 'Alto';

  @override
  String get chatUiEffortExtraHigh => 'Muy alto';

  @override
  String get chatUiLoading => 'Cargando…';

  @override
  String get chatUiSelectModel => 'Seleccionar modelo';

  @override
  String get chatUiModel => 'Modelo';

  @override
  String get chatUiSpeed => 'Velocidad';

  @override
  String get chatUiSpeedFast => 'Rápida';

  @override
  String get chatUiSpeedNormal => 'Normal';

  @override
  String get chatUiChatControls => 'Controles del chat';

  @override
  String get chatUiControlsConnectionChanged =>
      'La conexión cambió. Vuelve a abrir los controles del chat.';

  @override
  String get chatUiLoadingModelsEllipsis => 'Cargando modelos…';

  @override
  String get chatUiOtherModels => 'Otros modelos…';

  @override
  String get chatUiIntelligence => 'Inteligencia';

  @override
  String get chatUiCopySessionId => 'Copiar ID de sesión';

  @override
  String get chatUiRenameChat => 'Cambiar nombre del chat';

  @override
  String get chatUiUnpinChat => 'Dejar de fijar chat';

  @override
  String get chatUiPinChat => 'Fijar chat';

  @override
  String get chatUiUnarchiveChat => 'Desarchivar chat';

  @override
  String get chatUiArchiveChat => 'Archivar chat';

  @override
  String get chatUiRemoveFromDevice => 'Quitar de este dispositivo';

  @override
  String get chatUiSessionIdCopied => 'Se copió el ID de sesión.';

  @override
  String get chatUiRemoveChatTitle => '¿Quitar este chat de este dispositivo?';

  @override
  String get chatUiRemoveChatBodyArchived =>
      'El chat se queda en tu computadora. Los chats de subagentes se archivan localmente.';

  @override
  String get chatUiRemoveChatBody =>
      'El chat se queda en tu computadora, donde también se archivará. Los chats de subagentes se archivan localmente.';

  @override
  String get chatUiRemoveChat => 'Quitar chat';

  @override
  String get chatUiChatName => 'Nombre del chat';

  @override
  String get chatUiSaveName => 'Guardar nombre';

  @override
  String get chatUiCopyPathFailed =>
      'No se pudo copiar la ruta. Vuelve a intentarlo.';

  @override
  String get chatUiConversationChanged => 'La conversación cambió';

  @override
  String get chatUiCloseLocation => 'Cerrar ubicación';

  @override
  String get chatUiThreadLabel => 'Hilo';

  @override
  String get chatUiRenameConversation => 'Cambiar nombre de la conversación';

  @override
  String get chatUiPathLabel => 'Ruta';

  @override
  String get chatUiPathCopied => 'Ruta copiada';

  @override
  String get chatUiCopyPath => 'Copiar ruta';

  @override
  String get chatUiLocationStale =>
      'Cierra esta hoja y vuelve a abrir la ubicación de la conversación.';

  @override
  String get chatUiMoreThreadActions => 'Más acciones del hilo';

  @override
  String chatUiPreviousMessages(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count mensajes anteriores',
      one: '1 mensaje anterior',
    );
    return '$_temp0';
  }

  @override
  String chatUiMoreToolCalls(int count) {
    return '+$count llamadas a herramientas';
  }

  @override
  String chatUiRanCommands(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Ejecutó $count comandos',
      one: 'Ejecutó 1 comando',
    );
    return '$_temp0';
  }

  @override
  String chatUiCommandsFailed(int count) {
    return '$count fallaron';
  }

  @override
  String chatUiCommandsStopped(int count) {
    return '$count detenidos';
  }

  @override
  String get chatUiCollapsePreviousMessages => 'Contraer mensajes anteriores';

  @override
  String get chatUiExpandPreviousMessages => 'Expandir mensajes anteriores';

  @override
  String get chatUiCollapseCommands => 'Contraer comandos';

  @override
  String get chatUiExpandCommands => 'Expandir comandos';

  @override
  String get chatUiCollapseToolCalls => 'Contraer llamadas a herramientas';

  @override
  String get chatUiExpandToolCalls => 'Expandir llamadas a herramientas';

  @override
  String get chatUiQuestions => 'Preguntas';

  @override
  String chatUiQuestionPage(int page, int total) {
    return '$page de $total';
  }

  @override
  String get chatUiQuestionResponseUnknown =>
      'Es posible que ya se haya enviado una respuesta. Revisa el estado en la computadora antes de responder otra vez.';

  @override
  String get chatUiBack => 'Atrás';

  @override
  String get chatUiQuestionClosing => 'Cerrando...';

  @override
  String get chatUiQuestionEsc => 'ESC';

  @override
  String get chatUiNext => 'Siguiente';

  @override
  String get chatUiResponseSent => 'Respuesta enviada';

  @override
  String get chatUiSendingDots => 'Enviando...';

  @override
  String get chatUiSend => 'Enviar';

  @override
  String chatUiSelectUpTo(int limit) {
    return 'Selecciona hasta $limit';
  }

  @override
  String get chatUiOtherAnswer => 'Otra respuesta';

  @override
  String get chatUiYourAnswer => 'Tu respuesta';

  @override
  String get settingsFontSystem => 'Sistema';

  @override
  String get settingsUnlockReason =>
      'Desbloquea DJL y tus sesiones de programación remotas.';

  @override
  String get settingsUsageWeekly => 'Semanal';

  @override
  String settingsUsageWeeks(int count) {
    return '$count sem';
  }

  @override
  String settingsUsageDays(int count) {
    return '$count d';
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
  String get settingsThemeSystem => 'Sistema';

  @override
  String get settingsThemeLight => 'Claro';

  @override
  String get settingsThemeDark => 'Oscuro';

  @override
  String get settingsAppearance => 'Apariencia';

  @override
  String get settingsFont => 'Fuente';

  @override
  String get settingsLiquidGlass => 'Liquid Glass';

  @override
  String get settingsTheme => 'Tema';

  @override
  String get settingsNotifications => 'Notificaciones';

  @override
  String get settingsInAppAlertsFooter =>
      'Muestra un aviso cuando termina la tarea de otra conversación.';

  @override
  String get settingsInAppAlerts => 'Avisos en la app';

  @override
  String get settingsVoice => 'Voz';

  @override
  String get settingsVoiceFooter =>
      'Revisa el dictado antes de enviarlo. Las respuestas usan la voz de tu dispositivo.';

  @override
  String get settingsSpeakReplies => 'Leer en voz alta las respuestas nuevas';

  @override
  String get settingsRetryReading => 'Volver a leer la configuración';

  @override
  String get settingsErrorPartialSave =>
      'Es posible que algunos valores predeterminados se hayan guardado a medias. Revisa las opciones recargadas y vuelve a intentarlo.';

  @override
  String get settingsErrorPartialReload =>
      'Es posible que los valores predeterminados se hayan guardado a medias. No se pudieron recargar las preferencias. Primero vuelve a leer la configuración.';

  @override
  String get settingsErrorRead =>
      'No se pudo leer la configuración guardada. Vuelve a intentarlo para conservar tus preferencias.';

  @override
  String get settingsErrorSave =>
      'No se pudo guardar este ajuste. Tu elección anterior no cambió. Vuelve a intentarlo.';

  @override
  String settingsUsageResets(String when) {
    return 'se restablece $when';
  }

  @override
  String get settingsUsage => 'Uso';

  @override
  String get settingsUsageFooter =>
      'Límites de uso de toda la cuenta, según tu dispositivo vinculado.';

  @override
  String get settingsUsageLoading => 'Cargando los límites actuales...';

  @override
  String get settingsUsageConnect =>
      'Conecta tu dispositivo vinculado para cargar los límites actuales.';

  @override
  String get settingsUsageUnavailable =>
      'Los límites de uso no están disponibles para esta cuenta.';

  @override
  String settingsUsageLeft(int percent) {
    return 'Queda $percent%';
  }

  @override
  String get settingsUsageStale =>
      'Últimos límites conocidos. Reconecta o actualiza para ver los actuales.';

  @override
  String get settingsUsageRefreshTooltip => 'Actualizar uso';

  @override
  String get settingsUsageRefreshing => 'Actualizando...';

  @override
  String get settingsUsageRefresh => 'Actualizar';

  @override
  String get settingsUsageRuntimeUnavailable =>
      'Los límites de uso no están disponibles para este entorno.';

  @override
  String get settingsUsageLoadFailed =>
      'No se pudieron cargar los límites actuales. Vuelve a intentarlo.';

  @override
  String get settingsTitle => 'Configuración';

  @override
  String get settingsOpenCloudChat => 'Abrir chat de DJL Cloud';

  @override
  String get settingsSignInCloud => 'Iniciar sesión en DJL Cloud';

  @override
  String get settingsCloudSubtitle =>
      'Chat, imágenes y tareas en segundo plano sin tu Mac';

  @override
  String get settingsDevicePermissions => 'Permisos del dispositivo';

  @override
  String get settingsDevice => 'Dispositivo';

  @override
  String get settingsMyMacs => 'Mis Mac';

  @override
  String get settingsLocked => 'DJL está bloqueado';

  @override
  String get settingsPreparing => 'Preparando DJL';

  @override
  String get settingsStartFailed => 'No se pudo iniciar DJL';

  @override
  String get settingsPrivateNote =>
      'Tus sesiones remotas siguen siendo privadas cuando te alejas.';

  @override
  String get settingsRetryStartup => 'Reintentar inicio';

  @override
  String get settingsUnlockHint =>
      'Se autentica con Face ID, Touch ID o el código de tu dispositivo';

  @override
  String get settingsUnlocking => 'Desbloqueando…';

  @override
  String get settingsUnlock => 'Desbloquear DJL';

  @override
  String get settingsLockSetup =>
      'Configura Face ID, Touch ID o un código del dispositivo para desbloquear DJL.';

  @override
  String get settingsLockStillLocked =>
      'DJL sigue bloqueado. Desbloquea DJL para continuar.';

  @override
  String get settingsLockCancelled =>
      'La autenticación se canceló o no está disponible. Desbloquea DJL para continuar.';

  @override
  String get settingsBridgeUnknown => 'Desconocido';

  @override
  String get settingsBridgeInstalled => 'Instalado';

  @override
  String get settingsBridgeUpToDate => 'Actualizado';

  @override
  String get settingsBridgeUpdateAvailable => 'Actualización disponible';

  @override
  String get settingsBridgeDifferentBuild => 'Otra compilación';

  @override
  String get settingsBridgeConnectHint =>
      'Conéctate a tu Mac para ver su versión de DJL.';

  @override
  String get settingsBridgeStaleHint =>
      'Última versión conocida. Reconecta para comprobar otra vez.';

  @override
  String get settingsBridgeMatches =>
      'DJL en tu Mac coincide con la versión más reciente.';

  @override
  String get settingsBridgeNewer =>
      'Hay una versión más reciente de DJL. Actualiza DJL en tu Mac.';

  @override
  String get settingsBridgeDifferent =>
      'Tu Mac usa una compilación distinta de la versión más reciente.';

  @override
  String get settingsBridgeStatus => 'Estado';

  @override
  String settingsBridgeLastKnown(String status) {
    return 'Último conocido · $status';
  }

  @override
  String get settingsVersion => 'Versión';

  @override
  String get settingsBridgeLatest => 'Más reciente';

  @override
  String get settingsBridgeUpdate => 'Actualiza DJL en tu Mac';

  @override
  String get settingsBridgeCheck => 'Buscar actualizaciones de DJL';

  @override
  String settingsElapsedDays(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: '$days días',
      one: '1 día',
    );
    return '$_temp0';
  }

  @override
  String settingsElapsedHours(int hours, int minutes) {
    String _temp0 = intl.Intl.pluralLogic(
      hours,
      locale: localeName,
      other: '$hours h',
      one: '1 h',
    );
    return '$_temp0, $minutes min';
  }

  @override
  String settingsElapsedMinutes(int minutes, int seconds) {
    return '$minutes min, $seconds s';
  }

  @override
  String settingsElapsedSeconds(int seconds) {
    return '$seconds s';
  }

  @override
  String get settingsArchived => 'Archivados';

  @override
  String get settingsArchivedChats => 'Chats archivados';

  @override
  String settingsArchivedSaved(int count) {
    return '$count guardados localmente';
  }

  @override
  String get settingsArchivedActions => 'Acciones del chat archivado';

  @override
  String get settingsUnarchive => 'Desarchivar';

  @override
  String get settingsRemoveFromPhone => 'Quitar del teléfono';

  @override
  String get settingsRemove => 'Quitar';

  @override
  String get settingsNoArchived => 'No hay chats archivados';

  @override
  String settingsRemoveTitle(String title) {
    return '¿Quitar “$title” de este teléfono?';
  }

  @override
  String get settingsRemoveBody =>
      'Esto solo quita el chat de DJL en este teléfono. No se borra nada de tu computadora vinculada.';

  @override
  String get settingsCloudRefreshFailed =>
      'No se pudo actualizar la cuenta ni la configuración de Cloud.';

  @override
  String get settingsLinkFailed =>
      'No se pudo abrir este enlace. Vuelve a intentarlo.';

  @override
  String get settingsOpenNotificationsFailed =>
      'No se pudo abrir la configuración de notificaciones. Vuelve a intentarlo.';

  @override
  String get settingsAlertsUnavailable => 'No disponible';

  @override
  String get settingsAlertsOff => 'Desactivadas';

  @override
  String get settingsAlertsEnabled => 'Activadas';

  @override
  String get settingsAlertsNotEnabled => 'No activadas';

  @override
  String get settingsBack => 'Atrás';

  @override
  String get settingsOpenNavigation => 'Abrir navegación';

  @override
  String get settingsRetry => 'Reintentar';

  @override
  String get settingsAccount => 'Cuenta';

  @override
  String get settingsDjlAccount => 'Cuenta de DJL';

  @override
  String get settingsAvailableCredits => 'Créditos disponibles';

  @override
  String get settingsConversations => 'Conversaciones';

  @override
  String get settingsArchivedChatsRow => 'Chats archivados';

  @override
  String get settingsRemoteAccess => 'Acceso remoto';

  @override
  String get settingsBackgroundAlerts => 'Avisos en segundo plano';

  @override
  String get settingsEnableBackgroundAlerts =>
      'Activar avisos en segundo plano';

  @override
  String get settingsOpenNotificationSettings =>
      'Abrir configuración de notificaciones';

  @override
  String get settingsVoiceIos =>
      'El dictado se queda en tu iPhone. Revisa el texto antes de enviarlo. Las respuestas usan la voz del iPhone.';

  @override
  String get settingsVoiceDevice =>
      'El dictado se queda en tu dispositivo. Revisa el texto antes de enviarlo. Las respuestas usan la voz de tu dispositivo.';

  @override
  String get settingsAbout => 'Acerca de';

  @override
  String get settingsTerms => 'Términos';

  @override
  String get settingsPrivacy => 'Privacidad';

  @override
  String get settingsRetryLocalPrefs => 'Reintentar preferencias locales';

  @override
  String get settingsDeviceNameOnPhone =>
      'Nombre del dispositivo en este teléfono';

  @override
  String get settingsEditDeviceNameTooltip => 'Editar nombre del dispositivo';

  @override
  String get settingsClose => 'Cerrar';

  @override
  String get settingsEditDeviceNameTitle => 'Editar nombre del dispositivo';

  @override
  String get settingsDeviceName => 'Nombre del dispositivo';

  @override
  String get settingsNicknameNote =>
      'Este apodo se queda en este teléfono y aparece dondequiera que se muestre este dispositivo.';

  @override
  String get settingsDeviceChanged =>
      'Este dispositivo guardado cambió. Cierra y vuelve a abrir el editor.';

  @override
  String get settingsUseDefault => 'Usar predeterminado';

  @override
  String get settingsSave => 'Guardar';

  @override
  String get settingsAboutFooter =>
      'Los chats tienen cifrado de extremo a extremo entre tu teléfono y el dispositivo vinculado.';

  @override
  String get settingsHowDjlWorks => 'Cómo funciona DJL';

  @override
  String get settingsChatSupport => 'Chat y soporte';

  @override
  String get settingsPrivacyPolicy => 'Política de privacidad';

  @override
  String get settingsTermsOfUse => 'Términos de uso';

  @override
  String get settingsAboutRouteBridgeDevice =>
      'Puente en tu dispositivo vinculado';

  @override
  String get settingsAboutRouteBridge => 'Puente';

  @override
  String settingsAboutRouteLabel(String from, String to, String via) {
    return 'De $from a $to vía $via';
  }

  @override
  String get settingsAboutIntro => 'Controla **Codex** desde tu teléfono.';

  @override
  String get settingsAboutIntroNote =>
      'El entorno de Codex se queda en tu dispositivo vinculado. Tu teléfono es un control remoto seguro conectado a través de un relay.';

  @override
  String get settingsAboutHowItWorks => 'Cómo funciona';

  @override
  String get settingsAboutBridge =>
      'Tu dispositivo vinculado ejecuta un **puente** ligero que se conecta a un **servidor relay** por WebSocket.';

  @override
  String get settingsAboutStep1 => 'Envías un prompt desde tu teléfono.';

  @override
  String get settingsAboutStep2 =>
      'Viaja por el relay hasta el puente en tu dispositivo vinculado.';

  @override
  String get settingsAboutStep3 =>
      'El puente lo reenvía a `codex app-server` mediante JSON-RPC.';

  @override
  String get settingsAboutStep4 =>
      'Las respuestas vuelven por el mismo camino en tiempo real.';

  @override
  String get settingsAboutWorkspaceNote =>
      'Las herramientas del espacio de trabajo y las ediciones de archivos se ejecutan en tu dispositivo vinculado. El relay solo dirige tráfico cifrado; no ejecuta tu espacio de trabajo.';

  @override
  String get settingsAboutArchitecture => 'Arquitectura';

  @override
  String get settingsAboutRelay => 'El relay';

  @override
  String get settingsAboutRelayIntro =>
      'Un servidor WebSocket ligero dirige los mensajes entre tu teléfono y el dispositivo vinculado.';

  @override
  String get settingsAboutRelayDiscovery =>
      'Se encarga de descubrir sesiones para que tu teléfono encuentre la sesión activa del dispositivo.';

  @override
  String get settingsAboutRelayPrivate =>
      'Nunca ve el contenido descifrado de los mensajes después del enlace seguro.';

  @override
  String get settingsAboutRelayMetadata =>
      'Ve metadatos de conexión, como IDs de sesión, IDs de dispositivo y tiempos.';

  @override
  String get settingsAboutRelaySelfHost =>
      'Puedes **alojar tú mismo** el relay o usar el endpoint alojado que configura tu puente.';

  @override
  String get settingsAboutAppServerIntro =>
      'Para el entorno de Codex, el puente se conecta a **`codex app-server`**, la interfaz JSON-RPC que usan los clientes de Codex.';

  @override
  String get settingsAboutAppServerSessions =>
      'Las conversaciones del teléfono son sesiones de Codex completas.';

  @override
  String get settingsAboutAppServerRollout =>
      'Codex genera archivos de registro JSONL en `~/.codex/sessions/`.';

  @override
  String get settingsAboutAppServerHandoff =>
      'Usa la acción de traspaso a la computadora de DJL para continuar un hilo del teléfono en el dispositivo vinculado.';

  @override
  String get settingsAboutPairing => 'Vinculación y seguridad';

  @override
  String get settingsAboutPairingQr =>
      'En la primera conexión, escanea el **código QR** del puente. Identifica el relay, la sesión, el dispositivo vinculado y la clave pública de identidad del puente.';

  @override
  String get settingsAboutPairingAfter => 'Después del enlace seguro:';

  @override
  String get settingsAboutPairingTrusted =>
      'Tu teléfono guarda el puente como **dispositivo de confianza** en el almacenamiento seguro del sistema.';

  @override
  String get settingsAboutPairingIdentity =>
      'El puente guarda localmente la identidad de tu teléfono.';

  @override
  String get settingsAboutPairingReconnect =>
      'Los dispositivos de confianza guardados pueden reconectarse sin volver a escanear.';

  @override
  String get settingsAboutPairingRecovery =>
      'El QR sigue siendo una vía de recuperación si cambia la confianza o no se puede resolver la sesión actual. Un código de un solo uso es otra opción de vinculación cuando se configura el mismo relay.';

  @override
  String get settingsAboutEncryption => 'Cifrado de extremo a extremo';

  @override
  String get settingsAboutEncryptionIntro =>
      'Después de vincular, los mensajes usan sobres cifrados.';

  @override
  String get settingsAboutCipher => 'Cifrado';

  @override
  String get settingsAboutKeyDerivation => 'Derivación de claves';

  @override
  String get settingsAboutKeyDerivationValue =>
      'HKDF-SHA256, claves por dirección';

  @override
  String get settingsAboutKeyExchange => 'Intercambio de claves';

  @override
  String get settingsAboutKeyExchangeValue => 'Claves efímeras X25519';

  @override
  String get settingsAboutIdentity => 'Identidad';

  @override
  String get settingsAboutIdentityValue => 'Firmas Ed25519';

  @override
  String get settingsAboutReplayProtection => 'Protección contra repetición';

  @override
  String get settingsAboutReplayProtectionValue => 'Contadores monotónicos';

  @override
  String get settingsAboutCacheKey => 'Clave de caché del teléfono';

  @override
  String get settingsAboutCacheKeyValue =>
      'Protegida por el almacenamiento seguro del sistema';

  @override
  String get settingsAboutEncryptionNote =>
      'Esto describe el **modo de dispositivo vinculado**. DJL Cloud es un servicio aparte con su propia cuenta.';

  @override
  String get settingsAboutGit => 'Git y espacio de trabajo';

  @override
  String get settingsAboutGitIntro =>
      'El puente ejecuta los comandos de Git localmente en el dispositivo vinculado:';

  @override
  String get settingsAboutGitRevert =>
      'DJL también permite **revertir el espacio de trabajo**: previsualiza y aplica parches inversos cuando quieras deshacer cambios del asistente. Revisa la confirmación antes de aplicar cambios.';

  @override
  String get settingsAboutResilience => 'Conexión resistente';

  @override
  String get settingsAboutReconnect =>
      'La reconexión automática usa reintentos con espera limitada.';

  @override
  String get settingsAboutReplay =>
      'Los cursores de repetición cifrados ayudan a recuperar eventos perdidos. Las acciones inciertas no se reenvían en silencio después de una desconexión.';

  @override
  String get settingsAboutRuntimeDrop =>
      'El entorno puede seguir trabajando aunque el teléfono pierda la conexión un momento.';

  @override
  String get settingsAboutShutdown =>
      'El puente se cierra correctamente con `SIGINT` y `SIGTERM`.';

  @override
  String get settingsAboutDesktop => 'Integración con la app de computadora';

  @override
  String get settingsAboutDesktopRollout =>
      'Codex guarda los hilos del teléfono como archivos de sesión en el dispositivo vinculado.';

  @override
  String get settingsAboutDesktopHandoff =>
      'Es posible que la app de computadora no recargue en vivo los cambios externos. Usa **Continuar en la computadora** en DJL para pasar el hilo actual.';

  @override
  String get settingsAboutDjl => 'Acerca de DJL';

  @override
  String get settingsOpenSource => 'Código abierto';

  @override
  String get settingsMitLicense => 'Licencia MIT';

  @override
  String get hostYourMac => 'Tu Mac';

  @override
  String get hostUpdating =>
      'DJL se está actualizando en tu Mac. Este teléfono se reconectará cuando vuelva.';

  @override
  String get hostCheckingVersion => 'Comprobando la versión de DJL en tu Mac…';

  @override
  String hostNowVersion(String version) {
    return 'DJL en tu Mac ahora es la versión $version.';
  }

  @override
  String hostStillVersion(String version) {
    return 'DJL en tu Mac sigue en la versión $version. Es posible que ya esté actualizado.';
  }

  @override
  String get hostConnectedFooter =>
      'Tus chats van directo a DJL en tu Mac, con cifrado de extremo a extremo.';

  @override
  String get hostReconnectFooter => 'Abre DJL en tu Mac para reconectar.';

  @override
  String get hostDjlVersion => 'Versión de DJL';

  @override
  String get hostCheckFailedNow =>
      'No se pudo comprobar tu Mac en este momento.';

  @override
  String get hostReconnecting => 'Reconectando…';

  @override
  String get hostWakeScreen => 'Encender la pantalla';

  @override
  String get hostWakeScreenDetail =>
      'Enciende la pantalla de tu Mac mientras DJL está en ejecución.';

  @override
  String get hostKeepAwake => 'Mantener la Mac activa';

  @override
  String get hostKeepAwakeDetail =>
      'Evita que tu Mac entre en reposo mientras DJL está abierto. Ideal mientras se carga.';

  @override
  String get hostUpdates => 'Actualizaciones';

  @override
  String get hostUpdateDjl => 'Actualizar DJL';

  @override
  String get hostUpdateDjlDetail =>
      'Instala la versión más reciente de DJL en tu Mac y luego se reconecta.';

  @override
  String get hostNotConnected => 'Sin conexión';

  @override
  String get hostConnectedChecking => 'Conectado · comprobando';

  @override
  String get hostConnected => 'Conectado';

  @override
  String hostStatusLabel(String status) {
    return 'DJL en tu Mac, $status';
  }

  @override
  String get hostDjlOnYourMac => 'DJL en tu Mac';

  @override
  String get hostUpdateTitle => '¿Actualizar DJL en tu Mac?';

  @override
  String hostUpdateCurrent(String version) {
    return 'Tu Mac tiene DJL $version.';
  }

  @override
  String get hostUpdateBody =>
      'DJL se reinicia en tu Mac para instalar la versión más reciente. Este teléfono se desconecta un momento y se reconecta solo.';

  @override
  String get hostUpdate => 'Actualizar';

  @override
  String get hostContinueOnDesktop => 'Continuar en la computadora';

  @override
  String get hostContinueTitle => '¿Continuar en la computadora?';

  @override
  String get hostContinueBody => 'Abre este chat en DJL en tu Mac.';

  @override
  String get hostContinue => 'Continuar';

  @override
  String get hostActionFinished => 'La acción terminó.';

  @override
  String get hostErrorUnsupported =>
      'DJL en tu Mac todavía no puede hacer esto. Actualiza DJL en tu Mac.';

  @override
  String get hostErrorRefused =>
      'Tu Mac rechazó esto. Revisa DJL en tu Mac y vuelve a intentarlo.';

  @override
  String get hostErrorUncertain =>
      'No pudimos saber si funcionó. Revisa tu Mac antes de volver a intentarlo.';

  @override
  String get hostCheckFailed =>
      'No se pudo comprobar tu Mac. Vuelve a intentarlo.';

  @override
  String get hostCheckingFirst =>
      'Primero estamos comprobando tu Mac. Vuelve a intentarlo en un momento.';

  @override
  String get hostConnectFirst => 'Primero conéctate a tu Mac.';

  @override
  String get hostNotConfirmed =>
      'Tu Mac no lo confirmó. Revísala antes de volver a intentarlo.';

  @override
  String get hostOpenedOnMac => 'Se abrió en DJL en tu Mac.';

  @override
  String get hostReconnectFirst => 'Primero vuelve a conectarte a tu Mac.';

  @override
  String get hostReachFailed =>
      'No se pudo conectar con DJL en tu Mac. Comprueba que esté abierto y vuelve a intentarlo.';

  @override
  String get hostWaking => 'La pantalla de tu Mac se está encendiendo.';

  @override
  String get hostPrefReadFailed =>
      'No se pudo leer la preferencia guardada. Vuelve a intentarlo.';

  @override
  String get hostPrefSaveFailed =>
      'No se pudo guardar esta preferencia. Tu elección anterior no cambió. Vuelve a intentarlo.';

  @override
  String get hostPrefUnconfirmed =>
      'Se guardó en este teléfono, pero tu Mac aún no lo confirmó.';

  @override
  String get pushTitle => 'Notificaciones push';

  @override
  String get pushUnsupported =>
      'Este teléfono todavía no puede recibir notificaciones push de DJL. Abre DJL para ver cuándo termina un agente.';

  @override
  String get pushDenied =>
      'Las notificaciones de DJL están desactivadas en la Configuración de tu teléfono.';

  @override
  String get pushReady =>
      'Recibe una notificación cuando un agente termine o necesite tu respuesta.';

  @override
  String get pushSimulator =>
      'Este simulador no puede recibir notificaciones push.';

  @override
  String get pushUnavailableVersion =>
      'Las notificaciones push no están disponibles en esta versión.';

  @override
  String get pushFailed =>
      'No se pudieron activar las notificaciones. Vuelve a intentarlo cuando tengas conexión.';

  @override
  String get pushUnavailableNow =>
      'Las notificaciones push no están disponibles en este momento.';

  @override
  String get pushReadFailed =>
      'No se pudo leer la preferencia de notificaciones. Vuelve a intentarlo.';

  @override
  String get pushUpdateFailed =>
      'No se pudo actualizar la preferencia de notificaciones. Vuelve a intentarlo.';

  @override
  String get whatsNewTitle => 'Novedades';

  @override
  String get whatsNewIntro => 'Esto es lo nuevo en DJL.';

  @override
  String get whatsNewOnce =>
      'Solo lo mostraremos una vez por cada versión de la app.';

  @override
  String get whatsNewGotIt => 'Entendido';

  @override
  String get whatsNewDismiss => 'Cerrar novedades';

  @override
  String get whatsNew100Design => 'Un diseño en blanco y negro más tranquilo.';

  @override
  String get whatsNew100Groups =>
      'Chats grupales: habla con varios agentes a la vez y mira cómo responden en vivo.';

  @override
  String get whatsNew100Files => 'Envía archivos y fotos en un chat grupal.';

  @override
  String get whatsNew100Mac => 'Los chats van directo a DJL en tu Mac.';

  @override
  String get accountSomethingWrong => 'Algo salió mal';

  @override
  String get accountTypeDeleteToConfirm => 'Escribe DELETE para confirmar.';

  @override
  String get accountOk => 'Aceptar';

  @override
  String get accountDone => 'Listo';

  @override
  String get accountEmail => 'Correo electrónico';

  @override
  String get accountPlan => 'Plan';

  @override
  String get accountCredits => 'Créditos';

  @override
  String get accountUsageFooter =>
      'Un reinicio guardado pone ambos límites en cero y reinicia tu semana. Los reinicios guardados vencen 90 días después de otorgarse.';

  @override
  String get accountFiveHourLimit => 'Límite de 5 horas';

  @override
  String get accountWeeklyLimit => 'Límite semanal';

  @override
  String get accountBankedResets => 'Reinicios guardados';

  @override
  String accountNextExpires(String date, String year) {
    return 'Próximo vencimiento: $date, $year';
  }

  @override
  String get accountNone => 'Ninguno';

  @override
  String accountUseOne(int count) {
    return 'Usar 1 de $count';
  }

  @override
  String get accountDeleteFooter =>
      'Al eliminar tu cuenta se borran tus chats, archivos y créditos. Tienes 30 días para arrepentirte contactando a soporte.';

  @override
  String get accountSignOut => 'Cerrar sesión';

  @override
  String get accountDelete => 'Eliminar cuenta';

  @override
  String accountUsedPercent(int percent) {
    return '$percent% usado';
  }

  @override
  String get accountResetsNow => 'Se restablece ahora';

  @override
  String get accountResetsTomorrow => 'Se restablece mañana';

  @override
  String get accountResetsYesterday => 'Se restableció ayer';

  @override
  String get accountResetsNextWeek => 'Se restablece la próxima semana';

  @override
  String get accountResetsLastWeek => 'Se restableció la semana pasada';

  @override
  String accountResetsIn(String quantity) {
    return 'Se restablece en $quantity';
  }

  @override
  String accountResetsAgo(String quantity) {
    return 'Se restableció hace $quantity';
  }

  @override
  String accountSeconds(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count segundos',
      one: '1 segundo',
    );
    return '$_temp0';
  }

  @override
  String accountMinutes(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count minutos',
      one: '1 minuto',
    );
    return '$_temp0';
  }

  @override
  String accountHours(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count horas',
      one: '1 hora',
    );
    return '$_temp0';
  }

  @override
  String accountDays(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count días',
      one: '1 día',
    );
    return '$_temp0';
  }

  @override
  String accountWeeks(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count semanas',
      one: '1 semana',
    );
    return '$_temp0';
  }

  @override
  String get accountDeleteTitle => '¿Eliminar tu cuenta?';

  @override
  String get accountDeleteBody =>
      'Esto no se puede deshacer después de 30 días. Escribe DELETE para confirmar.';

  @override
  String get accountTypeDelete => 'Escribe DELETE';

  @override
  String get accountSignOutTitle => '¿Cerrar sesión en DJL Cloud?';

  @override
  String get notificationsTitle => 'Notificaciones';

  @override
  String get notificationsMarkAllRead => 'Marcar todo como leído';

  @override
  String get notificationsCaughtUp => 'Estás al día';

  @override
  String get notificationsEmptyHint => 'Las tareas terminadas aparecerán aquí.';

  @override
  String get notificationsTaskComplete => 'Tarea completada';

  @override
  String get notificationsLoadMore => 'Cargar más';

  @override
  String notificationsStatus(String status) {
    String _temp0 = intl.Intl.selectLogic(status, {
      'succeeded': 'completada',
      'failed': 'fallida',
      'other': '$status',
    });
    return '$_temp0';
  }

  @override
  String get notificationsTaskStopped => 'Tarea detenida';

  @override
  String get notificationsTaskFinished => 'Tarea terminada';

  @override
  String get notificationsOpenResult => 'Abre DJL para ver el resultado';

  @override
  String get notificationsDismiss => 'Descartar notificación';

  @override
  String get reportOffensive => 'Ofensiva o de odio';

  @override
  String get reportHarmful => 'Dañina o peligrosa';

  @override
  String get reportWrong => 'Incorrecta o engañosa';

  @override
  String get reportOther => 'Otra cosa';

  @override
  String get reportThanks => 'Gracias. Revisaremos esta respuesta.';

  @override
  String get reportTitle => 'Reportar esta respuesta';

  @override
  String get reportRateLimited =>
      'Hay demasiados reportes en este momento. Vuelve a intentarlo más tarde.';

  @override
  String get reportFailed =>
      'No se pudo enviar el reporte. Vuelve a intentarlo.';

  @override
  String get reportIntro =>
      'DJL revisa los reportes para mantener las respuestas seguras. ¿Qué tiene de malo?';

  @override
  String get reportDetailsHint => 'Agrega detalles (opcional)';

  @override
  String get reportSending => 'Enviando…';

  @override
  String get reportSend => 'Enviar reporte';

  @override
  String get attachmentsNoApp =>
      'Ninguna app de aquí abre este archivo. Elige una para enviárselo.';

  @override
  String get attachmentsOpenFailed => 'No se pudo abrir este archivo';

  @override
  String get attachmentsCheckMac =>
      'Comprueba que tu Mac esté conectada y vuelve a intentarlo.';

  @override
  String get attachmentsImageUnshowable =>
      'Esta imagen no se puede mostrar aquí';

  @override
  String get attachmentsOpenElsewhere => 'Abrir en otra app';

  @override
  String get attachmentsOpen => 'Abrir';

  @override
  String get attachmentsShare => 'Compartir';

  @override
  String get imagesSquare => 'Cuadrada';

  @override
  String get imagesLandscape => 'Horizontal';

  @override
  String get imagesPortrait => 'Vertical';

  @override
  String get imagesOnePerRequest =>
      'Una imagen por solicitud. Puedes salir del chat mientras DJL trabaja.';

  @override
  String get imagesCreate => 'Crear imagen';

  @override
  String get imagesMakeYours => 'Crea algo tuyo.';

  @override
  String get imagesDescribe =>
      'Describe el tema, el estilo y los detalles que tienes en mente.';

  @override
  String get imagesPromptHint => 'Un estudio tranquilo con luz de la mañana…';

  @override
  String get imagesShape => 'Formato';

  @override
  String get imagesNotConfigured =>
      'La generación de imágenes aún no está configurada en este servidor. Tus imágenes guardadas siguen disponibles.';

  @override
  String get imagesStarting => 'Iniciando…';

  @override
  String get imagesOpenImage => 'Abrir imagen';

  @override
  String get imagesGenerated => 'Imagen generada';

  @override
  String get imagesOpenChat => 'Abrir chat';

  @override
  String get imagesActions => 'Acciones de la imagen';

  @override
  String get imagesEditInChat => 'Editar en el chat';

  @override
  String get imagesTitle => 'Imágenes';

  @override
  String get imagesYourImages => 'Tus imágenes';

  @override
  String get imagesEmpty =>
      'Crea una imagen y encuéntrala aquí, lista para guardar o compartir.';

  @override
  String get imagesEmptyNotConfigured =>
      'La creación de imágenes aún no está configurada. Las imágenes guardadas aparecerán aquí.';

  @override
  String get imagesLoadMore => 'Cargar más';

  @override
  String get imagesYourImage => 'Tu imagen';

  @override
  String get imagesShare => 'Compartir';

  @override
  String get imagesSaveToPhotos => 'Guardar en Fotos';

  @override
  String get imagesSaved => 'Se guardó en Fotos.';

  @override
  String get authSocialNotConfigured =>
      'El inicio de sesión no está configurado para esta app. Continúa con tu correo electrónico.';

  @override
  String get authSocialOpenFailed =>
      'No se pudo abrir el inicio de sesión. Vuelve a intentarlo.';

  @override
  String get authSignInOptionsFailed =>
      'No se pudieron cargar las opciones de inicio de sesión.';

  @override
  String get authCloudSignInFailed =>
      'No se pudo iniciar sesión en DJL Cloud. Vuelve a intentarlo.';

  @override
  String get authSecureStorageFailed =>
      'No se pudo abrir el almacenamiento seguro. Desbloquea tu dispositivo y vuelve a intentarlo.';

  @override
  String get authCheckEmailForCode =>
      'Revisa tu correo para ver el código de verificación.';

  @override
  String get authRequestSent => 'Solicitud enviada. Revisa tu correo.';

  @override
  String get authCloudDataNotCleared =>
      'No se pudieron borrar algunos datos guardados de Cloud.';

  @override
  String get authLinkOpenFailed =>
      'No se pudo abrir este enlace. Vuelve a intentarlo.';

  @override
  String get authWelcomeTitle => 'Te damos la bienvenida a DJL';

  @override
  String get authWelcomeSubtitle =>
      'Tus ideas, tus conversaciones y tu Mac.\nJuntos en DJL.';

  @override
  String get authRetrySignInOptions =>
      'Reintentar opciones de inicio de sesión';

  @override
  String get authLoadingSignInOptions =>
      'Cargando opciones de inicio de sesión';

  @override
  String get authContinueWithApple => 'Continuar con Apple';

  @override
  String get authContinueWithGoogle => 'Continuar con Google';

  @override
  String get authContinueWithEmail => 'Continuar con correo';

  @override
  String get authPairWithMac => 'Vincular con una Mac';

  @override
  String get authNoMacHint =>
      '¿No tienes Mac? Inicia sesión para chatear con DJL Cloud.';

  @override
  String get authTerms => 'Términos';

  @override
  String get authPrivacy => 'Privacidad';

  @override
  String get authVerifyAndContinue => 'Verificar y continuar';

  @override
  String get authSignIn => 'Iniciar sesión';

  @override
  String get authEmailMeCode => 'Enviarme un código';

  @override
  String get authCreateAccount => 'Crear cuenta';

  @override
  String get authSignInIncomplete =>
      'No se pudo completar el inicio de sesión. Vuelve a intentarlo.';

  @override
  String get authPassword => 'Contraseña';

  @override
  String get authEmailCode => 'Código del correo';

  @override
  String get authName => 'Nombre';

  @override
  String get authEmail => 'Correo electrónico';

  @override
  String get authSixDigitCode => 'Código de 6 dígitos';

  @override
  String authCodeSent(String email) {
    return 'Enviamos un código a $email. Vence en 10 minutos.';
  }

  @override
  String get authCreateAccountHint =>
      'Usa al menos 10 caracteres. Te enviaremos un código por correo para confirmar tu dirección.';

  @override
  String get authResendCode => 'Reenviar código';

  @override
  String authResendIn(int seconds) {
    return 'Reenviar en $seconds s';
  }

  @override
  String get authUseAnotherEmail => 'Usar otro correo';

  @override
  String get authForgotPassword => '¿Olvidaste tu contraseña?';

  @override
  String get authResetPassword => 'Restablecer contraseña';

  @override
  String get authPasswordUpdated => 'Contraseña actualizada';

  @override
  String get authSignInWithNewPassword =>
      'Inicia sesión con tu nueva contraseña.';

  @override
  String get authBackToSignIn => 'Volver a iniciar sesión';

  @override
  String get authNewPassword => 'Nueva contraseña';

  @override
  String get authRecoveryHint =>
      'Te enviaremos un código de recuperación si existe una cuenta con este correo.';

  @override
  String get authRecoveryCodeHint =>
      'Escribe tu código de recuperación y una contraseña de 10 a 256 caracteres.';

  @override
  String get authSendRecoveryCode => 'Enviar código de recuperación';

  @override
  String get chatUiWorktreeHandoffFailed =>
      'Falló el traspaso al árbol de trabajo';

  @override
  String get chatUiOk => 'Aceptar';

  @override
  String get chatUiSelectFolder => 'Seleccionar carpeta';

  @override
  String get chatUiBrowseFolders => 'Explorar carpetas locales…';

  @override
  String get chatUiBranchOpenElsewhere =>
      'La rama ya está abierta en otro lugar';

  @override
  String chatUiBranchOpenElsewhereChat(String branch) {
    return '“$branch” ya está activa en otro árbol de trabajo. Abre ese chat para continuar ahí.';
  }

  @override
  String chatUiBranchOpenElsewhereSidebar(String branch) {
    return '“$branch” ya está activa en otro árbol de trabajo. Abre ese chat desde la barra lateral para continuar ahí.';
  }

  @override
  String get chatUiOpenChat => 'Abrir chat';

  @override
  String get chatUiWorktreeChatGone =>
      'El chat del árbol de trabajo ya no está disponible. Ábrelo desde la barra lateral.';

  @override
  String get chatUiPhotoLibrary => 'Fototeca';

  @override
  String get chatUiTakePhoto => 'Tomar foto';

  @override
  String get chatUiPlanMode => 'Modo de planificación';

  @override
  String get chatUiFastMode => 'Modo rápido';

  @override
  String get chatUiImage => 'Imagen';

  @override
  String get chatUiOpensThreadLocation => 'Abre la ubicación del hilo';

  @override
  String get chatUiDesktopChat => 'Chat de la computadora';

  @override
  String get chatUiNewThread => 'Nuevo hilo';

  @override
  String get chatUiHandOffToDesktop => 'Pasar a la computadora';

  @override
  String get chatUiHandOffToLocal => 'Pasar a Local';

  @override
  String get chatUiHandOffToWorktree => 'Pasar a un árbol de trabajo';

  @override
  String get chatUiGoal => 'Objetivo';

  @override
  String get chatUiForkChat => 'Bifurcar este chat';

  @override
  String get chatUiForkIntoFolder => 'Bifurcar en otra carpeta';

  @override
  String get chatUiForkIntoWorktree => 'Bifurcar en un nuevo árbol de trabajo';

  @override
  String get chatUiWorkspaceFiles => 'Archivos del espacio de trabajo';

  @override
  String get chatUiTurnChanges => 'Cambios del turno y restauración';

  @override
  String get chatUiRefreshFromDesktop => 'Actualizar desde la computadora';

  @override
  String get chatUiDesktopDisconnected =>
      'La computadora se desconectó. Tu mensaje no se volvió a enviar.';

  @override
  String get chatUiLinkedPositionUnavailable =>
      'La posición vinculada no está en el historial cargado.';

  @override
  String get chatUiReviewResponseChanges =>
      'Revisar los cambios exactos de la respuesta';

  @override
  String get chatUiResponseUndone => 'Respuesta deshecha';

  @override
  String get chatUiUndoResponse => 'Deshacer esta respuesta';

  @override
  String get chatUiApprovalRequired => 'Se necesita aprobación';

  @override
  String get chatUiApprovalSent =>
      'Respuesta enviada. Esperando a la computadora.';

  @override
  String get chatUiDecline => 'Rechazar';

  @override
  String get chatUiApproveOnce => 'Aprobar una vez';

  @override
  String get chatUiBranch => 'Rama';

  @override
  String get chatUiPreparingWorktree => 'Preparando árbol de trabajo...';

  @override
  String get chatUiNewWorktree => 'Nuevo árbol de trabajo';

  @override
  String chatUiGoalChip(String status, String elapsed) {
    return 'Objetivo $status · $elapsed';
  }

  @override
  String get chatUiReturnToParent => 'Volver al chat principal';

  @override
  String chatUiReturnTo(String title) {
    return 'Volver a $title';
  }

  @override
  String get chatUiAskDjl => 'Pregúntale a DJL';

  @override
  String get chatUiFollowUp => 'Pregunta algo más';

  @override
  String get workspaceRestoreFailed =>
      'La computadora no confirmó la restauración. Actualiza antes de reintentar.';

  @override
  String workspaceRestoredFiles(int count) {
    return 'Se restauraron $count archivos.';
  }

  @override
  String get workspaceBackupSaved =>
      ' Se guardó un punto de respaldo en tu Mac.';

  @override
  String get workspaceNoLocalFolders =>
      'No hay carpetas locales disponibles desde este dispositivo.';

  @override
  String get workspaceUndoReviewChanged =>
      'La respuesta o la conexión cambiaron. Vuelve a abrir esta revisión.';

  @override
  String get workspaceUndoPreviewFailed =>
      'No se pudo previsualizar el parche exacto. Actualiza la revisión antes de volver a intentarlo.';

  @override
  String get workspaceUndoRepositoryChanged =>
      'La respuesta o el repositorio cambiaron. Vuelve a abrir esta revisión.';

  @override
  String get workspaceUndoResultUnknownChanged =>
      'La conexión o la respuesta cambiaron. No se sabe el resultado de deshacer; actualiza y revísalo.';

  @override
  String get workspaceUndoRefused =>
      'La computadora no deshizo la respuesta. Revisa los conflictos actuales y los archivos preparados.';

  @override
  String get workspaceUndoResultUnknown =>
      'No se sabe el resultado de deshacer. Actualiza y revisa el parche exacto antes de otro intento.';

  @override
  String get workspaceUndoSaveAfterSuccessFailed =>
      'Se deshizo, pero falló al guardar o actualizar el resultado local. Vuelve a conectarte para verificar los archivos.';

  @override
  String get workspaceUndoSaveFailed =>
      'No se pudo guardar el resultado de deshacer. Vuelve a conectarte y revisa los archivos actuales.';

  @override
  String get workspaceUndoTitle => 'Deshacer esta respuesta';

  @override
  String workspaceUndoWorkspace(String path) {
    return 'Espacio de trabajo: $path';
  }

  @override
  String get workspaceUndoIntro =>
      'Revisa los cambios exactos de esta respuesta. Las ediciones posteriores se mantienen donde el parche inverso puede aplicarse. La computadora vuelve a buscar conflictos cuando confirmas.';

  @override
  String get workspaceUndoOverlap =>
      'Otras respuestas modifican estos archivos. Revisa con cuidado: deshacer puede afectar cambios de este u otro chat.';

  @override
  String get workspaceUndoUncertain =>
      'No se sabe el resultado de un intento anterior de deshacer. Actualiza esta revisión y revisa los archivos actuales antes de confirmar otro intento.';

  @override
  String get workspaceUndoStale =>
      'Esta revisión ya no está al día. Ciérrala y vuelve a abrir la respuesta.';

  @override
  String get workspaceUndoDone => 'Esta respuesta se deshizo.';

  @override
  String workspaceUndoStagedBlock(String files) {
    return 'Hay archivos preparados que impiden deshacer: $files';
  }

  @override
  String workspaceUndoConflict(String conflict) {
    return 'Conflicto: $conflict';
  }

  @override
  String get workspaceUndoCannotReverse =>
      'La computadora no puede revertir este parche de forma segura.';

  @override
  String get workspaceClose => 'Cerrar';

  @override
  String get workspaceRefreshReview => 'Actualizar revisión';

  @override
  String get workspaceUndoResponse => 'Deshacer respuesta';

  @override
  String get workspaceConflictFallback => 'Conflicto';

  @override
  String get workspaceAlreadyUndone => 'Esta respuesta ya se deshizo.';

  @override
  String get workspaceStillRunning => 'Esta respuesta aún está en curso.';

  @override
  String get workspaceNoDesktopWorkspace =>
      'La respuesta no tiene un espacio de trabajo en la computadora.';

  @override
  String get workspaceNoPatchCaptured =>
      'No se capturó un parche exacto compatible para la respuesta.';

  @override
  String get workspaceRestoreTitle =>
      '¿Restaurar el espacio de trabajo a antes de este turno?';

  @override
  String get workspaceRestoreBody =>
      'Esto reemplaza los archivos actuales del espacio de trabajo y elimina los archivos sin seguimiento. Revisa los archivos afectados antes de restaurar. La Mac guarda primero un punto de respaldo.';

  @override
  String get workspaceNoAffectedFiles => 'No se reportaron archivos afectados.';

  @override
  String get workspaceStagedFiles => 'Archivos preparados';

  @override
  String get workspaceUntrackedFiles => 'Archivos sin seguimiento';

  @override
  String get workspaceRestoreFiles => 'Restaurar archivos';

  @override
  String get workspaceTurnChanges => 'Cambios del turno';

  @override
  String get workspaceReloadTurnChanges => 'Recargar cambios del turno';

  @override
  String get workspaceConversationTurn => 'Turno de la conversación';

  @override
  String workspaceTurnNumber(int number) {
    return 'Turno $number';
  }

  @override
  String get workspaceNoSavedChanges =>
      'No hay cambios guardados para este turno.';

  @override
  String get workspaceNoCompletedTurns => 'Aún no hay turnos completados.';

  @override
  String get workspaceChooseTurn =>
      'Elige un turno para ver sus cambios guardados en el espacio de trabajo.';

  @override
  String get workspaceStopBeforeRestore =>
      'Detén el turno en curso antes de restaurar archivos.';

  @override
  String get workspacePreviewRestore =>
      'Previsualizar restauración a antes de este turno';

  @override
  String get workspaceFileFallbackTitle => 'Archivo del espacio de trabajo';

  @override
  String get workspaceCopyFileContents => 'Copiar contenido del archivo';

  @override
  String get workspaceFileContentsCopied =>
      'Se copió el contenido del archivo.';

  @override
  String get workspaceReloadFile => 'Recargar archivo';

  @override
  String get workspaceFilePathOnMac => 'Ruta del archivo en tu Mac';

  @override
  String get workspaceSegmentText => 'Texto';

  @override
  String get workspaceSegmentImage => 'Imagen';

  @override
  String get workspaceOpen => 'Abrir';

  @override
  String get workspaceSvgRenderFailed => 'No se pudo mostrar este SVG.';

  @override
  String get workspaceImageRenderFailed =>
      'Este formato de imagen no se puede mostrar en este dispositivo.';

  @override
  String get workspaceOpenFileToPreview =>
      'Abre un archivo del espacio de trabajo para previsualizarlo.';

  @override
  String get workspaceSavedToPhotos => 'Se guardó en Fotos.';

  @override
  String get workspaceImageTitle => 'Imagen';

  @override
  String get workspaceOk => 'Aceptar';

  @override
  String get workspaceLoadingFile => 'Cargando archivo';

  @override
  String get workspaceUnableToLoadFile => 'No se pudo cargar el archivo.';

  @override
  String get workspaceRetry => 'Reintentar';

  @override
  String get workspaceCloseFilePreview => 'Cerrar vista previa del archivo';

  @override
  String get workspaceDone => 'Listo';

  @override
  String get workspaceFindInFile => 'Buscar en el archivo';

  @override
  String workspaceLineCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count líneas',
      one: '1 línea',
    );
    return '$_temp0';
  }

  @override
  String workspaceByteCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count bytes',
      one: '1 byte',
    );
    return '$_temp0';
  }

  @override
  String get workspaceCloseSvgPreview => 'Cerrar vista previa del SVG';

  @override
  String get workspaceReloadSvgPreview => 'Recargar vista previa del SVG';

  @override
  String get workspaceShare => 'Compartir';

  @override
  String get workspaceSaveToPhotos => 'Guardar en Fotos';

  @override
  String get workspaceUnableToDisplayImage => 'No se pudo mostrar la imagen.';

  @override
  String get workspaceFileContents => 'Contenido del archivo';

  @override
  String get workspaceSearching => 'Buscando…';

  @override
  String workspaceMatchPosition(int index, int total) {
    return '$index de $total';
  }

  @override
  String get workspacePreviousMatch => 'Coincidencia anterior';

  @override
  String get workspaceNextMatch => 'Coincidencia siguiente';

  @override
  String get workspaceCloseFind => 'Cerrar búsqueda';

  @override
  String get workspaceAddLocalFolder => 'Agregar carpeta local';

  @override
  String get workspaceCreateFolderOnMac => 'Crear carpeta en la Mac';

  @override
  String get workspaceUse => 'Usar';

  @override
  String get workspaceParentFolder => 'Carpeta superior';

  @override
  String get workspaceSearchingFolders => 'Buscando carpetas...';

  @override
  String get workspaceLoading => 'Cargando';

  @override
  String get workspaceNoMatchingFolders =>
      'No hay carpetas que coincidan dentro de esta carpeta.';

  @override
  String get workspaceNoChildFolders => 'No hay subcarpetas aquí.';

  @override
  String get workspaceSearchFolders => 'Buscar carpetas';

  @override
  String get workspaceClearFolderSearch => 'Borrar búsqueda de carpetas';

  @override
  String get workspaceLocations => 'Ubicaciones';

  @override
  String get workspaceCurrentFolder => 'Carpeta actual';

  @override
  String get workspaceLoadingFolders => 'Cargando carpetas...';

  @override
  String get workspaceNoFolderSelected =>
      'No hay ninguna carpeta seleccionada.';

  @override
  String get workspaceMatchingFolders => 'Carpetas que coinciden';

  @override
  String get workspaceFolders => 'Carpetas';

  @override
  String get workspaceNewFolder => 'Nueva carpeta';

  @override
  String get workspaceNewFolderBody =>
      'Crea esta carpeta en tu dispositivo e inicia un chat ahí.';

  @override
  String get workspaceFolderName => 'Nombre de la carpeta';

  @override
  String get workspaceCreate => 'Crear';

  @override
  String get workspaceDesktopChangedPicker =>
      'La computadora conectada cambió. Vuelve a abrir el selector de proyectos.';

  @override
  String get workspaceDesktopChanged =>
      'La computadora conectada cambió. Vuelve a abrir este espacio de trabajo.';

  @override
  String get workspaceChooseWorkspaceFirst =>
      'Primero elige un espacio de trabajo en tu computadora.';

  @override
  String get workspaceNoTextInPreview =>
      'La vista previa del archivo no incluyó texto. Recárgala desde el espacio de trabajo.';

  @override
  String get workspaceNoImageInPreview =>
      'La vista previa no incluyó los datos de la imagen. Recárgala desde el espacio de trabajo.';

  @override
  String get workspaceRestorePreviewOtherWorkspace =>
      'Esta vista previa de restauración pertenece a otro espacio de trabajo. Vuelve a generarla.';

  @override
  String get cloudChatNewChat => 'Nuevo chat';

  @override
  String get cloudChatLostConnection =>
      'Se perdió la conexión. Toca Reconectar para continuar esta respuesta.';

  @override
  String get cloudChatImageToEdit => 'Imagen para editar';

  @override
  String get cloudChatNoContent => 'La respuesta no tiene contenido.';

  @override
  String get cloudChatThinking => 'Pensando…';

  @override
  String get cloudChatResponseStopped => 'Respuesta detenida.';

  @override
  String get cloudChatResponseFailed => 'La respuesta falló.';

  @override
  String get cloudChatWaitingForUsageReset =>
      'Esperando a que se restablezca el uso.';

  @override
  String get cloudChatModelChoiceLoadFailed =>
      'No se pudo cargar tu modelo guardado. Vuelve a intentarlo.';

  @override
  String get cloudChatModelChoiceSaveFailed =>
      'No se pudo guardar tu elección de modelo. Vuelve a intentarlo.';

  @override
  String get cloudChatDraftSaveFailed =>
      'No se pudo guardar tu borrador. Deja el texto aquí y vuelve a intentarlo.';

  @override
  String get cloudChatDraftLoadFailed =>
      'No se pudo cargar tu borrador guardado. Vuelve a intentarlo antes de editar.';

  @override
  String get cloudChatInterruptedImage =>
      'Una solicitud de imagen interrumpida se guardó de forma segura. Vuelve a intentarlo para ver su resultado.';

  @override
  String get cloudChatInterruptedMessage =>
      'Un mensaje interrumpido se guardó de forma segura. Vuelve a intentarlo para ver su resultado.';

  @override
  String get cloudChatModelCannotViewImages =>
      'Elige un modelo que pueda ver imágenes antes de enviar este adjunto.';

  @override
  String get cloudChatImageGenerationUnavailable =>
      'La generación de imágenes no está configurada para este servicio.';

  @override
  String get cloudChatUseBankedResetTitle => '¿Usar un reinicio guardado?';

  @override
  String get cloudChatUseBankedResetBody =>
      'Tus límites de 5 horas y semanal vuelven a empezar ahora, y tu semana se reinicia hoy.';

  @override
  String get cloudChatUseReset => 'Usar reinicio';

  @override
  String get cloudChatLimitFreesSoon => 'Tu límite se libera pronto.';

  @override
  String get cloudChatResetsNow => 'Se restablece ahora.';

  @override
  String get cloudChatResetsTomorrow => 'Se restablece mañana.';

  @override
  String cloudChatResetsInDays(int days) {
    return 'Se restablece en $days días.';
  }

  @override
  String cloudChatResetsOn(String date) {
    return 'Se restablece el $date.';
  }

  @override
  String get cloudChatResetsInAMoment => 'Se restablece en un momento.';

  @override
  String cloudChatResetsInMinutes(int minutes) {
    String _temp0 = intl.Intl.pluralLogic(
      minutes,
      locale: localeName,
      other: 'Se restablece en $minutes minutos.',
      one: 'Se restablece en 1 minuto.',
    );
    return '$_temp0';
  }

  @override
  String cloudChatResetsInHours(int hours) {
    String _temp0 = intl.Intl.pluralLogic(
      hours,
      locale: localeName,
      other: 'Se restablece en $hours horas.',
      one: 'Se restablece en 1 hora.',
    );
    return '$_temp0';
  }

  @override
  String get cloudChatUsageLimitReached => 'Alcanzaste tu límite de uso';

  @override
  String get cloudChatRetryUsage => 'Reintentar uso';

  @override
  String cloudChatUseBankedReset(int count) {
    return 'Usar un reinicio guardado (quedan $count)';
  }

  @override
  String get cloudChatPickerFailed =>
      'No se pudo abrir el selector. Vuelve a intentarlo.';

  @override
  String get cloudChatModel => 'Modelo';

  @override
  String get cloudChatShareLink => 'Compartir enlace';

  @override
  String get cloudChatTaskPrompt => '¿En qué debería trabajar DJL?';

  @override
  String get cloudChatHowCanIHelp => '¿En qué te ayudo?';

  @override
  String get cloudChatTaskHint =>
      'Inicia una tarea y vuelve al resultado cuando esté listo.';

  @override
  String cloudChatStepProgress(String step, String total) {
    return 'Paso $step de $total';
  }

  @override
  String get cloudChatRetry => 'Reintentar';

  @override
  String get cloudChatRetryDraft => 'Reintentar borrador';

  @override
  String get cloudChatRetryModelChoice => 'Reintentar elección de modelo';

  @override
  String get cloudChatMessageHint => 'Escríbele a DJL';

  @override
  String get cloudChatAttachTooltip => 'Adjuntar archivo o imagen';

  @override
  String get cloudChatCreateImage => 'Crear imagen';

  @override
  String get cloudChatChooseFile => 'Elegir archivo';

  @override
  String get cloudChatPhotoLibrary => 'Fototeca';

  @override
  String get cloudChatCamera => 'Cámara';

  @override
  String get cloudChatTaskMode => 'Modo tarea';

  @override
  String get cloudChatTask => 'Tarea';

  @override
  String get cloudChatStopDictation => 'Detener dictado';

  @override
  String get cloudChatStartDictation => 'Iniciar dictado';

  @override
  String get cloudChatStopResponse => 'Detener respuesta';

  @override
  String get cloudChatSendMessage => 'Enviar mensaje';

  @override
  String get cloudChatEditMessage => 'Editar mensaje';

  @override
  String get cloudChatSend => 'Enviar';

  @override
  String get cloudChatDisableWordWrap => 'Desactivar ajuste de línea';

  @override
  String get cloudChatEnableWordWrap => 'Activar ajuste de línea';

  @override
  String get cloudChatCopied => 'Copiado';

  @override
  String get cloudChatCopyCode => 'Copiar código';

  @override
  String get cloudChatCodeLabel => 'Código';

  @override
  String get cloudChatEdit => 'Editar';

  @override
  String get cloudChatPreviousBranch => 'Versión anterior';

  @override
  String get cloudChatNextBranch => 'Versión siguiente';

  @override
  String get cloudChatCopyMessage => 'Copiar mensaje';

  @override
  String get cloudChatRegenerateReply => 'Regenerar respuesta';

  @override
  String get cloudChatStopReading => 'Dejar de leer';

  @override
  String get cloudChatReadAloud => 'Leer en voz alta';

  @override
  String get cloudChatReportAnswer => 'Reportar esta respuesta';

  @override
  String cloudChatToolResult(String name, String status) {
    return '$name · $status';
  }

  @override
  String get cloudChatToolFailed => 'Falló';

  @override
  String get cloudChatToolDone => 'Listo';

  @override
  String get cloudChatNeedsNewerVersion =>
      'Este mensaje tiene contenido que requiere una versión más reciente.';

  @override
  String get cloudChatImageUnavailableRetry =>
      'Imagen no disponible · Reintentar';

  @override
  String get cloudChatConversationImage => 'Imagen de la conversación';

  @override
  String get cloudChatImageDisplayFailed => 'No se pudo mostrar esta imagen.';

  @override
  String get cloudChatShareFailed =>
      'No se pudo abrir el menú para compartir. Vuelve a intentarlo.';

  @override
  String get cloudChatShareLinkCreated => 'Se creó el enlace para compartir';

  @override
  String get cloudChatShareLinkBody =>
      'Cualquier persona con el enlace puede leer este chat tal como está ahora. Los mensajes que envíes después no se comparten.';

  @override
  String get cloudChatCopyLink => 'Copiar enlace';

  @override
  String get cloudChatShare => 'Compartir';

  @override
  String get conversationsPinned => 'Fijados';

  @override
  String get conversationsPinnedEmpty =>
      'Mantén presionado un chat para fijarlo.';

  @override
  String get conversationsRecentEmpty => 'Tus conversaciones aparecen aquí.';

  @override
  String get conversationsCloudConversationHint => 'Conversación en la nube';

  @override
  String get conversationsChat => 'Chat';

  @override
  String get conversationsSearchChats => 'Buscar chats';

  @override
  String get conversationsRemote => 'Remoto';

  @override
  String get conversationsRecentChats => 'Chats recientes';

  @override
  String get conversationsLoadMore => 'Cargar más';

  @override
  String get conversationsSettings => 'Configuración';

  @override
  String get conversationsArchivedChats => 'Chats archivados';

  @override
  String get conversationsRestore => 'Restaurar';

  @override
  String get conversationsNoArchivedChats => 'No hay chats archivados';

  @override
  String get conversationsPin => 'Fijar';

  @override
  String get conversationsUnpin => 'Dejar de fijar';

  @override
  String get conversationsRename => 'Cambiar nombre';

  @override
  String get conversationsArchive => 'Archivar';

  @override
  String get conversationsDelete => 'Eliminar';

  @override
  String get conversationsDeleteChatQuestion => '¿Eliminar este chat?';

  @override
  String get plansCompleted => 'Completado';

  @override
  String get plansInProgress => 'En curso';

  @override
  String get plansPending => 'Pendiente';

  @override
  String get plansOpenActivePlan => 'Abrir plan activo';

  @override
  String get plansPlan => 'Plan';

  @override
  String plansStepOf(int current, int total) {
    return 'Paso $current de $total';
  }

  @override
  String plansStepFraction(int current, int total) {
    return 'Paso $current / $total';
  }

  @override
  String plansStatusValue(String status, String position) {
    return '$status, $position';
  }

  @override
  String get plansImage => 'Imagen';

  @override
  String get plansActivePlan => 'Plan activo';

  @override
  String get plansDone => 'Listo';

  @override
  String get plansNoLongerAvailable => 'Este plan ya no está disponible.';

  @override
  String get plansProposedPlan => 'Plan propuesto';

  @override
  String get plansCollapsePlan => 'Contraer plan';

  @override
  String get plansExpandPlan => 'Expandir plan';

  @override
  String get plansCollapse => 'Contraer';

  @override
  String get plansExpand => 'Expandir';

  @override
  String get plansStarting => 'Iniciando...';

  @override
  String get plansImplement => 'Implementar';

  @override
  String get plansNextStepQuestion =>
      '¿Qué debería hacer Codex a continuación?';

  @override
  String get plansNextStepHeader => 'Siguiente paso';

  @override
  String get voiceAllowMicrophone =>
      'Permite el acceso al micrófono y al reconocimiento de voz en la configuración del dispositivo para dictar.';

  @override
  String get voiceDictationUnavailable =>
      'El dictado en el dispositivo no está disponible para este idioma o dispositivo. Aún puedes escribir tu mensaje.';

  @override
  String get voiceSpeechAccessRequired =>
      'Permite el acceso al micrófono y al reconocimiento de voz en la configuración del dispositivo. El reconocimiento de voz en el dispositivo debe estar disponible para tu idioma.';

  @override
  String get voiceInputUnavailable =>
      'La entrada de voz no está disponible. Aún puedes escribir tu mensaje.';

  @override
  String get voiceStopFailed => 'No se pudo detener la entrada de voz.';

  @override
  String get voicePlaybackUnavailable =>
      'La lectura en voz alta no está disponible en este dispositivo.';

  @override
  String get voiceStopUnclean =>
      'La voz no se detuvo correctamente. Cierra esta pantalla antes de continuar.';

  @override
  String get goalsStatusActive => 'Activo';

  @override
  String get goalsStatusPaused => 'En pausa';

  @override
  String get goalsStatusBlocked => 'Bloqueado';

  @override
  String get goalsStatusUsageLimited => 'Límite de uso';

  @override
  String get goalsStatusBudgetLimited => 'Límite de presupuesto';

  @override
  String get goalsStatusComplete => 'Completado';

  @override
  String goalsTokenUsage(String used, String budget) {
    return '$used / $budget tokens';
  }

  @override
  String get goalsUnsupported =>
      'Los objetivos no están disponibles en este entorno. Actualiza Codex en tu Mac y activa los objetivos.';

  @override
  String get goalsEphemeral =>
      'Los objetivos necesitan un chat guardado. Este chat es temporal.';

  @override
  String get goalsDesktopChanged =>
      'La computadora conectada cambió. Vuelve a abrir este objetivo.';

  @override
  String get goalsOtherChatGoal =>
      'El entorno devolvió el objetivo de otro chat.';

  @override
  String get goalsBudgetInvalid =>
      'El presupuesto de tokens debe ser un número entero positivo.';

  @override
  String get goalsUnexpectedResponse =>
      'El entorno devolvió una respuesta inesperada sobre el objetivo.';

  @override
  String get goalsReconnect =>
      'Vuelve a conectarte a tu computadora para administrar este objetivo.';

  @override
  String get goalsDescribeFirst => 'Primero describe el objetivo.';

  @override
  String get goalsReplaceTitle => '¿Reemplazar el objetivo actual?';

  @override
  String get goalsReplaceBody =>
      'Este objetivo no está completo. Al reemplazarlo se inicia uno nuevo y se reinicia el conteo de uso.';

  @override
  String get goalsReplaceAction => 'Reemplazar objetivo';

  @override
  String get goalsClearTitle => '¿Borrar este objetivo?';

  @override
  String get goalsClearBody =>
      'La computadora deja de trabajar en este objetivo y borra el conteo de progreso.';

  @override
  String get goalsClearAction => 'Borrar objetivo';

  @override
  String get goalsTitle => 'Objetivo';

  @override
  String get goalsReload => 'Recargar objetivo';

  @override
  String get goalsShowingLastKnown =>
      'Se muestra el último objetivo conocido. Vuelve a conectarte para administrarlo.';

  @override
  String get goalsNewGoal => 'Nuevo objetivo';

  @override
  String get goalsEditGoal => 'Editar objetivo';

  @override
  String get goalsDescribeHint =>
      'Describe el resultado, cómo verificarlo y qué no debe dejar de funcionar.';

  @override
  String get goalsObjective => 'Objetivo';

  @override
  String get goalsBudgetLabel => 'Presupuesto de tokens (opcional)';

  @override
  String get goalsBudgetHelper =>
      'Déjalo vacío para no fijar un presupuesto de tokens.';

  @override
  String get goalsStart => 'Iniciar objetivo';

  @override
  String get goalsSave => 'Guardar objetivo';

  @override
  String get goalsCancelEditing => 'Cancelar edición';

  @override
  String goalsTokensRemaining(String tokens) {
    return 'Quedan $tokens tokens';
  }

  @override
  String get goalsActiveExplainer =>
      'La computadora sigue trabajando en este objetivo cuando el chat está inactivo, hasta que se complete, se pause o llegue a un límite.';

  @override
  String get goalsPause => 'Pausar objetivo';

  @override
  String get goalsResume => 'Reanudar objetivo';

  @override
  String get goalsEditObjective => 'Editar objetivo';

  @override
  String get groupsKindSpreadsheet => 'Hoja de cálculo';

  @override
  String get groupsKindText => 'Texto';

  @override
  String get groupsKindArchive => 'Archivo comprimido';

  @override
  String get groupsKindImage => 'Imagen';

  @override
  String get groupsKindVideo => 'Video';

  @override
  String get groupsKindAudio => 'Audio';

  @override
  String get groupsKindFile => 'Archivo';

  @override
  String get groupsMacUnreachable =>
      'No se pudo conectar con tu Mac. Vuelve a intentarlo.';

  @override
  String get groupsCreateFailed =>
      'No se pudo crear el grupo. Vuelve a intentarlo.';

  @override
  String get groupsNewGroup => 'Nuevo grupo';

  @override
  String get groupsChooseMembers => 'Elige quién participa en el chat.';

  @override
  String get groupsNameOptional => 'Nombre (opcional)';

  @override
  String get groupsCreateGroup => 'Crear grupo';

  @override
  String groupsCreateGroupWith(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Crear grupo con $count agentes',
      one: 'Crear grupo con 1 agente',
    );
    return '$_temp0';
  }

  @override
  String get groupsSignInOnMac => 'Inicia sesión en tu Mac para usarlo';

  @override
  String get groupsUpdateMacTitle => 'Actualiza DJL en tu Mac';

  @override
  String get groupsUpdateMacBody =>
      'Los chats grupales necesitan la versión más reciente de DJL en tu Mac. Actualízala ahí y vuelve.';

  @override
  String get groupsConnectMacTitle => 'Conéctate a tu Mac';

  @override
  String get groupsConnectMacBody =>
      'Los chats grupales viven en tu Mac. Aparecen aquí cuando está conectada.';

  @override
  String get groupsLoadFailed => 'No se pudieron cargar tus grupos';

  @override
  String get groupsEmptyTitle => 'Reúne a tus agentes en un chat';

  @override
  String get groupsEmptyBody =>
      'Haz una pregunta una sola vez y deja que Claude, Codex y los demás respondan juntos.';

  @override
  String groupsMemberWriting(String name) {
    return '$name está escribiendo';
  }

  @override
  String groupsAgentsWriting(int count) {
    return '$count agentes están escribiendo';
  }

  @override
  String get groupsPausedWaiting => 'En pausa, esperándote';

  @override
  String groupsAgentCount(int count) {
    return '$count agentes';
  }

  @override
  String get groupsMacDidNotKeepFile => 'Tu Mac no guardó el archivo.';

  @override
  String get groupsFileStillSending => 'Este archivo aún se está enviando.';

  @override
  String get groupsMacTimeout =>
      'Tu Mac no respondió a tiempo. Comprueba que DJL esté abierto en ella.';

  @override
  String get groupsMacNotConnected =>
      'Tu Mac no está conectada en este momento.';

  @override
  String groupsRemoveAttachment(String name) {
    return 'Quitar $name';
  }

  @override
  String get groupsSendingFiles => 'Enviando archivos';

  @override
  String groupsImageNamed(String name) {
    return 'Imagen $name';
  }

  @override
  String get groupsAttach => 'Adjuntar';

  @override
  String get groupsPhotos => 'Fotos';

  @override
  String get groupsFiles => 'Archivos';

  @override
  String groupsFileUnsupported(String name) {
    return 'No se puede enviar $name. Se admiten fotos, PDF, Word, Excel, PowerPoint, texto y archivos de código.';
  }

  @override
  String groupsFileTooLarge(String name, String size) {
    return '$name pesa más de $size.';
  }

  @override
  String groupsTooManyFiles(int count) {
    return 'Un mensaje puede llevar $count archivos.';
  }

  @override
  String get groupsOpenFailed => 'No se pudo abrir. Vuelve a intentarlo.';

  @override
  String get groupsAskEveryoneTitle => '¿Preguntarles a todos?';

  @override
  String groupsAskEveryoneBody(int count) {
    return 'Los $count agentes responderán este mensaje.';
  }

  @override
  String get groupsDontAskAgain => 'No volver a preguntar';

  @override
  String get groupsAskEveryone => 'Preguntar a todos';

  @override
  String get groupsGroupGone => 'Este grupo ya no está en tu Mac.';

  @override
  String groupsSayHelloPrompt(String everyone) {
    return '$everyone Saluden en una sola línea.';
  }

  @override
  String get groupsReconnectingToMac => 'Reconectando con tu Mac…';

  @override
  String groupsHeaderLabel(String name, int count) {
    return '$name, $count agentes';
  }

  @override
  String get groupsMembers => 'Miembros';

  @override
  String get groupsYou => 'Tú';

  @override
  String get groupsCouldNotReply => 'No pudo responder';

  @override
  String get groupsNothingToAdd => 'Nada que agregar';

  @override
  String get groupsImageOnMac => 'Imagen en tu Mac';

  @override
  String get groupsRemovedAgent => 'Agente eliminado';

  @override
  String get groupsWaitingTurn => 'Esperando su turno';

  @override
  String get groupsWriting => 'Escribiendo';

  @override
  String get groupsAttachTooltip => 'Adjuntar archivos o fotos';

  @override
  String get groupsMentionAgent => 'Mencionar a un agente';

  @override
  String get groupsMessageHint => 'Mensaje';

  @override
  String get groupsStopAgents => 'Detener a los agentes';

  @override
  String get groupsEveryone => 'Todos';

  @override
  String get groupsPausedTitle => 'Los agentes hicieron una pausa';

  @override
  String get groupsPausedBody =>
      'Llevan un rato hablando entre ellos y tienen más que decir.';

  @override
  String get groupsEndItHere => 'Terminar aquí';

  @override
  String get groupsLetThemContinue => 'Dejar que sigan';

  @override
  String get groupsOfflineHint =>
      'Los mensajes aparecen aquí cuando tu Mac está conectada.';

  @override
  String get groupsLoadingMessages => 'Cargando mensajes';

  @override
  String get groupsEveryoneIsHere => 'Ya están todos';

  @override
  String get groupsEmptyChatHint =>
      'Escribe @ para elegir quién responde. Tu primer mensaje va para todos.';

  @override
  String get groupsAskEveryoneToSayHello => 'Pedirles a todos que saluden';

  @override
  String get groupsManageOnMac => 'Agrega o quita agentes en DJL en tu Mac.';

  @override
  String get groupsReady => 'Listo';

  @override
  String get groupsStop => 'Detener';

  @override
  String get guardianLiveReason =>
      'Las aprobaciones para reintentar solo están disponibles durante la sesión en vivo.';

  @override
  String get guardianExpiredReason =>
      'Este reintento ya no está disponible. Espera a que Codex vuelva a solicitar la acción.';

  @override
  String get guardianDesktopReason =>
      'Aprueba este reintento en Codex Desktop.';

  @override
  String get guardianUnsafeReason =>
      'Esta acción no se puede reintentar de forma segura aquí. Apruébala en Codex.';

  @override
  String get guardianSubmittedReason =>
      'Se envió la aprobación para reintentar. Revisa Codex antes de volver a intentarlo.';

  @override
  String get guardianUncertainReason =>
      'Es posible que la aprobación para reintentar no haya llegado a Codex. Revisa Codex antes de volver a intentarlo.';

  @override
  String get guardianRequestedAction => 'Acción solicitada';

  @override
  String get guardianRunCommand => 'Ejecutar comando';

  @override
  String get guardianApplyFileChanges => 'Aplicar cambios en archivos';

  @override
  String guardianEditFile(String file) {
    return 'Editar $file';
  }

  @override
  String guardianEditFiles(int count, String files) {
    return 'Editar $count archivos: $files';
  }

  @override
  String get guardianAccessNetwork => 'Acceder a la red';

  @override
  String guardianAccessHost(String host) {
    return 'Acceder a $host';
  }

  @override
  String get guardianRequestPermissions => 'Solicitar permisos adicionales';

  @override
  String get guardianRequestNetwork => 'Solicitar acceso a la red';

  @override
  String get guardianRequestFileAccess => 'Solicitar acceso a archivos';

  @override
  String get guardianRequestNetworkAndFileAccess =>
      'Solicitar acceso a la red y a archivos';

  @override
  String get guardianReviewing => 'En revisión';

  @override
  String get guardianApproved => 'Aprobado';

  @override
  String get guardianDenied => 'Denegado';

  @override
  String get guardianTimedOut => 'Tiempo agotado';

  @override
  String get guardianStopped => 'Detenido';

  @override
  String guardianUpdatedStatus(String status) {
    return 'Actualizado ($status)';
  }

  @override
  String get guardianDetailsUnavailable =>
      'Los detalles de la revisión no están disponibles.';

  @override
  String guardianAutoReviewTitle(String status) {
    return 'Revisión automática · $status';
  }

  @override
  String get guardianRiskLow => 'Riesgo bajo';

  @override
  String get guardianRiskMedium => 'Riesgo medio';

  @override
  String get guardianRiskHigh => 'Riesgo alto';

  @override
  String guardianRiskOther(String level) {
    return 'Riesgo: $level';
  }

  @override
  String guardianAuthorization(String value) {
    return 'Autorización: $value';
  }

  @override
  String get guardianApprovalRecorded =>
      'Aprobación registrada; el reintento se revisará de todos modos';

  @override
  String get guardianSubmittingApproval =>
      'Enviando aprobación para reintentar…';

  @override
  String get guardianApproveOneRetry => 'Aprobar un reintento';

  @override
  String get subagentsSubagent => 'Subagente';

  @override
  String get subagentsSpawnAgent => 'Crear agente';

  @override
  String get subagentsWaitForAgents => 'Esperar a los agentes';

  @override
  String get subagentsUpdateAgent => 'Actualizar agente';

  @override
  String get subagentsResumeAgent => 'Reanudar agente';

  @override
  String get subagentsCloseAgent => 'Cerrar agente';

  @override
  String get subagentsActivity => 'Actividad de subagentes';

  @override
  String get subagentsMetadataUnavailable =>
      'Metadatos del subagente no disponibles';

  @override
  String get activityCommand => 'Comando';

  @override
  String get activityFileChanges => 'Cambios en archivos';

  @override
  String activityFilesChanged(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count archivos modificados',
      one: '1 archivo modificado',
    );
    return '$_temp0';
  }

  @override
  String get activityToolActivity => 'Actividad de herramientas';

  @override
  String get activityReadFile => 'Leer archivo';

  @override
  String activityReadValue(String value) {
    return 'Leer $value';
  }

  @override
  String get activitySearchFiles => 'Buscar archivos';

  @override
  String activitySearchValue(String value) {
    return 'Buscar $value';
  }

  @override
  String get activityListFiles => 'Listar archivos';

  @override
  String activityListFilesValue(String value) {
    return 'Listar archivos $value';
  }

  @override
  String get statusTaskStatus => 'Estado de tareas';

  @override
  String get statusAllowed =>
      'El estado de tareas está permitido en este dispositivo.';

  @override
  String get statusDenied =>
      'Permite el estado de tareas local en la configuración del dispositivo. El chat funciona sin él.';

  @override
  String get statusUnsupported =>
      'El estado de tareas no está disponible en este dispositivo.';

  @override
  String get statusChecking => 'Comprobando el permiso del dispositivo…';

  @override
  String get statusEnable => 'Activar';

  @override
  String get statusRefresh => 'Actualizar estado de tareas';

  @override
  String get statusSystemSettings => 'Abrir Configuración';

  @override
  String pairingStateLabel(String state) {
    String _temp0 = intl.Intl.selectLogic(state, {
      'disconnected': 'desconectado',
      'resolving': 'resolviendo',
      'connecting': 'conectando',
      'connected': 'conectado',
      'offline': 'computadora sin conexión',
      'suspended': 'suspendido',
      'other': '$state',
    });
    return '$_temp0';
  }

  @override
  String get settingsLanguage => 'Idioma';

  @override
  String get settingsLanguageSystem => 'Predeterminado del sistema';

  @override
  String get workspaceUndoNoExactPatch =>
      'No se capturó un parche unificado exacto y completo.';

  @override
  String get workspaceUndoRenames =>
      'Los cambios de nombre no se pueden deshacer aquí.';

  @override
  String get workspaceUndoBinary =>
      'Los cambios binarios, de nombre, de modo o de enlaces simbólicos no se pueden deshacer aquí.';
}
