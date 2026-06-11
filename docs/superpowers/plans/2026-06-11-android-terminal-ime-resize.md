# Android Terminal IME Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Android terminal direct input behave like Termux by resizing the terminal screen above the soft keyboard.

**Architecture:** Add an Android manifest contract test for the main Activity soft input mode, then declare `adjustResize` on `MainActivity`. Keep the existing terminal screen vertical layout so the weighted terminal viewport shrinks while the helper keys, optional command input, and bottom actions remain visible above the IME.

**Tech Stack:** Android manifest, Kotlin/JUnit unit tests, Jetpack Compose layout already present in `TerminalScreen`.

---

## File Structure

- Modify: `android/app/src/main/AndroidManifest.xml`
  - Responsibility: Declare Activity-level soft keyboard resize behavior.
- Create: `android/app/src/test/java/dev/goblin/android/AndroidManifestInputModeTest.kt`
  - Responsibility: Lock the manifest contract so regressions are caught by JVM unit tests.
- Read only: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalScreen.kt`
  - Responsibility: Confirm the terminal viewport remains the weighted element and controls remain below it in the same column.

No git commit steps are included because the project instruction says not to plan or execute git commits unless the user explicitly asks.

## Task 1: Add Failing Manifest Contract Test

**Files:**
- Create: `android/app/src/test/java/dev/goblin/android/AndroidManifestInputModeTest.kt`

- [ ] **Step 1: Create the test file**

```kotlin
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
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run:

```bash
cd "android"
./gradlew :app:testDebugUnitTest --tests "dev.goblin.android.AndroidManifestInputModeTest"
```

Expected: FAIL because `AndroidManifest.xml` does not yet contain `android:windowSoftInputMode="adjustResize"`.

## Task 2: Declare Activity Resize Behavior

**Files:**
- Modify: `android/app/src/main/AndroidManifest.xml`

- [ ] **Step 1: Add `adjustResize` to `MainActivity`**

Change the `activity` tag to:

```xml
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:windowSoftInputMode="adjustResize">
```

- [ ] **Step 2: Run the targeted test and verify it passes**

Run:

```bash
cd "android"
./gradlew :app:testDebugUnitTest --tests "dev.goblin.android.AndroidManifestInputModeTest"
```

Expected: PASS.

## Task 3: Verify Terminal Layout Still Matches The IME Design

**Files:**
- Read only: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalScreen.kt`

- [ ] **Step 1: Confirm the terminal layout order**

Run:

```bash
sed -n '574,650p' "android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalScreen.kt"
```

Expected: the printed block shows `AndroidTerminalViewport(` with `modifier = Modifier.weight(1f)` first, then `HelperKeyRow(`, then `if (commandInputVisible)`, then the bottom `Row(` with `.horizontalScroll(rememberScrollState())`. No code change is needed if this order is still present.

## Task 4: Run Regression Checks

**Files:**
- No code files changed in this task.

- [ ] **Step 1: Run Android unit tests**

Run:

```bash
cd "android"
./gradlew :app:testDebugUnitTest
```

Expected: PASS.

- [ ] **Step 2: Run TypeScript typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run project tests**

Run:

```bash
bun run test
```

Expected: PASS.

- [ ] **Step 4: Check whitespace and patch safety**

Run:

```bash
git diff --check
```

Expected: no output and exit code 0.
