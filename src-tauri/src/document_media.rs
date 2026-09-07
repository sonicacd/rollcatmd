use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
#[cfg(target_os = "android")]
use tauri::Manager;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_fs::FsExt;

pub const MAX_IMAGE_BYTES: usize = 32 * 1024 * 1024;
static IMAGE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalImage {
    pub base64: String,
    pub mime: String,
}
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedImage {
    pub relative_path: String,
}

pub fn image_type(bytes: &[u8]) -> Result<(&'static str, &'static str), String> {
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("每张图片最多 32 MiB".into());
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Ok(("image/png", "png"))
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Ok(("image/jpeg", "jpg"))
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Ok(("image/gif", "gif"))
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP".as_slice()) {
        Ok(("image/webp", "webp"))
    } else {
        Err("支持 PNG、JPEG、GIF 和 WebP 图片；暂不支持 SVG".into())
    }
}

pub fn relative_image_path(source: &str) -> Result<PathBuf, String> {
    let source = source.trim().split(['?', '#']).next().unwrap_or("");
    let decoded = percent_encoding::percent_decode_str(source)
        .decode_utf8()
        .map_err(|_| "图片路径编码无效")?;
    let normalized = decoded.replace('\\', "/");
    if normalized.is_empty() || normalized.contains(':') || normalized.chars().any(char::is_control)
    {
        return Err("只允许文档目录内的相对图片路径".into());
    }
    let path = Path::new(&normalized);
    if path.is_absolute()
        || path.components().any(|part| {
            matches!(
                part,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("图片路径不可越过文档目录".into());
    }
    Ok(path.to_path_buf())
}

fn authorized_document(app: &tauri::AppHandle, document_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(document_path);
    if !path.is_absolute()
        || !super::is_supported_markdown_path(path)
        || !app.fs_scope().is_allowed(path)
    {
        return Err("请先打开或保存 Markdown 文档，再使用本地图片".into());
    }
    let canonical = fs::canonicalize(path).map_err(|error| format!("无法访问文档：{error}"))?;
    if !canonical.is_file() {
        return Err("文档路径必须是文件".into());
    }
    Ok(canonical)
}

#[cfg(windows)]
fn verify_opened_file(file: &File, directory: &Path) -> Result<(), String> {
    use std::os::windows::{ffi::OsStringExt, io::AsRawHandle};
    use windows_sys::Win32::Storage::FileSystem::GetFinalPathNameByHandleW;
    // Verify the opened handle as well as the requested path. This catches a
    // junction/link replacement between canonicalization and opening the file.
    let handle = file.as_raw_handle();
    let required = unsafe { GetFinalPathNameByHandleW(handle, std::ptr::null_mut(), 0, 0) };
    if required == 0 {
        return Err("无法验证图片文件的实际位置".into());
    }
    let mut buffer = vec![0u16; required as usize + 1];
    let written =
        unsafe { GetFinalPathNameByHandleW(handle, buffer.as_mut_ptr(), buffer.len() as u32, 0) };
    if written == 0 || written as usize >= buffer.len() {
        return Err("无法验证图片文件的实际位置".into());
    }
    buffer.truncate(written as usize);
    let actual = PathBuf::from(std::ffi::OsString::from_wide(&buffer));
    if !actual.starts_with(directory) {
        return Err("图片文件的实际位置超出文档目录".into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn verify_opened_file(_file: &File, _directory: &Path) -> Result<(), String> {
    Ok(())
}

fn read_image_file(document: &Path, source: &str) -> Result<LocalImage, String> {
    let directory = document.parent().ok_or("文档缺少所属目录")?;
    let path = fs::canonicalize(directory.join(relative_image_path(source)?))
        .map_err(|error| format!("读取本地图片失败：{error}"))?;
    if !path.starts_with(directory) {
        return Err("图片链接指向文档目录之外".into());
    }
    let file = File::open(&path).map_err(|error| format!("打开图片失败：{error}"))?;
    verify_opened_file(&file, directory)?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_IMAGE_BYTES as u64 {
        return Err("图片必须是文件且不超过 32 MiB".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_IMAGE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    let (mime, _) = image_type(&bytes)?;
    Ok(LocalImage {
        base64: STANDARD.encode(&bytes),
        mime: mime.into(),
    })
}

fn write_image_file(document: &Path, bytes: &[u8], mime: &str) -> Result<SavedImage, String> {
    let (actual_mime, extension) = image_type(bytes)?;
    if actual_mime != mime && !(mime == "image/jpg" && actual_mime == "image/jpeg") {
        return Err("图片内容与格式不匹配".into());
    }
    let directory = document.parent().ok_or("文档缺少所属目录")?;
    let assets = directory.join("assets");
    if !assets.exists() {
        fs::create_dir(&assets).map_err(|error| format!("创建附件目录失败：{error}"))?;
    }
    let assets = fs::canonicalize(&assets).map_err(|error| error.to_string())?;
    if !assets.starts_with(directory) || !assets.is_dir() {
        return Err("附件目录链接指向文档目录之外".into());
    }
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    for _ in 0..64 {
        let sequence = IMAGE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let name = format!(
            "image-{timestamp}-{}-{sequence}.{extension}",
            std::process::id()
        );
        let path = assets.join(&name);
        match OpenOptions::new().create_new(true).write(true).open(&path) {
            Ok(mut file) => {
                verify_opened_file(&file, directory)?;
                if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
                    let _ = fs::remove_file(&path);
                    return Err(format!("保存附件失败：{error}"));
                }
                return Ok(SavedImage {
                    relative_path: format!("assets/{name}"),
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("保存附件失败：{error}")),
        }
    }
    Err("无法生成唯一的附件文件名".into())
}

#[cfg(target_os = "android")]
pub struct AndroidMedia(pub tauri::plugin::PluginHandle<tauri::Wry>);

pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("document-media")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _app.manage(AndroidMedia(_api.register_android_plugin(
                "com.sonicacd.rollcatmd",
                "DocumentMediaPlugin",
            )?));
            Ok(())
        })
        .build()
}

#[tauri::command]
pub async fn read_local_image(
    app: tauri::AppHandle,
    document_path: String,
    source: String,
) -> Result<LocalImage, String> {
    // Validate the relative syntax on every platform before touching storage.
    relative_image_path(&source)?;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "android")]
        if document_path.starts_with("content://") {
            return app
                .state::<AndroidMedia>()
                .0
                .run_mobile_plugin(
                    "readLocalImage",
                    serde_json::json!({"documentPath": document_path, "source": source}),
                )
                .map_err(|e| e.to_string());
        }
        let document = authorized_document(&app, &document_path)?;
        read_image_file(&document, &source)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn write_document_image(
    app: tauri::AppHandle,
    document_path: String,
    bytes: Vec<u8>,
    mime: String,
) -> Result<SavedImage, String> {
    image_type(&bytes)?;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "android")]
        if document_path.starts_with("content://") {
            return app.state::<AndroidMedia>().0.run_mobile_plugin("writeDocumentImage", serde_json::json!({"documentPath": document_path, "base64": STANDARD.encode(bytes), "mime": mime})).map_err(|e| e.to_string());
        }
        let document = authorized_document(&app, &document_path)?;
        write_image_file(&document, &bytes, &mime)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn link_image_folder(
    app: tauri::AppHandle,
    document_path: String,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    return tauri::async_runtime::spawn_blocking(move || {
        app.state::<AndroidMedia>()
            .0
            .run_mobile_plugin(
                "linkImageFolder",
                serde_json::json!({"documentPath": document_path}),
            )
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, document_path);
        Err("Windows 会自动使用文档所属目录".into())
    }
}

#[tauri::command]
pub async fn open_document_picker(app: tauri::AppHandle) -> Result<Option<String>, String> {
    #[cfg(target_os = "android")]
    return tauri::async_runtime::spawn_blocking(move || {
        let result: serde_json::Value = app
            .state::<AndroidMedia>()
            .0
            .run_mobile_plugin("openDocumentPicker", serde_json::json!({}))
            .map_err(|e| e.to_string())?;
        Ok(result
            .get("path")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned))
    })
    .await
    .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("此文件选择器仅适用于 Android".into())
    }
}

#[tauri::command]
pub async fn copy_image_clipboard(app: tauri::AppHandle, bytes: Vec<u8>) -> Result<(), String> {
    if image_type(&bytes)?.0 != "image/png" {
        return Err("剪贴板图片须为 PNG 格式".into());
    }
    let dimensions = bytes.get(16..24).ok_or("PNG 文件不完整")?;
    let width = u32::from_be_bytes(dimensions[..4].try_into().unwrap());
    let height = u32::from_be_bytes(dimensions[4..].try_into().unwrap());
    if u64::from(width) * u64::from(height) > 32 * 1024 * 1024 {
        return Err("图片像素过多，请缩小选中范围后复制".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "android")]
        {
            app.state::<AndroidMedia>()
                .0
                .run_mobile_plugin::<serde_json::Value>(
                    "copyImage",
                    serde_json::json!({"base64": STANDARD.encode(bytes)}),
                )
                .map_err(|e| e.to_string())?;
            Ok(())
        }
        #[cfg(not(target_os = "android"))]
        {
            let image = tauri::image::Image::from_bytes(&bytes).map_err(|e| e.to_string())?;
            app.clipboard()
                .write_image(&image)
                .map_err(|e| e.to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn copy_text_clipboard(app: tauri::AppHandle, text: String) -> Result<(), String> {
    if text.len() > MAX_IMAGE_BYTES {
        return Err("复制文本超过 32 MiB".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        app.clipboard().write_text(text).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_escaping_or_nonrelative_paths() {
        for path in [
            "../secret.png",
            "%2e%2e/secret.png",
            "assets/../../secret.png",
            "C:/secret.png",
            "\\\\host\\share\\x.png",
            "/x.png",
            "file:///x.png",
            "https://x/a.png",
            "assets/%00.png",
        ] {
            assert!(relative_image_path(path).is_err(), "{path}");
        }
        assert_eq!(
            relative_image_path("./assets/hello%20world.png?version=1").unwrap(),
            PathBuf::from("./assets/hello world.png")
        );
    }
    #[test]
    fn saves_unique_images_and_checks_signature() {
        let directory = std::env::temp_dir().join(format!(
            "rollcat-media-test-{}-{}",
            std::process::id(),
            IMAGE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&directory).unwrap();
        let directory = fs::canonicalize(directory).unwrap();
        let document = directory.join("sample.md");
        fs::write(&document, "# test").unwrap();
        let png = b"\x89PNG\r\n\x1a\nexample";
        let first = write_image_file(&document, png, "image/png").unwrap();
        let second = write_image_file(&document, png, "image/png").unwrap();
        assert_ne!(first.relative_path, second.relative_path);
        assert_eq!(
            read_image_file(&document, &first.relative_path)
                .unwrap()
                .base64,
            STANDARD.encode(png)
        );
        assert!(write_image_file(&document, png, "image/jpeg").is_err());
        assert!(write_image_file(&document, b"<svg></svg>", "image/svg+xml").is_err());
        fs::remove_dir_all(directory).unwrap();
    }
}
