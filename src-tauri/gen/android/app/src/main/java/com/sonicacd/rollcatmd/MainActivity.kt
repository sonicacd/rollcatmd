package com.sonicacd.rollcatmd

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import java.util.concurrent.Executors

class MainActivity : TauriActivity() {
  private val documentWorker = Executors.newSingleThreadExecutor()
  private var documentRequest = 0L

  override fun onCreate(savedInstanceState: Bundle?) {
    val incoming = intent
    val documentAction = DocumentIntentPolicy.isDocumentAction(incoming)
    // The base activity reads getIntent() during onCreate, before plugins load.
    if (documentAction) setIntent(DocumentIntentPolicy.withoutDocumentPayload(incoming))
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    if (documentAction) openDocumentIntent(incoming)
  }

  override fun onNewIntent(intent: Intent) {
    if (!DocumentIntentPolicy.isDocumentAction(intent)) {
      setIntent(intent)
      super.onNewIntent(intent)
      return
    }
    val clean = DocumentIntentPolicy.withoutDocumentPayload(intent)
    setIntent(clean)
    super.onNewIntent(clean)
    openDocumentIntent(intent)
  }

  private fun openDocumentIntent(source: Intent) {
    val request = ++documentRequest
    documentWorker.execute {
      try {
        val validated = DocumentIntentPolicy.validatedView(this, source)
        runOnUiThread {
          if (!isDestroyed && request == documentRequest) {
            // onCreate has initialized Tao's native intent queue. It holds the
            // event until Rust/frontend startup completes (take_opened_urls).
            setIntent(validated)
            super.onNewIntent(validated)
          }
        }
      } catch (error: Exception) {
        runOnUiThread {
          if (!isDestroyed && request == documentRequest) {
            Toast.makeText(this, error.message ?: "打开文档失败", Toast.LENGTH_LONG).show()
          }
        }
      }
    }
  }

  override fun onDestroy() {
    ++documentRequest
    documentWorker.shutdownNow()
    super.onDestroy()
  }
}
