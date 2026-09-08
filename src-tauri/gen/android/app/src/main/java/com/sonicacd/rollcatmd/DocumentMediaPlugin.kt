package com.sonicacd.rollcatmd

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Base64
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors
import org.json.JSONArray

@InvokeArg
class DocumentMediaArgs {
  var documentPath: String = ""
  var source: String = ""
  var base64: String = ""
  var mime: String = ""
}

/** Document providers expose sibling files only after a user grants a tree URI. */
@TauriPlugin
class DocumentMediaPlugin(private val activity: Activity) : Plugin(activity) {
  private val resolver get() = activity.contentResolver
  private val folders get() = activity.getSharedPreferences("document-image-folders", Context.MODE_PRIVATE)
  private val recent get() = activity.getSharedPreferences("recent-documents", Context.MODE_PRIVATE)
  private val worker = Executors.newSingleThreadExecutor()
  private val maximumBytes = 32 * 1024 * 1024
  private data class Child(val uri: Uri, val id: String, val name: String, val mime: String)

  private fun verifyReadableDocument(uri: Uri) {
    DocumentIntentPolicy.verifyReadableDocument(activity, uri)
  }

  private fun recentPaths(): MutableList<String> {
    val array = JSONArray(recent.getString("paths", "[]"))
    return (0 until minOf(array.length(), 20)).map { array.getString(it) }.toMutableList()
  }

