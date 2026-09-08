package com.sonicacd.rollcatmd;

import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.IOException;
import java.util.Locale;

/** Resolver matching cannot inspect a document provider's DISPLAY_NAME. */
public final class DocumentIntentPolicy {
  private DocumentIntentPolicy() {}

  public static boolean isDocumentAction(Intent intent) {
    if (intent == null) return false;
    String action = intent.getAction();
    return Intent.ACTION_VIEW.equals(action) || Intent.ACTION_SEND.equals(action)
        || Intent.ACTION_SEND_MULTIPLE.equals(action);
  }

  public static boolean isSupportedName(String name) {
    if (name == null) return false;
    int dot = name.lastIndexOf('.');
    if (dot < 0) return false;
    switch (name.substring(dot + 1).toLowerCase(Locale.ROOT)) {
      case "md": case "markdown": case "mdown": case "mkd": case "txt": case "textpack":
        return true;
      default:
        return false;
    }
  }

  /** Wry extracts data, ClipData, EXTRA_STREAM and even text URLs before plugins run. */
  public static Intent withoutDocumentPayload(Intent original) {
    Intent clean = new Intent(original);
    clean.setAction(Intent.ACTION_MAIN);
    clean.setDataAndType(null, null);
    clean.setClipData(null);
    clean.replaceExtras((Bundle) null);
    return clean;
  }

  @SuppressWarnings("deprecation")
  public static Uri documentUri(Intent intent) {
    String action = intent.getAction();
    if (!Intent.ACTION_VIEW.equals(action) && !Intent.ACTION_SEND.equals(action)) {
      throw new IllegalArgumentException("请每次选择一个 Markdown、文本或 TextPack 文件");
    }
    ClipData clip = intent.getClipData();
    if (clip != null && clip.getItemCount() > 1) {
      throw new IllegalArgumentException("请每次选择一个文件");
    }
    Uri uri = Intent.ACTION_VIEW.equals(action) ? intent.getData() : null;
    if (uri == null && Intent.ACTION_SEND.equals(action)) {
      Object stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
      if (stream != null && !(stream instanceof Uri)) {
        throw new IllegalArgumentException("分享内容没有提供有效文件");
      }
      uri = (Uri) stream;
    }
    if (uri == null && clip != null && clip.getItemCount() == 1) uri = clip.getItemAt(0).getUri();
    if (uri == null) throw new IllegalArgumentException("请分享文件；分享文字请先复制并粘贴到编辑器");
    if (!("content".equals(uri.getScheme()) && uri.getAuthority() != null && !uri.getAuthority().isEmpty())
        && !("file".equals(uri.getScheme()) && (uri.getAuthority() == null || uri.getAuthority().isEmpty()))) {
      throw new IllegalArgumentException("来源没有提供可读取的本地文档，请通过打开按钮重新选择");
    }
    return uri;
  }

  /** Separates provider I/O from document admission so both can be checked independently. */
  public interface DocumentAccess {
    String displayName(Uri uri) throws IOException;
    void requireReadable(Uri uri) throws IOException;
  }

  private static DocumentAccess providerAccess(Context context) {
    return new DocumentAccess() {
      @Override public String displayName(Uri uri) {
        if ("content".equals(uri.getScheme())) {
          try (Cursor cursor = context.getContentResolver().query(uri,
              new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            int column = cursor == null ? -1 : cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
            return column >= 0 && cursor.moveToFirst() && !cursor.isNull(column) ? cursor.getString(column) : null;
          }
        }
        if ("file".equals(uri.getScheme()) && uri.getPath() != null) return new File(uri.getPath()).getName();
        throw new IllegalArgumentException("来源没有提供可读取的本地文档");
      }

      @Override public void requireReadable(Uri uri) throws IOException {
        // The provider enforces the actual read grant here, including temporary
        // grants and public readable providers. Do not require a durable grant.
        try (AssetFileDescriptor descriptor = context.getContentResolver().openAssetFileDescriptor(uri, "r")) {
          if (descriptor == null) throw new IOException("文件读取权限已过期，请通过打开按钮重新选择");
        }
      }
    };
  }

  public static String verifyReadableDocument(Context context, Uri uri) throws IOException {
    return verifyReadableDocument(providerAccess(context), uri);
  }

  public static String verifyReadableDocument(DocumentAccess access, Uri uri) throws IOException {
    String name = access.displayName(uri);
    if (!isSupportedName(name)) {
      throw new IllegalArgumentException("请选择 .md、.markdown、.mdown、.mkd、.txt 或 .textpack 文件");
    }
    access.requireReadable(uri);
    return name;
  }

  public static void retainOfferedPermission(Context context, Intent source, Uri uri) {
    if (!"content".equals(uri.getScheme())
        || (source.getFlags() & Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION) == 0) return;
    int flags = source.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
    if (flags == 0) return;
    try {
      context.getContentResolver().takePersistableUriPermission(uri, flags);
    } catch (SecurityException ignored) {
      // External VIEW/SEND may offer only a temporary grant. It remains valid
      // for this activity; inability to retain it must not prevent opening.
    }
  }

  public static Intent validatedView(Context context, Intent source) throws IOException {
    Intent validated = validatedView(providerAccess(context), source);
    retainOfferedPermission(context, source, validated.getData());
    return validated;
  }

  public static Intent validatedView(DocumentAccess access, Intent source) throws IOException {
    Uri uri = documentUri(source);
    verifyReadableDocument(access, uri);
    // Deliver exactly one validated URI. Original ClipData/EXTRA_TEXT/streams
    // must never reach Tauri's unfiltered URL extraction path.
    return new Intent(Intent.ACTION_VIEW).setData(uri);
  }
}
