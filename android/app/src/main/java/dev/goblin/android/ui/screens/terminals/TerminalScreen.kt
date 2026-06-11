package dev.goblin.android.ui.screens.terminals

import android.app.SearchManager
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import dev.goblin.android.domain.ssh.RemoteTarget
import dev.goblin.android.domain.ssh.SshHostProfile
import dev.goblin.android.notifications.NotificationPermissionPolicy
import dev.goblin.android.terminals.TerminalForegroundBridge
import dev.goblin.android.terminals.TerminalSessionManager
import dev.goblin.android.terminals.TerminalSessionRecord
import dev.goblin.android.terminals.TerminalSessionState
import dev.goblin.android.terminals.TerminalSessionStatus
import dev.goblin.android.ui.screens.terminals.terminalWorkspaceCreatedSessions
import dev.goblin.android.terminals.toTerminalSessionState
import dev.goblin.android.ui.theme.GoblinColors
import dev.goblin.android.ui.theme.GoblinSpacing
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal val TerminalCommandInputHeight = 40.dp
internal val TerminalActionButtonHeight = 36.dp
private val TerminalSwitchArrowButtonMinWidth = 38.dp
private val TerminalSwitchArrowFontSize = 18.sp
private val TerminalCommandInputShape = RoundedCornerShape(6.dp)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TerminalScreen(
    host: SshHostProfile,
    remotePath: String = "/",
    repositoryId: String? = null,
    targetLabel: String = terminalTargetLabel(host.title, remotePath),
    backHint: String = TerminalBackKeepsSessionHint,
    terminalSessionId: String? = null,
    terminalSessionManager: TerminalSessionManager,
    terminalForegroundBridge: TerminalForegroundBridge,
    fitToScreen: Boolean,
    onFitToScreenChange: (Boolean) -> Unit,
    onSwitchGlobalTerminal: (TerminalSessionRecord) -> Unit,
    onBack: (String?) -> Unit,
) {
    var terminalState: TerminalSessionState by remember { mutableStateOf(TerminalSessionState.Idle) }
    var activeSessionId by remember(host, remotePath, repositoryId, terminalSessionId) {
        mutableStateOf(terminalSessionId)
    }
    var terminalSessions by remember { mutableStateOf(terminalSessionManager.sessions()) }
    var ctrlModifierActive by remember { mutableStateOf(false) }
    var terminalMaximized by remember { mutableStateOf(TerminalDefaultMaximized) }
    var terminalFontSizeSp by remember { mutableStateOf(TerminalDefaultFontSizeSp) }
    var commandInputVisible by remember { mutableStateOf(TerminalCommandInputDefaultVisible) }
    var isSendingCommandInput by remember { mutableStateOf(false) }
    var commandInput by remember(activeSessionId) { mutableStateOf("") }
    var terminalActionMenuExpanded by remember { mutableStateOf(false) }
    var closeConfirmationVisible by remember { mutableStateOf(false) }
    val clipboard = LocalClipboard.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val target = remember(host, remotePath) { RemoteTarget.fromHostProfile(host, remotePath) }
    val workspaceHostId = target.id
    val workspaceHostIds = remember(host.id, workspaceHostId) { setOf(host.id, workspaceHostId) }
    var inputNotice by remember { mutableStateOf<String?>(null) }
    var notificationPermissionRequested by remember { mutableStateOf(false) }
    val inputAvailable = terminalInputAvailable(terminalState)
    val notificationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) {
        terminalForegroundBridge.sync()
    }
    val activeTerminalPath = remotePath.ifBlank { "/" }

    fun openTerminalUrl(url: String): Boolean {
        val safeUrl = terminalSafeExternalUrl(url)
        if (safeUrl == null) {
            inputNotice = "URL is not supported."
            return false
        }
        return try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(safeUrl)))
            inputNotice = null
            true
        } catch (_: ActivityNotFoundException) {
            inputNotice = "No browser available."
            false
        } catch (_: Exception) {
            inputNotice = "Could not open browser."
            false
        }
    }

    fun searchTerminalText(query: String): Boolean {
        if (query.isBlank()) {
            inputNotice = "Selection is empty."
            return false
        }
        return try {
            context.startActivity(
                Intent(Intent.ACTION_WEB_SEARCH)
                    .putExtra(SearchManager.QUERY, query),
            )
            inputNotice = null
            true
        } catch (_: ActivityNotFoundException) {
            inputNotice = "No browser available."
            false
        } catch (_: Exception) {
            inputNotice = "Could not open browser."
            false
        }
    }

    fun openSelectedTerminalText(text: String): Boolean {
        val action = terminalSelectedTextBrowserAction(text)
        if (action == null) {
            inputNotice = "Selection is empty."
            return false
        }
        return when (action) {
            is TerminalSelectedTextBrowserAction.OpenUrl -> openTerminalUrl(action.url)
            is TerminalSelectedTextBrowserAction.Search -> searchTerminalText(action.query)
        }
    }

    fun copyTerminalSelection(text: String): Boolean {
        if (text.isBlank()) {
            inputNotice = "Selection is empty."
            return false
        }
        return try {
            val manager = ContextCompat.getSystemService(context, ClipboardManager::class.java)
            if (manager == null) {
                inputNotice = "Copy failed."
                false
            } else {
                manager.setPrimaryClip(ClipData.newPlainText("Goblin terminal selection", text))
                inputNotice = "Copied."
                true
            }
        } catch (_: Exception) {
            inputNotice = "Copy failed."
            false
        }
    }

    fun syncTerminalForeground() {
        val permissionGranted = ContextCompat.checkSelfPermission(
            context,
            NotificationPermissionPolicy.Permission,
        ) == PackageManager.PERMISSION_GRANTED
        val hasRunningTerminal = terminalSessionManager.sessions().any { it.status == TerminalSessionStatus.Running }
        if (
            !notificationPermissionRequested &&
            NotificationPermissionPolicy.shouldRequestNotificationPermission(
                sdkInt = Build.VERSION.SDK_INT,
                permissionGranted = permissionGranted,
                foregroundNotificationNeeded = hasRunningTerminal,
            )
        ) {
            notificationPermissionRequested = true
            notificationPermissionLauncher.launch(NotificationPermissionPolicy.Permission)
        }
        terminalForegroundBridge.sync()
    }

    fun connect() {
        scope.launch {
            val record = withContext(Dispatchers.IO) {
                val sessionId = activeSessionId
                if (sessionId != null && terminalReconnectAvailable(terminalState)) {
                    terminalSessionManager.reconnect(
                        sessionId = sessionId,
                        target = target,
                        repositoryId = repositoryId,
                        targetLabel = targetLabel,
                    )
                } else {
                    terminalSessionManager.createOrAttach(
                        target = target,
                        repositoryId = repositoryId,
                        targetLabel = targetLabel,
                    )
                }
            }
            if (record != null) {
                activeSessionId = record.id
                terminalState = record.toTerminalSessionState()
            }
            syncTerminalForeground()
        }
    }

    fun sendTerminalInputLocked(
        value: String,
        isSending: Boolean,
        setSending: (Boolean) -> Unit,
        onResult: (Boolean) -> Unit = {},
    ) {
        if (isSending) return
        setSending(true)
        scope.launch {
            val sent = try {
                val sessionId = activeSessionId
                withContext(Dispatchers.IO) {
                    sessionId?.let { terminalSessionManager.sendInput(it, value) } ?: false
                }
            } catch (_: Exception) {
                false
            }
            syncTerminalForeground()
            setSending(false)
            onResult(sent)
        }
    }

    fun sendCommandInput() {
        val value = commandInput
        if (value.isEmpty()) return
        sendTerminalInputLocked(
            value = terminalLineInput(value),
            isSending = isSendingCommandInput,
            setSending = { isSendingCommandInput = it },
        ) { sent ->
            if (sent) {
                commandInput = ""
                inputNotice = null
            } else {
                inputNotice = terminalInputUnavailableMessage(terminalState) ?: "Terminal is not connected."
            }
        }
    }

    fun closeTerminal() {
        scope.launch {
            val sessionId = activeSessionId
            withContext(Dispatchers.IO) {
                if (sessionId != null) terminalSessionManager.close(sessionId)
            }
            syncTerminalForeground()
            onBack(sessionId)
        }
    }

    fun requestCloseTerminal() {
        closeConfirmationVisible = true
    }

    fun sendControlInput(value: String) {
        sendTerminalInputLocked(
            value = value,
            isSending = false,
            setSending = { _ -> },
        ) { sent ->
            inputNotice = if (sent) null else "Terminal is not connected."
        }
        ctrlModifierActive = false
    }

    fun switchToSession(targetSessionId: String) {
        if (targetSessionId == activeSessionId) return
        val targetSession = terminalSessionManager.session(targetSessionId) ?: return
        activeSessionId = targetSessionId
        terminalState = targetSession.toTerminalSessionState()
    }

    fun cycleWorkspaceTerminal(direction: Int) {
        val availableSessions = terminalWorkspaceCreatedSessions(
            sessions = terminalSessions,
            hostIds = workspaceHostIds,
            remotePath = activeTerminalPath,
        )
        if (availableSessions.size <= 1) return
        val currentIndex = availableSessions.indexOfFirst { it.id == activeSessionId }.takeIf { it >= 0 } ?: 0
        val nextIndex = (currentIndex + direction).mod(availableSessions.size)
        switchToSession(availableSessions[nextIndex].id)
    }

    fun cycleGlobalProjectTerminal(direction: Int) {
        val availableSessions = terminalGlobalProjectCreatedSessions(terminalSessions)
        val targetSessionId = terminalCycleSessionId(
            sessions = availableSessions,
            activeSessionId = activeSessionId,
            direction = direction,
        ) ?: return
        val targetSession = availableSessions.firstOrNull { it.id == targetSessionId } ?: return
        onSwitchGlobalTerminal(targetSession)
    }

    DisposableEffect(activeSessionId) {
        val sessionId = activeSessionId
        if (sessionId == null) {
            onDispose { }
        } else {
            val observer = terminalSessionManager.observe(sessionId) { record ->
                scope.launch {
                    terminalState = record.toTerminalSessionState()
                    syncTerminalForeground()
                }
            }
            onDispose {
                observer.close()
            }
        }
    }

    DisposableEffect(terminalSessionManager) {
        val observer = terminalSessionManager.observeSessions { sessions ->
            scope.launch {
                terminalSessions = sessions
            }
        }
        onDispose { observer.close() }
    }

    LaunchedEffect(target, repositoryId, targetLabel, terminalSessionId) {
        val record = withContext(Dispatchers.IO) {
            terminalSessionId
                ?.let { terminalSessionManager.session(it) }
                ?: terminalSessionManager.createOrAttach(
                    target = target,
                    repositoryId = repositoryId,
                    targetLabel = targetLabel,
                )
        }
        activeSessionId = record.id
        terminalState = record.toTerminalSessionState()
        syncTerminalForeground()
    }

    LaunchedEffect(terminalState) {
        inputNotice = terminalInputUnavailableMessage(terminalState)
    }

    LaunchedEffect(terminalSessions, activeSessionId, workspaceHostIds, activeTerminalPath) {
        val workspaceSessions = terminalWorkspaceCreatedSessions(
            sessions = terminalSessions,
            hostIds = workspaceHostIds,
            remotePath = activeTerminalPath,
        )
        val workspaceSession = workspaceSessions.maxByOrNull { it.openedAt }
        val fallbackSession = workspaceSession ?: terminalSessions.maxByOrNull { it.openedAt }
        if (activeSessionId == null && fallbackSession != null) {
            switchToSession(fallbackSession.id)
        } else if (activeSessionId != null && terminalSessions.none { it.id == activeSessionId }) {
            if (fallbackSession != null) {
                switchToSession(fallbackSession.id)
            } else {
                activeSessionId = null
                terminalState = TerminalSessionState.Idle
            }
        }
    }

    val screenTitle = terminalScreenTitle(
        sessionId = activeSessionId,
        sessions = terminalSessions,
        hostIds = workspaceHostIds,
        remotePath = remotePath,
    )
    val workspaceSessions = terminalWorkspaceCreatedSessions(
        sessions = terminalSessions,
        hostIds = workspaceHostIds,
        remotePath = activeTerminalPath,
    )
    val hasWorkspaceSwitchTargets = workspaceSessions.size > 1
    val globalProjectSessions = terminalGlobalProjectCreatedSessions(terminalSessions)
    val hasGlobalSwitchTargets = globalProjectSessions.size > 1
    val inlineActions = terminalDetailInlineActions(terminalState)
    val topBarInfo = terminalStatusLine(host = host, remotePath = remotePath, state = terminalState)
    val emulatorController = activeSessionId?.let { terminalSessionManager.emulatorController(it) }
    val commandInputEnabled = terminalCommandInputEnabled(terminalState) && !isSendingCommandInput

    val navigateBack = {
        if (terminalMaximized) {
            terminalMaximized = false
        } else {
            onBack(activeSessionId)
        }
    }

    BackHandler {
        navigateBack()
    }

    Scaffold(
        topBar = {
            if (terminalTopBarVisible(terminalMaximized)) TopAppBar(
                modifier = Modifier.height(56.dp),
                title = {
                    Column {
                        Text(
                            text = screenTitle,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            style = MaterialTheme.typography.titleSmall,
                        )
                        Text(
                            text = topBarInfo,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                },
                navigationIcon = {
                    TextButton(onClick = { navigateBack() }) {
                        Text("BACK")
                    }
                },
                actions = {
                    Box {
                        TextButton(onClick = { terminalActionMenuExpanded = true }) {
                            Text("⋮")
                        }
                        DropdownMenu(
                            expanded = terminalActionMenuExpanded,
                            onDismissRequest = { terminalActionMenuExpanded = false },
                        ) {
                            DropdownMenuItem(
                                text = {
                                    Text(
                                        if (fitToScreen) "Original width" else "Fit to screen width",
                                    )
                                },
                                onClick = {
                                    onFitToScreenChange(!fitToScreen)
                                    terminalActionMenuExpanded = false
                                },
                            )
                            DropdownMenuItem(
                                text = { Text(terminalMaximizeActionLabel(terminalMaximized)) },
                                onClick = {
                                    terminalMaximized = !terminalMaximized
                                    terminalActionMenuExpanded = false
                                },
                            )
                            DropdownMenuItem(
                                text = { Text(terminalCommandInputVisibilityActionLabel(commandInputVisible)) },
                                onClick = {
                                    commandInputVisible = !commandInputVisible
                                    terminalActionMenuExpanded = false
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Font size: ${terminalFontSizeSp}sp") },
                                enabled = false,
                                onClick = {},
                            )
                            DropdownMenuItem(
                                text = { Text("Font smaller") },
                                enabled = terminalFontSizeSp > TerminalMinFontSizeSp,
                                onClick = {
                                    terminalFontSizeSp = terminalAdjustedFontSize(terminalFontSizeSp, -1)
                                    terminalActionMenuExpanded = false
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Font larger") },
                                enabled = terminalFontSizeSp < TerminalMaxFontSizeSp,
                                onClick = {
                                    terminalFontSizeSp = terminalAdjustedFontSize(terminalFontSizeSp, 1)
                                    terminalActionMenuExpanded = false
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Reset font size") },
                                enabled = terminalFontSizeSp != TerminalDefaultFontSizeSp,
                                onClick = {
                                    terminalFontSizeSp = TerminalDefaultFontSizeSp
                                    terminalActionMenuExpanded = false
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Reconnect terminal") },
                                enabled = terminalReconnectAvailable(terminalState),
                                onClick = {
                                    terminalActionMenuExpanded = false
                                    if (terminalReconnectAvailable(terminalState)) {
                                        connect()
                                    }
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Close terminal") },
                                onClick = {
                                    terminalActionMenuExpanded = false
                                    requestCloseTerminal()
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Back") },
                                onClick = {
                                    terminalActionMenuExpanded = false
                                    navigateBack()
                                },
                            )
                        }
                    }
                },
            )
        },
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .background(GoblinColors.TerminalBackground)
                    .imePadding()
                    .padding(GoblinSpacing.Md),
                verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm),
            ) {
                AndroidTerminalViewport(
                    modifier = Modifier.weight(1f),
                    state = terminalState,
                    emulatorController = emulatorController,
                    fitToScreen = fitToScreen,
                    fontSizeSp = terminalFontSizeSp,
                    onOpenUrl = { openTerminalUrl(it) },
                    onCopyText = ::copyTerminalSelection,
                    onOpenSelectedText = ::openSelectedTerminalText,
                )
                HelperKeyRow(
                    enabled = inputAvailable,
                    ctrlModifierActive = ctrlModifierActive,
                    onCtrlToggle = { ctrlModifierActive = !ctrlModifierActive },
                    onCtrlC = { sendControlInput("\u0003") },
                    onCtrlL = { sendControlInput(terminalControlCharacter('L') ?: "\u000C") },
                    onEnter = { sendTerminalInputLocked("\r", false, { _ -> }) },
                    onBackspace = { sendTerminalInputLocked("\u007F", false, { _ -> }) },
                    onEsc = { sendTerminalInputLocked("\u001b", false, { _ -> }) },
                    onTab = { sendTerminalInputLocked("\t", false, { _ -> }) },
                    onArrow = { code -> sendTerminalInputLocked(code, false, { _ -> }) },
                    onPaste = {
                        val unavailable = terminalInputUnavailableMessage(terminalState)
                        if (unavailable != null) {
                            inputNotice = unavailable
                            return@HelperKeyRow
                        }
                        scope.launch {
                            val text = clipboard.getClipEntry()
                                ?.clipData
                                ?.getItemAt(0)
                                ?.coerceToText(context)
                                ?.toString()
                                .orEmpty()
                            val pasted = withContext(Dispatchers.IO) {
                                activeSessionId?.let { terminalSessionManager.paste(it, text) } ?: false
                            }
                            syncTerminalForeground()
                            inputNotice = if (pasted) null else "Terminal is not connected."
                        }
                    },
                )
                if (commandInputVisible) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CompactCommandInput(
                            modifier = Modifier.weight(1f),
                            value = commandInput,
                            onValueChange = { commandInput = it },
                            enabled = commandInputEnabled,
                            placeholder = terminalCommandInputPlaceholder(terminalState),
                            onSend = { sendCommandInput() },
                        )
                        TerminalTextButton(
                            text = "Send",
                            enabled = commandInputEnabled && commandInput.isNotEmpty(),
                            onClick = { sendCommandInput() },
                        )
                    }
                }
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs),
                ) {
                    if (hasGlobalSwitchTargets) {
                        TerminalSwitchArrowButton(text = "⇈", onClick = { cycleGlobalProjectTerminal(-1) })
                        TerminalSwitchArrowButton(text = "⇊", onClick = { cycleGlobalProjectTerminal(1) })
                    }
                    if (hasWorkspaceSwitchTargets) {
                        TerminalSwitchArrowButton(text = "↑", onClick = { cycleWorkspaceTerminal(-1) })
                        TerminalSwitchArrowButton(text = "↓", onClick = { cycleWorkspaceTerminal(1) })
                    }
                    if (terminalRestoreInlineActionVisible(terminalMaximized)) {
                        TerminalTextButton(
                            text = "Restore",
                            onClick = { terminalMaximized = false },
                        )
                    }
                    TerminalTextButton(
                        text = "Reconnect",
                        enabled = inlineActions.reconnectEnabled,
                        onClick = { connect() },
                    )
                    TerminalTextButton(
                        text = "Close",
                        enabled = inlineActions.closeEnabled,
                        onClick = { requestCloseTerminal() },
                    )
                }
                inputNotice?.let {
                    Text(
                        text = it,
                        color = GoblinColors.TerminalInputForeground,
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
            }
        }
    }

    if (closeConfirmationVisible) {
        AlertDialog(
            onDismissRequest = { closeConfirmationVisible = false },
            title = { Text("Close terminal?") },
            text = { Text(terminalCloseConfirmationText(screenTitle)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        closeConfirmationVisible = false
                        closeTerminal()
                    },
                ) {
                    Text("Stop and close")
                }
            },
            dismissButton = {
                TextButton(onClick = { closeConfirmationVisible = false }) {
                    Text("Cancel")
                }
            },
        )
    }
}

private fun terminalStatusLine(
    host: SshHostProfile,
    remotePath: String,
    state: TerminalSessionState,
): String {
    val status = terminalSessionStatusLabel(state)
    return "${host.title} - ${remotePath.ifBlank { "/" }} - $status"
}

@Composable
private fun CompactCommandInput(
    value: String,
    onValueChange: (String) -> Unit,
    enabled: Boolean,
    placeholder: String,
    onSend: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val textColor = if (enabled) {
        GoblinColors.TerminalInputForeground
    } else {
        GoblinColors.TerminalDisabledForeground
    }
    var fieldValue by remember {
        mutableStateOf(TextFieldValue(text = value, selection = TextRange(value.length)))
    }

    LaunchedEffect(value) {
        if (value != fieldValue.text) {
            fieldValue = TextFieldValue(text = value, selection = TextRange(value.length))
        }
    }

    BasicTextField(
        value = fieldValue,
        onValueChange = { next ->
            fieldValue = next
            if (next.text != value) onValueChange(next.text)
        },
        enabled = enabled,
        singleLine = true,
        textStyle = MaterialTheme.typography.bodySmall.copy(color = textColor),
        cursorBrush = SolidColor(GoblinColors.TerminalActionForeground),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
        keyboardActions = KeyboardActions(onSend = { onSend() }),
        modifier = modifier
            .height(TerminalCommandInputHeight)
            .background(GoblinColors.TerminalInputBackground, TerminalCommandInputShape)
            .border(1.dp, GoblinColors.TerminalInputBorder, TerminalCommandInputShape),
        decorationBox = { innerTextField ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 10.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                if (fieldValue.text.isEmpty()) {
                    Text(
                        text = placeholder,
                        color = GoblinColors.TerminalInputPlaceholder,
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                innerTextField()
            }
        },
    )
}

@Composable
private fun TerminalTextButton(
    text: String,
    enabled: Boolean = true,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    textStyle: TextStyle = MaterialTheme.typography.labelMedium,
) {
    TextButton(
        modifier = modifier.height(TerminalActionButtonHeight),
        enabled = enabled,
        onClick = onClick,
        colors = ButtonDefaults.textButtonColors(
            contentColor = GoblinColors.TerminalActionForeground,
            disabledContentColor = GoblinColors.TerminalDisabledForeground,
        ),
    ) {
        Text(
            text = text,
            style = textStyle,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun TerminalSwitchArrowButton(
    text: String,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    TerminalTextButton(
        text = text,
        enabled = enabled,
        onClick = onClick,
        modifier = Modifier.widthIn(min = TerminalSwitchArrowButtonMinWidth),
        textStyle = MaterialTheme.typography.labelLarge.copy(fontSize = TerminalSwitchArrowFontSize),
    )
}

@Composable
private fun HelperKeyRow(
    enabled: Boolean,
    ctrlModifierActive: Boolean,
    onCtrlToggle: () -> Unit,
    onCtrlC: () -> Unit,
    onCtrlL: () -> Unit,
    onEnter: () -> Unit,
    onBackspace: () -> Unit,
    onEsc: () -> Unit,
    onTab: () -> Unit,
    onArrow: (String) -> Unit,
    onPaste: () -> Unit,
) {
    val labels = terminalHelperKeyLabels(ctrlModifierActive)
    val actions = listOf<() -> Unit>(
        onEnter,
        onBackspace,
        onCtrlC,
        onCtrlL,
        onTab,
        onEsc,
        onCtrlToggle,
        { onArrow("\u001b[A") },
        { onArrow("\u001b[B") },
        { onArrow("\u001b[D") },
        { onArrow("\u001b[C") },
        onPaste,
    )
    Column(
        verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs),
    ) {
        terminalHelperKeyRows(ctrlModifierActive).forEachIndexed { rowIndex, rowLabels ->
            Row(
                modifier = Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs),
            ) {
                rowLabels.forEachIndexed { columnIndex, label ->
                    val actionIndex = rowIndex * TerminalHelperButtonsPerRow + columnIndex
                    TerminalTextButton(text = label, enabled = enabled, onClick = actions[actionIndex])
                }
            }
        }
    }
}
