use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;
use tauri_plugin_fs::FsExt;

#[derive(Default)]
pub struct RecentFiles(Mutex<()>);

fn storage_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("recent-paths.json"))
}

fn load(path: &Path) -> Result<Vec<String>, String> {
    match fs::read_to_string(path) {
        Ok(content) => {
            let mut paths: Vec<String> =
                serde_json::from_str(&content).map_err(|e| format!("最近文件记录损坏：{e}"))?;
            paths.truncate(20);
            Ok(paths)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(error.to_string()),
    }
}

fn canonical_document(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() || !super::is_supported_markdown_path(path) {
        return Err("最近文件须为 Markdown 或文本文件的绝对路径".into());
    }
    let canonical = fs::canonicalize(path).map_err(|e| format!("文件已移动或不可访问：{e}"))?;
    if !canonical.is_file() || !super::is_supported_markdown_path(&canonical) {
        return Err("最近文件类型无效".into());
    }
    Ok(canonical)
}

#[tauri::command]
pub async fn remember_recent_file(app: tauri::AppHandle, path: PathBuf) -> Result<(), String> {
    #[cfg(target_os = "android")]
    if path.to_string_lossy().starts_with("content://") {
        app.state::<super::document_media::AndroidMedia>()
            .0
            .run_mobile_plugin::<serde_json::Value>(
                "rememberRecentDocument",
                serde_json::json!({"documentPath": path.to_string_lossy()}),
            )
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    if !app.fs_scope().is_allowed(&path) {
        return Err("此文件尚未通过打开或保存授权".into());
    }
    let canonical = canonical_document(&path)?.to_string_lossy().into_owned();
    let state = app.state::<RecentFiles>();
    let _guard = state.0.lock().map_err(|e| e.to_string())?;
    let storage = storage_path(&app)?;
    let mut paths = load(&storage)?;
    paths.retain(|item| item != &canonical);
    paths.insert(0, canonical);
    paths.truncate(20);
    fs::create_dir_all(storage.parent().ok_or("最近文件存储目录无效")?)
        .map_err(|e| e.to_string())?;
    super::atomic_save::write_atomic(
        &storage,
        &serde_json::to_vec(&paths).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn authorize_recent_file(app: tauri::AppHandle, path: PathBuf) -> Result<(), String> {
    #[cfg(target_os = "android")]
    if path.to_string_lossy().starts_with("content://") {
        app.state::<super::document_media::AndroidMedia>()
            .0
            .run_mobile_plugin::<serde_json::Value>(
                "authorizeRecentDocument",
                serde_json::json!({"documentPath": path.to_string_lossy()}),
            )
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    let canonical = canonical_document(&path)?;
    let state = app.state::<RecentFiles>();
    let _guard = state.0.lock().map_err(|e| e.to_string())?;
    if !load(&storage_path(&app)?)?
        .iter()
        .any(|item| Path::new(item) == canonical)
    {
        return Err("最近文件授权已过期，请通过打开按钮重新选择".into());
    }
    // Grant only this file after the durable native allowlist has matched.
    app.fs_scope()
        .allow_file(&canonical)
        .map_err(|e| e.to_string())?;
    if canonical != path {
        app.fs_scope()
            .allow_file(&path)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn clear_recent_files(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    app.state::<super::document_media::AndroidMedia>()
        .0
        .run_mobile_plugin::<serde_json::Value>("clearRecentDocuments", serde_json::json!({}))
        .map_err(|e| e.to_string())?;
    let state = app.state::<RecentFiles>();
    let _guard = state.0.lock().map_err(|e| e.to_string())?;
    let storage = storage_path(&app)?;
    if storage.exists() {
        super::atomic_save::write_atomic(&storage, b"[]").map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn forget_recent_file(app: tauri::AppHandle, path: PathBuf) -> Result<(), String> {
    #[cfg(target_os = "android")]
    if path.to_string_lossy().starts_with("content://") {
        app.state::<super::document_media::AndroidMedia>()
            .0
            .run_mobile_plugin::<serde_json::Value>(
                "forgetRecentDocument",
                serde_json::json!({"documentPath": path.to_string_lossy()}),
            )
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    let state = app.state::<RecentFiles>();
    let _guard = state.0.lock().map_err(|e| e.to_string())?;
    let storage = storage_path(&app)?;
    let canonical = fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
    let mut paths = load(&storage)?;
    paths.retain(|item| Path::new(item) != canonical && Path::new(item) != path);
    if storage.exists() {
        super::atomic_save::write_atomic(
            &storage,
            &serde_json::to_vec(&paths).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_uri_relative_unsupported_and_missing_recent_paths() {
        for path in [
            "content://provider/document/note.md",
            "relative.md",
            "C:/not-a-document.exe",
            "C:/rollcat-missing-test.md",
        ] {
            assert!(canonical_document(Path::new(path)).is_err(), "{path}");
        }
    }

    #[test]
    fn bounds_durable_allowlist_and_reports_invalid_storage() {
        let file =
            std::env::temp_dir().join(format!("rollcat-recent-test-{}.json", std::process::id()));
        let paths: Vec<String> = (0..30)
            .map(|index| format!("C:/notes/{index}.md"))
            .collect();
        fs::write(&file, serde_json::to_vec(&paths).unwrap()).unwrap();
        assert_eq!(load(&file).unwrap(), paths[..20]);
        fs::write(&file, b"{broken}").unwrap();
        assert!(load(&file).is_err());
        fs::remove_file(&file).unwrap();
        assert_eq!(load(&file).unwrap(), Vec::<String>::new());
    }
}
