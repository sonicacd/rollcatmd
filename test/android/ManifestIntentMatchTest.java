import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.PatternMatcher;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

/** Runs framework IntentFilter.match() from the downloaded android-all JAR. */
public final class ManifestIntentMatchTest {
  private static final String ANDROID = "http://schemas.android.com/apk/res/android";
  private static final String VIEW = Intent.ACTION_VIEW;
  private static final String SEND = Intent.ACTION_SEND;
  private static final List<String> MIMES = List.of("text/markdown", "text/x-markdown", "text/plain",
    "application/x-textpack", "application/zip", "application/x-zip-compressed", "application/octet-stream");
  private static final List<String> EXTENSIONS = List.of("md", "markdown", "mdown", "mkd", "txt", "textpack");
  private static int passed;
  private static int failed;
  private static int sdk = 34;
  private static final List<String> results = new ArrayList<>();

  private record Filter(int number, IntentFilter value) {}

  public static void main(String[] args) throws Exception {
    if (args.length < 1) throw new IllegalArgumentException("Usage: ManifestIntentMatchTest <manifest.xml> [report.txt]");
    if (args.length > 2) sdk = Integer.parseInt(args[2]);
    List<Filter> filters = readFilters(Path.of(args[0]));
    results.add("Manifest: " + Path.of(args[0]).toAbsolutePath());
    results.add("Runtime: " + IntentFilter.class.getProtectionDomain().getCodeSource().getLocation());
    results.add("Manifest attribute availability uses Android API " + sdk);
    results.add("Parsed " + filters.size() + " VIEW/SEND filters; Android framework performs all matching.");
    for (Filter filter : filters) {
      results.add("filter " + filter.number + ": actions=" + filter.value.countActions() + ", MIME="
        + filter.value.countDataTypes() + ", schemes=" + filter.value.countDataSchemes()
        + ", authorities=" + filter.value.countDataAuthorities() + ", paths=" + filter.value.countDataPaths());
    }
    String opaque = "content://com.example.documents/document/78542";
    for (String mime : MIMES) {
      check(filters, "VIEW opaque " + mime, VIEW, mime, opaque, true);
      check(filters, "VIEW file URI " + mime, VIEW, mime, "file:///sdcard/note.md", true);
      check(filters, "SEND EXTRA_STREAM-style " + mime, SEND, mime, null, true);
    }
    check(filters, "VIEW opaque wrong image MIME", VIEW, "image/png", opaque, false);
    check(filters, "VIEW opaque wrong document MIME", VIEW, "application/pdf", opaque, false);
    check(filters, "SEND wrong image MIME", SEND, "image/png", null, false);
    check(filters, "SEND no MIME", SEND, null, null, false);
    check(filters, "VIEW opaque no MIME", VIEW, null, opaque, false);
    check(filters, "VIEW HTTPS supported MIME", VIEW, "text/plain", "https://example.com/note.md", false);
    check(filters, "VIEW unsupported extension wrong MIME", VIEW, "image/png", "content://provider/photo.png", false);
    check(filters, "VIEW unsupported extension no MIME", VIEW, null, "content://provider/archive.zip", false);
    check(filters, "VIEW generic MIME arbitrary extension requires runtime validation", VIEW,
      "application/octet-stream", "content://provider/unrelated.exe", true);
    for (String extension : EXTENSIONS) {
      for (String scheme : List.of("content://provider/", "file:///sdcard/")) {
        boolean content = scheme.startsWith("content:");
        check(filters, "VIEW fallback wrong MIME " + scheme + "note." + extension, VIEW,
          "application/x-misidentified", scheme + "note." + extension, content);
        check(filters, "VIEW fallback no MIME " + scheme + "note." + extension, VIEW,
          null, scheme + "note." + extension, content);
        check(filters, "VIEW fallback multidot " + scheme + "notes.v2." + extension, VIEW,
          null, scheme + "notes.v2." + extension, content);
        check(filters, "VIEW fallback dotted directory " + scheme + "app.cache/note." + extension, VIEW,
          null, scheme + "app.cache/note." + extension, content);
        check(filters, "VIEW fallback three extra dots " + scheme + "a.b.c/note.v2." + extension, VIEW,
          null, scheme + "a.b.c/note.v2." + extension, content);
        check(filters, "VIEW fallback many dots (API31+ suffix; legacy documented limit) " + scheme + extension, VIEW,
          null, scheme + "a.b.c.d.e.f.g.h/note.v2." + extension, content && sdk >= 31);
      }
    }
    results.add("TOTAL passed=" + passed + ", failed=" + failed);
    String report = String.join(System.lineSeparator(), results) + System.lineSeparator();
    System.out.print(report);
    if (args.length > 1) Files.writeString(Path.of(args[1]), report, StandardCharsets.UTF_8);
    if (failed > 0) throw new AssertionError(failed + " manifest intent cases failed");
  }

