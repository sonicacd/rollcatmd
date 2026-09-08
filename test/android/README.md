# Android document intent tests

Run from the repository root with PowerShell and an existing Java 17+ JDK:

```powershell
.\scripts\test-android-intents.ps1
```

The script prefers the repository's `.android-toolchain/jdk` directory, then
`JAVA_HOME`. An explicit JDK path can be supplied with `-JavaHome`. The first run
downloads two test-only `org.robolectric:android-all` framework JARs from Maven
Central into `work/qa/android-intent` and verifies pinned SHA256 hashes. Subsequent
runs can use `-Offline`. No emulator, tools, production dependencies, or Gradle
test dependencies are installed.

`ManifestIntentMatchTest.java` reads the actual source manifest and constructs
Android framework `IntentFilter` objects. Matching runs through the real
`IntentFilter.match()` implementation, using Android 7 / API 24 and Android 14 /
API 34 frameworks. Source XML backslash escaping is decoded once, and manifest
attributes unavailable to the selected API are omitted. The SDK's stub
`android.jar` cannot execute these assertions.

Each framework runs 102 cases: all seven MIME registrations for VIEW and SEND,
opaque provider URIs, file URIs with supported MIME types, unsupported and generic MIME types, URI scheme boundaries,
all six extensions, no-MIME and wrong-MIME filename fallbacks, and dotted paths.
API 24 intentionally rejects fallback paths with more than four dots. API 34
uses `pathSuffix` to accept those paths. File URI fallbacks with missing or
unrecognized MIME are intentionally absent.

`DocumentIntentPolicyTest.java` compiles and runs the production
`DocumentIntentPolicy.java`, with real Android `Intent`, `Uri`, and `ClipData`.
Its 37 cases cover filenames, VIEW/SEND extraction, text-only URL shares,
multiple items, invalid schemes, payload removal, and forwarding exactly one
validated URI. A `DocumentAccess` fake supplies provider metadata and read
success/failure to the production admission logic, including missing/unsupported
`DISPLAY_NAME`, denied reads, and metadata errors.

These JVM tests do not exercise Android's actual provider permission enforcement,
descriptor I/O, persistable grants, activity cold/warm lifecycle, or the system
chooser UI. Those require device testing. No host Android-class shims are used.

Detailed reports and compiler outputs remain under `work/qa/android-intent`.
The expected summary is 102 API 24 matching cases, 102 API 34 matching cases, and
37 production policy cases, with zero failures.
