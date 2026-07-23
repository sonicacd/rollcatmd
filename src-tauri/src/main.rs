#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod atomic_save;

use std::{env, fs, path::Path, path::PathBuf};
use tauri_plugin_fs::FsExt;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct InitialFile {
    file_path: String,
    byte_size: u64,
}

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

/// Atomically writes UTF-8 text to a path that was authorized by the file
/// dialog or the startup-file flow. The blocking disk work runs off Tauri's
/// async command thread.
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            get_initial_file,
            write_text_file_atomic
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
