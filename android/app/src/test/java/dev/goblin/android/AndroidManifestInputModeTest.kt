package dev.goblin.android

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidManifestInputModeTest {
    @Test
    fun `main activity resizes when soft keyboard is shown`() {
        val manifest = androidManifestText()

        assertTrue(
            manifest.contains("""android:name=".MainActivity""""),
        )
        assertTrue(
            manifest.contains("""android:windowSoftInputMode="adjustResize""""),
        )
    }

    private fun androidManifestText(): String {
        val candidates = listOf(
            File("src/main/AndroidManifest.xml"),
            File("app/src/main/AndroidManifest.xml"),
            File("android/app/src/main/AndroidManifest.xml"),
        )
        val manifest = candidates.firstOrNull { it.isFile }
            ?: error("AndroidManifest.xml not found from ${File(".").absolutePath}")
        return manifest.readText()
    }
}