  private static void check(List<Filter> filters, String label, String action, String type, String uriText,
      boolean expected) {
    Uri uri = uriText == null ? null : Uri.parse(uriText);
    List<String> matched = new ArrayList<>();
    for (Filter entry : filters) {
      int result = entry.value.match(action, type, uri == null ? null : uri.getScheme(), uri,
        Set.of(Intent.CATEGORY_DEFAULT), "ManifestIntentMatchTest");
      if (result >= 0) matched.add(entry.number + ":0x" + Integer.toHexString(result));
    }
    boolean actual = !matched.isEmpty();
    if (actual == expected) passed++; else failed++;
    results.add((actual == expected ? "PASS " : "FAIL ") + label + " expected=" + expected
      + " actual=" + actual + " filters=" + matched);
  }

  private static List<Filter> readFilters(Path manifest) throws Exception {
    DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
    factory.setNamespaceAware(true);
    factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
    NodeList nodes = factory.newDocumentBuilder().parse(manifest.toFile()).getElementsByTagName("intent-filter");
    List<Filter> filters = new ArrayList<>();
    for (int n = 0; n < nodes.getLength(); n++) {
      Element element = (Element) nodes.item(n);
      IntentFilter filter = new IntentFilter();
      NodeList children = element.getChildNodes();
      for (int j = 0; j < children.getLength(); j++) {
        Node child = children.item(j);
        if (!(child instanceof Element item)) continue;
        switch (item.getTagName()) {
          case "action" -> filter.addAction(attribute(item, "name"));
          case "category" -> filter.addCategory(attribute(item, "name"));
          case "data" -> {
            String mime = attribute(item, "mimeType");
            String scheme = attribute(item, "scheme");
            String host = attribute(item, "host");
            String port = attribute(item, "port");
            if (!mime.isEmpty()) filter.addDataType(mime);
            if (!scheme.isEmpty()) filter.addDataScheme(scheme);
            if (!host.isEmpty()) filter.addDataAuthority(host, port.isEmpty() ? null : port);
            addPath(filter, item, "path", PatternMatcher.PATTERN_LITERAL);
            addPath(filter, item, "pathPrefix", PatternMatcher.PATTERN_PREFIX);
            addPath(filter, item, "pathPattern", PatternMatcher.PATTERN_SIMPLE_GLOB);
            if (sdk >= 26) addPath(filter, item, "pathAdvancedPattern", PatternMatcher.PATTERN_ADVANCED_GLOB);
            if (sdk >= 31) addPath(filter, item, "pathSuffix", PatternMatcher.PATTERN_SUFFIX);
          }
        }
      }
      if (filter.hasAction(VIEW) || filter.hasAction(SEND)) filters.add(new Filter(n, filter));
    }
    return filters;
  }

  private static String attribute(Element item, String name) {
    // AAPT resolves source XML string backslash escapes before constructing IntentFilter.
    // The project path patterns use doubled backslashes, so decode that escape once.
    return item.getAttributeNS(ANDROID, name).replace("\\\\", "\\");
  }

  private static void addPath(IntentFilter filter, Element item, String name, int patternType) {
    String value = attribute(item, name);
    if (!value.isEmpty()) filter.addDataPath(value, patternType);
  }
}