  @Command
  fun openDocumentPicker(invoke: Invoke) {
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
    intent.type = "*/*"
    // Providers may identify TextPack by its dedicated type, ZIP container, or
    // generic binary type. verifyReadableDocument still requires its extension.
    intent.putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("text/plain", "text/markdown", "text/x-markdown", "application/octet-stream", "application/zip", "application/x-zip-compressed", "application/x-textpack"))
    activity.runOnUiThread { startActivityForResult(invoke, intent, "documentSelected") }
  }

  @ActivityCallback
  fun documentSelected(invoke: Invoke, result: ActivityResult) {
    if (result.resultCode != Activity.RESULT_OK) { invoke.resolve(JSObject().put("path", null as String?)); return }
    worker.execute {
      try {
        val uri = result.data?.data ?: throw IllegalStateException("文件选择没有返回路径")
        verifyReadableDocument(uri)
        DocumentIntentPolicy.retainOfferedPermission(activity, result.data!!, uri)
        invoke.resolve(JSObject().put("path", uri.toString()))
      } catch (error: Exception) { invoke.reject(error.message ?: "打开文档失败") }
    }
  }

  @Command
  fun rememberRecentDocument(invoke: Invoke) {
    worker.execute {
      try {
        val path = invoke.parseArgs(DocumentMediaArgs::class.java).documentPath
        val uri = Uri.parse(path)
        verifyReadableDocument(uri)
        // Save dialogs may also offer a durable grant. External app intents may
        // offer a temporary grant; retain it for the current session only.
        try { resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (_: SecurityException) { }
        val paths = recentPaths().apply { remove(path); add(0, path) }.take(20)
        recent.edit().putString("paths", JSONArray(paths).toString()).apply()
        invoke.resolve(JSObject())
      } catch (error: Exception) { invoke.reject(error.message ?: "记录最近文档失败") }
    }
  }

  @Command
  fun authorizeRecentDocument(invoke: Invoke) {
    worker.execute {
      try {
        val path = invoke.parseArgs(DocumentMediaArgs::class.java).documentPath
        require(path in recentPaths()) { "最近文件授权已过期，请通过打开按钮重新选择" }
        verifyReadableDocument(Uri.parse(path))
        invoke.resolve(JSObject())
      } catch (error: Exception) { invoke.reject(error.message ?: "文件读取权限已过期，请重新打开") }
    }
  }

  @Command
  fun forgetRecentDocument(invoke: Invoke) {
    worker.execute {
      try {
        val path = invoke.parseArgs(DocumentMediaArgs::class.java).documentPath
        recent.edit().putString("paths", JSONArray(recentPaths().filter { it != path }).toString()).apply()
        invoke.resolve(JSObject())
      } catch (error: Exception) { invoke.reject(error.message ?: "移除最近文档失败") }
    }
  }

  @Command
  fun clearRecentDocuments(invoke: Invoke) {
    worker.execute { recent.edit().putString("paths", "[]").apply(); invoke.resolve(JSObject()) }
  }

  private fun children(tree: Uri, parent: Uri): List<Child> {
    val listing = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getDocumentId(parent))
    val result = mutableListOf<Child>()
    resolver.query(listing, arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE), null, null, null)?.use { cursor ->
      while (cursor.moveToNext()) {
        val id = cursor.getString(0)
        result.add(Child(DocumentsContract.buildDocumentUriUsingTree(tree, id), id, cursor.getString(1), cursor.getString(2)))
      }
    } ?: throw IllegalStateException("无法读取所选文件夹")
    return result
  }

  private fun rootDocument(tree: Uri): Uri = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))

  private fun verifyDocumentFolder(document: Uri, tree: Uri) {
    require(document.scheme == "content" && document.authority == tree.authority && DocumentsContract.isDocumentUri(activity, document)) {
      "请在系统文件选择器中打开或另存 Markdown，再关联它所属的文件夹；当前内容来源未提供文件夹访问"
    }
    val documentId = DocumentsContract.getDocumentId(document)
    require(children(tree, rootDocument(tree)).any { it.id == documentId && it.mime != DocumentsContract.Document.MIME_TYPE_DIR }) {
      "所选文件夹须直接包含当前 Markdown 文档"
    }
  }

  private fun associatedTree(documentPath: String): Uri {
    val saved = folders.getString(documentPath, null) ?: throw IllegalStateException("请先在更多菜单选择“关联图片文件夹”，授权当前文档所属目录")
    val tree = Uri.parse(saved)
    verifyDocumentFolder(Uri.parse(documentPath), tree)
    return tree
  }

  @Command
  fun linkImageFolder(invoke: Invoke) {
    try {
      val document = Uri.parse(invoke.parseArgs(DocumentMediaArgs::class.java).documentPath)
      require(document.scheme == "content" && DocumentsContract.isDocumentUri(activity, document)) {
        "请先通过系统文件选择器打开或另存当前 Markdown 文档"
      }
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
      activity.runOnUiThread { startActivityForResult(invoke, intent, "folderSelected") }
    } catch (error: Exception) { invoke.reject(error.message ?: "无法选择图片文件夹") }
  }

  @ActivityCallback
  fun folderSelected(invoke: Invoke, result: ActivityResult) {
    if (result.resultCode != Activity.RESULT_OK) { invoke.resolve(JSObject().put("linked", false)); return }
    worker.execute {
      try {
        val args = invoke.parseArgs(DocumentMediaArgs::class.java)
        val tree = result.data?.data ?: throw IllegalStateException("文件夹选择没有返回路径")
        verifyDocumentFolder(Uri.parse(args.documentPath), tree)
        val flags = result.data!!.flags and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        resolver.takePersistableUriPermission(tree, flags)
        folders.edit().putString(args.documentPath, tree.toString()).apply()
        invoke.resolve(JSObject().put("linked", true))
      } catch (error: Exception) { invoke.reject(error.message ?: "文件夹授权失败") }
    }
  }

  private fun imageMime(bytes: ByteArray): String {
    require(bytes.size <= maximumBytes) { "每张图片最多 32 MiB" }
    fun starts(vararg prefix: Int) = bytes.size >= prefix.size && prefix.indices.all { (bytes[it].toInt() and 255) == prefix[it] }
    return when {
      starts(137, 80, 78, 71, 13, 10, 26, 10) -> "image/png"
      starts(255, 216, 255) -> "image/jpeg"
      bytes.size >= 6 && (String(bytes, 0, 6, Charsets.US_ASCII) == "GIF87a" || String(bytes, 0, 6, Charsets.US_ASCII) == "GIF89a") -> "image/gif"
      bytes.size >= 12 && String(bytes, 0, 4, Charsets.US_ASCII) == "RIFF" && String(bytes, 8, 4, Charsets.US_ASCII) == "WEBP" -> "image/webp"
      else -> throw IllegalArgumentException("支持 PNG、JPEG、GIF 和 WebP；暂不支持 SVG")
    }
  }

  @Command
  fun readLocalImage(invoke: Invoke) {
    worker.execute {
      try {
        val args = invoke.parseArgs(DocumentMediaArgs::class.java)
        val tree = associatedTree(args.documentPath)
        val source = Uri.decode(args.source.substringBefore('?').substringBefore('#')).replace('\\', '/')
        val components = source.split('/').filter { it.isNotEmpty() && it != "." }
        require(!source.startsWith('/') && !source.contains(':') && !source.any { it.code < 32 } && components.isNotEmpty() && components.none { it == ".." }) { "图片路径不可越过文档目录" }
        var current = rootDocument(tree)
        for ((index, component) in components.withIndex()) {
          val child = children(tree, current).find { it.name == component } ?: throw IllegalStateException("本地图片不存在：$component")
          if (index < components.lastIndex) require(child.mime == DocumentsContract.Document.MIME_TYPE_DIR) { "图片路径中包含非目录" }
          else require(child.mime != DocumentsContract.Document.MIME_TYPE_DIR) { "图片路径指向文件夹" }
          current = child.uri
        }
        val bytes = resolver.openInputStream(current)?.use { input ->
          val result = ByteArrayOutputStream()
          val buffer = ByteArray(32 * 1024)
          while (true) {
            val size = input.read(buffer)
            if (size < 0) break
            require(result.size() + size <= maximumBytes) { "每张图片最多 32 MiB" }
            result.write(buffer, 0, size)
          }
          result.toByteArray()
        } ?: throw IllegalStateException("无法读取图片")
        invoke.resolve(JSObject().put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP)).put("mime", imageMime(bytes)))
      } catch (error: Exception) { invoke.reject(error.message ?: "读取本地图片失败") }
    }
  }

  @Command
  fun writeDocumentImage(invoke: Invoke) {
    worker.execute {
      try {
        val args = invoke.parseArgs(DocumentMediaArgs::class.java)
        require(args.base64.length <= (maximumBytes / 3 + 1) * 4) { "每张图片最多 32 MiB" }
        val bytes = Base64.decode(args.base64, Base64.DEFAULT)
        val mime = imageMime(bytes)
        require(args.mime == mime || (args.mime == "image/jpg" && mime == "image/jpeg")) { "图片内容与格式不匹配" }
        val tree = associatedTree(args.documentPath)
        val root = rootDocument(tree)
        val existing = children(tree, root).find { it.name == "assets" }
        if (existing != null) require(existing.mime == DocumentsContract.Document.MIME_TYPE_DIR) { "assets 已存在且不是文件夹" }
        val assets = existing?.uri ?: DocumentsContract.createDocument(resolver, root, DocumentsContract.Document.MIME_TYPE_DIR, "assets") ?: throw IllegalStateException("无法创建附件目录")
        val extension = if (mime == "image/jpeg") "jpg" else mime.substringAfter('/')
        val name = "image-${UUID.randomUUID()}.$extension"
        val image = DocumentsContract.createDocument(resolver, assets, mime, name) ?: throw IllegalStateException("无法创建图片附件")
        try {
          resolver.openOutputStream(image, "w")?.use { it.write(bytes) } ?: throw IllegalStateException("无法保存图片附件")
        } catch (error: Exception) { DocumentsContract.deleteDocument(resolver, image); throw error }
        // Providers may adjust names. Reference the actual returned display name.
        val actualName = children(tree, assets).find { it.id == DocumentsContract.getDocumentId(image) }?.name ?: name
        invoke.resolve(JSObject().put("relativePath", "assets/${Uri.encode(actualName)}"))
      } catch (error: Exception) { invoke.reject(error.message ?: "保存图片附件失败") }
    }
  }

  @Command
  fun copyImage(invoke: Invoke) {
    worker.execute {
      try {
        val args = invoke.parseArgs(DocumentMediaArgs::class.java)
        require(args.base64.length <= (maximumBytes / 3 + 1) * 4) { "每张图片最多 32 MiB" }
        val bytes = Base64.decode(args.base64, Base64.DEFAULT)
        require(imageMime(bytes) == "image/png") { "剪贴板图片须为 PNG 格式" }
        val directory = File(activity.cacheDir, "clipboard-images").apply { mkdirs() }
        val expiry = System.currentTimeMillis() - 24 * 60 * 60 * 1000
        directory.listFiles()?.filter { it.lastModified() < expiry }?.forEach { it.delete() }
        val file = File(directory, "selection-${UUID.randomUUID()}.png")
        file.writeBytes(bytes)
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
        activity.runOnUiThread {
          try {
            val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.setPrimaryClip(ClipData.newUri(resolver, "滚猫md 图片", uri))
            invoke.resolve(JSObject())
          } catch (error: Exception) { invoke.reject(error.message ?: "复制图片失败") }
        }
      } catch (error: Exception) { invoke.reject(error.message ?: "复制图片失败") }
    }
  }
}
