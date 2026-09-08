import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import com.sonicacd.rollcatmd.DocumentIntentPolicy;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/** Production policy with real framework Intent/Uri/ClipData and fake provider I/O. */
public final class DocumentIntentPolicyTest {
  private static final Uri URI = Uri.parse("content://provider/document/78542");
  private static final List<String> results = new ArrayList<>();
  private static int passed;
  private static int failed;
  @FunctionalInterface private interface Checked { void run() throws Exception; }

  public static void main(String[] args) throws Exception {
    results.add("Runtime: " + Intent.class.getProtectionDomain().getCodeSource().getLocation());
    results.add("Production DocumentIntentPolicy executes against framework Intent/Uri/ClipData.");
    results.add("DocumentAccess is a fake provider I/O boundary; Android provider grants and activity lifecycle require device verification.");
    for (String name : List.of("note.md", "file.MARKDOWN", "档案.mdown", "draft.MkD", "notes.v2.TXT", "文档.TeXtPaCk"))
      test("accept filename " + name, () -> require(DocumentIntentPolicy.isSupportedName(name)));
    for (String name : List.of("note", "note.pdf", "note.md.exe", "a.textpack.zip", "note.md ", "file.", ""))
      test("reject filename " + name, () -> require(!DocumentIntentPolicy.isSupportedName(name)));
    test("reject null filename", () -> require(!DocumentIntentPolicy.isSupportedName(null)));
    test("VIEW data URI", () -> equal(URI, DocumentIntentPolicy.documentUri(new Intent(Intent.ACTION_VIEW).setData(URI))));
    test("SEND stream URI", () -> equal(URI, DocumentIntentPolicy.documentUri(send(URI))));
    test("SEND clip URI fallback", () -> equal(URI, DocumentIntentPolicy.documentUri(withClip(new Intent(Intent.ACTION_SEND), URI))));
    test("VIEW clip URI fallback", () -> equal(URI, DocumentIntentPolicy.documentUri(withClip(new Intent(Intent.ACTION_VIEW), URI))));
    test("file URI accepted", () -> equal(Uri.parse("file:///sdcard/note.md"), DocumentIntentPolicy.documentUri(
      new Intent(Intent.ACTION_VIEW).setData(Uri.parse("file:///sdcard/note.md")))));
    test("EXTRA_TEXT-only share rejected", () -> rejects(() -> DocumentIntentPolicy.documentUri(
      new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "https://attacker.example/payload.md"))));
    test("SEND data URI alone rejected", () -> rejects(() -> DocumentIntentPolicy.documentUri(new Intent(Intent.ACTION_SEND).setData(URI))));
    test("SEND_MULTIPLE rejected", () -> rejects(() -> DocumentIntentPolicy.documentUri(new Intent(Intent.ACTION_SEND_MULTIPLE))));
    test("multiple clip files rejected", () -> {
      Intent intent = withClip(send(URI), URI);
      intent.getClipData().addItem(new ClipData.Item(Uri.parse("content://provider/second")));
      rejects(() -> DocumentIntentPolicy.documentUri(intent));
    });
    test("non-URI parcelable stream rejected", () -> rejects(() -> DocumentIntentPolicy.documentUri(
      new Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, new Intent(Intent.ACTION_MAIN)))));
    for (String malicious : List.of("https://example.com/note.md", "javascript:alert(1)", "data:text/plain,test",
      "content:/document/78542", "file://remotehost/note.md")) {
      test("reject scheme/authority " + malicious, () -> rejects(() -> DocumentIntentPolicy.documentUri(
        new Intent(Intent.ACTION_VIEW).setData(Uri.parse(malicious)))));
    }
    test("launcher action classified separately", () -> require(!DocumentIntentPolicy.isDocumentAction(new Intent(Intent.ACTION_MAIN))));
    test("null action classified separately", () -> require(!DocumentIntentPolicy.isDocumentAction(null)));
    test("unvalidated payload removed before Tauri extraction", () -> {
      Intent source = allPayloads();
      Intent clean = DocumentIntentPolicy.withoutDocumentPayload(source);
      equal(Intent.ACTION_MAIN, clean.getAction());
      require(clean.getData() == null && clean.getType() == null && clean.getClipData() == null && clean.getExtras() == null);
      require(source.getData() != null && source.getClipData() != null && source.getExtras() != null);
    });
    test("validatedView forwards exactly one verified URI", () -> {
      FakeAccess access = new FakeAccess("bundle.TeXtPaCk", false);
      Intent validated = DocumentIntentPolicy.validatedView(access, allPayloads());
      equal(Intent.ACTION_VIEW, validated.getAction());
      equal(URI, validated.getData());
      require(validated.getType() == null && validated.getClipData() == null && validated.getExtras() == null);
      require(access.queries == 1 && access.opens == 1);
      equal(URI, access.lastReadUri);
    });
    test("provider DISPLAY_NAME rejects unsupported extension before opening", () -> {
      FakeAccess access = new FakeAccess("bundle.exe", false);
      rejects(() -> DocumentIntentPolicy.validatedView(access, send(URI)));
      require(access.queries == 1 && access.opens == 0);
    });
    test("provider read-grant failure rejects open", () -> {
      FakeAccess access = new FakeAccess("note.md", true);
      try { DocumentIntentPolicy.validatedView(access, send(URI)); throw new AssertionError("Missing SecurityException"); }
      catch (SecurityException expected) { require(access.opens == 1); }
    });
    test("missing provider DISPLAY_NAME rejects open", () -> {
      FakeAccess access = new FakeAccess(null, false);
      rejects(() -> DocumentIntentPolicy.validatedView(access, send(URI)));
      require(access.queries == 1 && access.opens == 0);
    });
    test("provider metadata IOException prevents URI forwarding", () -> {
      DocumentIntentPolicy.DocumentAccess access = new DocumentIntentPolicy.DocumentAccess() {
        @Override public String displayName(Uri uri) throws IOException { throw new IOException("Provider unavailable"); }
        @Override public void requireReadable(Uri uri) { throw new AssertionError("Must not read after metadata failure"); }
      };
      try { DocumentIntentPolicy.validatedView(access, send(URI)); throw new AssertionError("Missing IOException"); }
      catch (IOException expected) { }
    });
    results.add("TOTAL passed=" + passed + ", failed=" + failed);
    String report = String.join(System.lineSeparator(), results) + System.lineSeparator();
    System.out.print(report);
    if (args.length > 0) Files.writeString(Path.of(args[0]), report);
    if (failed > 0) throw new AssertionError(failed + " production policy cases failed");
  }

  private static Intent send(Uri uri) { return new Intent(Intent.ACTION_SEND).setType("application/octet-stream").putExtra(Intent.EXTRA_STREAM, uri); }
  private static Intent withClip(Intent intent, Uri uri) {
    intent.setClipData(new ClipData("document", new String[] { "text/plain" }, new ClipData.Item(uri)));
    return intent;
  }
  private static Intent allPayloads() {
    return withClip(new Intent(Intent.ACTION_VIEW).setDataAndType(URI, "text/plain")
      .putExtra(Intent.EXTRA_STREAM, Uri.parse("content://provider/unvalidated-extra"))
      .putExtra(Intent.EXTRA_TEXT, "https://attacker.example/unvalidated")
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), Uri.parse("content://provider/unvalidated-clip"));
  }
  private static void require(boolean value) { if (!value) throw new AssertionError("Requirement failed"); }
  private static void equal(Object expected, Object actual) { if (!expected.equals(actual)) throw new AssertionError("Expected " + expected + ", got " + actual); }
  private static void rejects(Checked checked) throws Exception {
    try { checked.run(); throw new AssertionError("Expected IllegalArgumentException"); }
    catch (IllegalArgumentException expected) { }
  }
  private static void test(String label, Checked checked) {
    try { checked.run(); passed++; results.add("PASS " + label); }
    catch (Throwable failure) { failed++; results.add("FAIL " + label + ": " + failure); }
  }

  private static final class FakeAccess implements DocumentIntentPolicy.DocumentAccess {
    private final String name;
    private final boolean denyRead;
    int queries;
    int opens;
    Uri lastReadUri;
    FakeAccess(String name, boolean denyRead) { this.name = name; this.denyRead = denyRead; }
    @Override public String displayName(Uri uri) {
      queries++;
      equal(URI, uri);
      return name;
    }
    @Override public void requireReadable(Uri uri) {
      opens++;
      lastReadUri = uri;
      if (denyRead) throw new SecurityException("Read grant denied by fake provider I/O");
    }
  }
}
