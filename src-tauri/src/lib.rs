mod atomic_save;

use std::{
    env, fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;
use tauri_plugin_fs::FsExt;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct InitialFile {
    file_path: String,
    byte_size: u64,
}

#[derive(Default)]
struct OpenedUrls(Mutex<Vec<tauri::Url>>);

fn is_supported_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "mdown" | "mkd" | "txt"
            )
        })
        .unwrap_or(false)
}

fn resolve_initial_file_path(path: &Path) -> Result<Option<PathBuf>, std::io::Error> {
    if !is_supported_markdown_path(path) || !path.is_file() {
        return Ok(None);
    }

    fs::canonicalize(path).map(Some)
}

/// Atomically writes UTF-8 text to a desktop path that was authorized by the
/// file dialog or startup-file flow. Android document URIs are written through
/// tauri-plugin-fs on the frontend instead.
#[tauri::command]
async fn write_text_file_atomic(
    app: tauri::AppHandle,
    path: PathBuf,
    content: String,
) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("拒绝保存到非绝对路径".to_string());
    }
    if !app.fs_scope().is_allowed(&path) {
        return Err(format!("拒绝保存未经授权的路径：{}", path.display()));
    }

    tauri::async_runtime::spawn_blocking(move || {
        atomic_save::write_atomic(&path, content.as_bytes())
            .map_err(|error| format!("保存文件失败：{error}"))
    })
    .await
    .map_err(|error| format!("保存任务失败：{error}"))?
}

#[tauri::command]
fn get_initial_file(app: tauri::AppHandle) -> Result<Option<InitialFile>, String> {
    let Some(path) = env::args_os().nth(1).map(PathBuf::from) else {
        return Ok(None);
    };

    let Some(path) = resolve_initial_file_path(&path)
        .map_err(|error| format!("解析启动文件路径失败：{}", error))?
    else {
        return Ok(None);
    };

    let byte_size = fs::metadata(&path)
        .map_err(|error| format!("读取启动文件信息失败：{}", error))?
        .len();
    app.fs_scope()
        .allow_file(&path)
        .map_err(|error| format!("授权读取启动文件失败：{}", error))?;

    Ok(Some(InitialFile {
        file_path: path.to_string_lossy().into_owned(),
        byte_size,
    }))
}

#[tauri::command]
fn take_opened_urls(app: tauri::AppHandle) -> Vec<String> {
    let opened_urls = app.state::<OpenedUrls>();
    let mut urls = opened_urls
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    urls.drain(..).map(|url| url.to_string()).collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(OpenedUrls::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            get_initial_file,
            take_opened_urls,
            write_text_file_atomic
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app, _event| {
        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
        if let tauri::RunEvent::Opened { urls } = _event {
            use tauri::Emitter;

            let serialized: Vec<String> = urls.iter().map(ToString::to_string).collect();
            _app.state::<OpenedUrls>()
                .0
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .extend(urls);
            let _ = _app.emit("opened", serialized);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{is_supported_markdown_path, resolve_initial_file_path};
    use std::{fs, path::Path, process};

    #[test]
    fn recognizes_supported_markdown_and_text_paths_case_insensitively() {
        for path in [
            "notes.md",
            "README.MARKDOWN",
            "draft.mdown",
            "draft.MKD",
            "plain.txt",
        ] {
            assert!(is_supported_markdown_path(Path::new(path)), "{path}");
        }
    }

    #[test]
    fn rejects_paths_without_a_supported_extension() {
        for path in ["notes", "notes.html", "notes.md.exe", ".md"] {
            assert!(!is_supported_markdown_path(Path::new(path)), "{path}");
        }
    }

    #[test]
    fn resolves_a_relative_initial_file_to_an_absolute_path() {
        let relative_name = format!(".initial-file-path-test-{}.md", process::id());
        let relative_path = Path::new(&relative_name);
        fs::write(relative_path, "test").expect("create relative test file");

        let result = resolve_initial_file_path(relative_path);
        let _ = fs::remove_file(relative_path);

        let resolved = result
            .expect("resolve relative file")
            .expect("supported file should resolve");
        assert!(resolved.is_absolute());
        assert_eq!(resolved.file_name(), relative_path.file_name());
    }
}
