package dev.goblin.android.ui.screens.terminals

private const val TerminalMaxExternalUrlLength = 4096

private val TerminalHttpUrlRegex = Regex("""https?://[^\s<>"'`()\[\]{}]+""")
private val TerminalTrailingPunctuation = setOf('.', ',', ';', ':', '!', '?')

internal fun terminalUrlAtColumn(line: String, column: Int): String? {
    if (column < 0) return null
    for (match in TerminalHttpUrlRegex.findAll(line)) {
        if (column !in match.range) continue
        return terminalSafeExternalUrl(match.value.trimTerminalUrlTrailingPunctuation())
    }
    return null
}

internal fun terminalSafeExternalUrl(value: String): String? {
    if (value.isBlank() || value.length > TerminalMaxExternalUrlLength) return null
    if (value.any { it.code < 0x20 || it.code == 0x7f }) return null
    return try {
        val parsed = java.net.URI(value)
        when (parsed.scheme?.lowercase()) {
            "http",
            "https",
            -> value
            else -> null
        }
    } catch (_: Exception) {
        null
    }
}

private fun String.trimTerminalUrlTrailingPunctuation(): String {
    var end = length
    while (end > 0 && this[end - 1] in TerminalTrailingPunctuation) end -= 1
    return substring(0, end)
}
