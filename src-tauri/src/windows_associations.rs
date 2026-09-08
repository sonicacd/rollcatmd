//! User-level Windows registration. Default choices are made in Windows Settings.
//! Registry layout: https://learn.microsoft.com/windows/win32/shell/app-registration
//! Settings URI: https://learn.microsoft.com/windows/apps/develop/launch/launch-default-apps-settings

#[tauri::command]
pub async fn register_windows_file_associations() -> Result<(), String> {
    run_action(false).await
}

#[tauri::command]
pub async fn open_windows_default_apps() -> Result<(), String> {
    run_action(true).await
}

async fn run_action(open_settings: bool) -> Result<(), String> {
    #[cfg(windows)]
    return tauri::async_runtime::spawn_blocking(move || {
        platform::register_current_application()?;
        if open_settings {
            platform::open_default_apps_settings()?;
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("Windows 文件关联任务失败：{error}"))?;

    #[cfg(not(windows))]
    {
        let _ = open_settings;
        Err("文件关联设置仅支持 Windows".into())
    }
}

#[cfg(windows)]
mod platform {
    use std::{path::Path, ptr};
    use windows_sys::Win32::{
        Foundation::ERROR_SUCCESS,
        System::{
            Com::{
                CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
            },
            Registry::{
                RegCloseKey, RegCreateKeyExW, RegGetValueW, RegSetValueExW, HKEY,
                HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_SET_VALUE, REG_NONE,
                REG_OPTION_NON_VOLATILE, REG_SAM_FLAGS, REG_SZ, RRF_RT_REG_SZ,
            },
        },
        UI::{
            Shell::{SHChangeNotify, ShellExecuteW, SHCNE_ASSOCCHANGED, SHCNF_IDLIST},
            WindowsAndMessaging::SW_SHOWNORMAL,
        },
    };

    const APPLICATION_NAME: &str = "滚猫md";
    const PROG_ID: &str = "RollcatMD.Document";
    const CAPABILITIES_PATH: &str = "Software\\RollcatMD\\Capabilities";
    const EXTENSIONS: [&str; 6] = [".md", ".markdown", ".mdown", ".mkd", ".txt", ".textpack"];

    #[derive(Debug, Clone, PartialEq, Eq)]
    enum Value {
        Text(String),
        Empty,
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct Entry {
        key: String,
        name: String,
        value: Value,
    }

    impl Entry {
        fn text(key: impl Into<String>, name: &str, value: impl Into<String>) -> Self {
            Self {
                key: key.into(),
                name: name.into(),
                value: Value::Text(value.into()),
            }
        }
    }

    fn registration_plan(executable: &Path) -> Result<Vec<Entry>, String> {
        let executable_string = executable.to_str().ok_or("程序路径包含无法注册的字符")?;
        if !executable.is_absolute() || executable_string.contains(['\0', '"']) {
            return Err("程序路径必须为不含引号的有效绝对路径".into());
        }
        let executable_name = executable
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or("无法获取程序文件名")?;
        let command = format!("\"{executable_string}\" \"%1\"");
        let icon = format!("\"{executable_string}\",0");
        let prog_id_key = format!("Software\\Classes\\{PROG_ID}");
        let application_key = format!("Software\\Classes\\Applications\\{executable_name}");
        let mut entries = vec![
            Entry::text(&prog_id_key, "", "滚猫md 文档"),
            Entry::text(&prog_id_key, "FriendlyTypeName", "滚猫md 文档"),
            Entry::text(format!("{prog_id_key}\\DefaultIcon"), "", &icon),
            Entry::text(format!("{prog_id_key}\\shell\\open\\command"), "", &command),
            Entry::text(&application_key, "FriendlyAppName", APPLICATION_NAME),
            Entry::text(format!("{application_key}\\DefaultIcon"), "", &icon),
            Entry::text(
                format!("{application_key}\\shell\\open\\command"),
                "",
                &command,
            ),
            Entry::text(CAPABILITIES_PATH, "ApplicationName", APPLICATION_NAME),
            Entry::text(
                CAPABILITIES_PATH,
                "ApplicationDescription",
                "轻量 Markdown 与 TextPack 阅读编辑器",
            ),
            Entry::text(CAPABILITIES_PATH, "ApplicationIcon", &icon),
            Entry::text(
                "Software\\RegisteredApplications",
                APPLICATION_NAME,
                CAPABILITIES_PATH,
            ),
        ];
        for extension in EXTENSIONS {
            entries.push(Entry {
                key: format!("Software\\Classes\\{extension}\\OpenWithProgids"),
                name: PROG_ID.into(),
                value: Value::Empty,
            });
            entries.push(Entry::text(
                format!("{application_key}\\SupportedTypes"),
                extension,
                "",
            ));
            entries.push(Entry::text(
                format!("{CAPABILITIES_PATH}\\FileAssociations"),
                extension,
                PROG_ID,
            ));
        }
        // Only add our own values. Do not replace extension defaults, UserChoice,
        // other applications' entries, or their OpenWithProgids candidates.
        Ok(entries)
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }

    struct Key(HKEY);

    impl Drop for Key {
        fn drop(&mut self) {
            unsafe {
                RegCloseKey(self.0);
            }
        }
    }

    fn create_key(root: HKEY, path: &str, access: REG_SAM_FLAGS) -> Result<Key, String> {
        let path_wide = wide(path);
        let mut handle = ptr::null_mut();
        let result = unsafe {
            RegCreateKeyExW(
                root,
                path_wide.as_ptr(),
                0,
                ptr::null(),
                REG_OPTION_NON_VOLATILE,
                access,
                ptr::null(),
                &mut handle,
                ptr::null_mut(),
            )
        };
        if result != ERROR_SUCCESS {
            return Err(format!(
                "无法写入当前用户的文件关联：{}",
                std::io::Error::from_raw_os_error(result as i32)
            ));
        }
        Ok(Key(handle))
    }

    fn apply_plan(root: HKEY, entries: &[Entry]) -> Result<(), String> {
        for entry in entries {
            let key = create_key(root, &entry.key, KEY_SET_VALUE)?;
            let name = wide(&entry.name);
            let (kind, bytes) = match &entry.value {
                Value::Text(value) => (
                    REG_SZ,
                    wide(value)
                        .into_iter()
                        .flat_map(u16::to_le_bytes)
                        .collect::<Vec<_>>(),
                ),
                Value::Empty => (REG_NONE, Vec::new()),
            };
            let result = unsafe {
                RegSetValueExW(
                    key.0,
                    name.as_ptr(),
                    0,
                    kind,
                    if bytes.is_empty() {
                        ptr::null()
                    } else {
                        bytes.as_ptr()
                    },
                    bytes.len() as u32,
                )
            };
            if result != ERROR_SUCCESS {
                return Err(format!(
                    "更新文件关联失败，请重试：{}",
                    std::io::Error::from_raw_os_error(result as i32)
                ));
            }
        }
        Ok(())
    }

    pub(super) fn register_current_application() -> Result<(), String> {
        let executable =
            std::env::current_exe().map_err(|error| format!("无法获取当前程序路径：{error}"))?;
        apply_plan(HKEY_CURRENT_USER, &registration_plan(&executable)?)?;
        unsafe {
            SHChangeNotify(
                SHCNE_ASSOCCHANGED as i32,
                SHCNF_IDLIST,
                ptr::null(),
                ptr::null(),
            );
        }
        Ok(())
    }

    fn current_windows_build() -> Option<u32> {
        let key = wide("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion");
        let name = wide("CurrentBuildNumber");
        let mut buffer = [0u16; 32];
        let mut bytes = std::mem::size_of_val(&buffer) as u32;
        let result = unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                key.as_ptr(),
                name.as_ptr(),
                RRF_RT_REG_SZ,
                ptr::null_mut(),
                buffer.as_mut_ptr().cast(),
                &mut bytes,
            )
        };
        if result != ERROR_SUCCESS {
            return None;
        }
        let end = buffer.iter().position(|value| *value == 0)?;
        String::from_utf16(&buffer[..end]).ok()?.parse().ok()
    }

    fn settings_uri(build: Option<u32>) -> String {
        // The per-application URI is documented for Windows 11 23H2+ (22631+),
        // and patched 21H2/22H2. Use the general page for older/unknown builds;
        // this avoids treating an unpatched Windows 11 installation as supported.
        if build.is_some_and(|build| build >= 22631) {
            format!(
                "ms-settings:defaultapps?registeredAppUser={}",
                percent_encoding::utf8_percent_encode(
                    APPLICATION_NAME,
                    percent_encoding::NON_ALPHANUMERIC
                )
            )
        } else {
            "ms-settings:defaultapps".into()
        }
    }

    fn launch_settings(uri: &str) -> Result<(), String> {
        let operation = wide("open");
        let uri = wide(uri);
        let result = unsafe {
            ShellExecuteW(
                ptr::null_mut(),
                operation.as_ptr(),
                uri.as_ptr(),
                ptr::null(),
                ptr::null(),
                SW_SHOWNORMAL,
            )
        } as isize;
        if result <= 32 {
            return Err(format!(
                "无法打开 Windows 默认应用设置（错误 {result}），请在系统设置中搜索“默认应用”"
            ));
        }
        Ok(())
    }

    struct ComApartment(std::marker::PhantomData<std::rc::Rc<()>>);

    impl ComApartment {
        fn initialize() -> Result<Self, String> {
            let status = unsafe {
                CoInitializeEx(
                    ptr::null(),
                    (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32,
                )
            };
            if status < 0 {
                return Err(format!(
                    "初始化 Windows 设置组件失败（HRESULT 0x{:08X}）",
                    status as u32
                ));
            }
            // Both S_OK and S_FALSE require a matching CoUninitialize.
            Ok(Self(std::marker::PhantomData))
        }
    }

    impl Drop for ComApartment {
        fn drop(&mut self) {
            unsafe {
                CoUninitialize();
            }
        }
    }

    pub(super) fn open_default_apps_settings() -> Result<(), String> {
        // ShellExecute may activate COM shell extensions that require STA.
        // A fresh thread cannot inherit an incompatible COM mode from the
        // reused blocking pool. Its guard always uninitializes on that thread.
        // https://learn.microsoft.com/windows/win32/api/shellapi/nf-shellapi-shellexecutew
        std::thread::Builder::new()
            .name("windows-default-apps".into())
            .spawn(|| {
                let _apartment = ComApartment::initialize()?;
                let uri = settings_uri(current_windows_build());
                match launch_settings(&uri) {
                    Err(_) if uri.contains('?') => launch_settings("ms-settings:defaultapps"),
                    result => result,
                }
            })
            .map_err(|error| format!("无法启动 Windows 设置任务：{error}"))?
            .join()
            .map_err(|_| "Windows 设置任务意外结束".to_string())?
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::{
            sync::atomic::{AtomicU64, Ordering},
            time::{SystemTime, UNIX_EPOCH},
        };
        use windows_sys::Win32::System::Registry::{
            RegDeleteTreeW, RegOpenKeyExW, RegQueryValueExW, KEY_ALL_ACCESS, KEY_QUERY_VALUE,
        };

        static NEXT_TEST_ID: AtomicU64 = AtomicU64::new(0);

        struct TestRoot {
            key: Key,
            path: String,
        }

        impl TestRoot {
            fn new() -> Self {
                let path = format!(
                    "Software\\RollcatMD-AssociationTests-{}-{}-{}",
                    std::process::id(),
                    SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap()
                        .as_nanos(),
                    NEXT_TEST_ID.fetch_add(1, Ordering::Relaxed)
                );
                Self {
                    key: create_key(HKEY_CURRENT_USER, &path, KEY_ALL_ACCESS).unwrap(),
                    path,
                }
            }
        }

        impl Drop for TestRoot {
            fn drop(&mut self) {
                // This exact unique test subtree contains the simulated registry.
                // Never delete an association path or the shared parent test key.
                assert!(self
                    .path
                    .starts_with("Software\\RollcatMD-AssociationTests-"));
                unsafe {
                    RegDeleteTreeW(HKEY_CURRENT_USER, wide(&self.path).as_ptr());
                }
            }
        }

        fn read_value(root: HKEY, path: &str, name: &str) -> Value {
            let mut handle = ptr::null_mut();
            assert_eq!(
                unsafe {
                    RegOpenKeyExW(root, wide(path).as_ptr(), 0, KEY_QUERY_VALUE, &mut handle)
                },
                ERROR_SUCCESS
            );
            let key = Key(handle);
            let mut kind = 0;
            let mut bytes = 0;
            let name = wide(name);
            assert_eq!(
                unsafe {
                    RegQueryValueExW(
                        key.0,
                        name.as_ptr(),
                        ptr::null(),
                        &mut kind,
                        ptr::null_mut(),
                        &mut bytes,
                    )
                },
                ERROR_SUCCESS
            );
            let mut data = vec![0; bytes as usize];
            assert_eq!(
                unsafe {
                    RegQueryValueExW(
                        key.0,
                        name.as_ptr(),
                        ptr::null(),
                        &mut kind,
                        data.as_mut_ptr(),
                        &mut bytes,
                    )
                },
                ERROR_SUCCESS
            );
            if kind == REG_NONE {
                assert!(data.is_empty());
                return Value::Empty;
            }
            assert_eq!(kind, REG_SZ);
            let data = data
                .chunks_exact(2)
                .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                .collect::<Vec<_>>();
            assert_eq!(data.last(), Some(&0));
            Value::Text(String::from_utf16(&data[..data.len() - 1]).unwrap())
        }

        #[test]
        fn quotes_executable_document_argument_and_icon_for_unicode_and_spaces() {
            let entries = registration_plan(Path::new("C:\\应用 程序\\滚猫md.exe")).unwrap();
            for entry in entries
                .iter()
                .filter(|entry| entry.key.ends_with("\\command"))
            {
                assert_eq!(
                    entry.value,
                    Value::Text("\"C:\\应用 程序\\滚猫md.exe\" \"%1\"".into())
                );
            }
            for entry in entries
                .iter()
                .filter(|entry| entry.key.ends_with("\\DefaultIcon"))
            {
                assert_eq!(
                    entry.value,
                    Value::Text("\"C:\\应用 程序\\滚猫md.exe\",0".into())
                );
            }
            for path in [
                "relative.exe",
                "C:\\bad\"path\\app.exe",
                "C:\\bad\0path\\app.exe",
            ] {
                assert!(registration_plan(Path::new(path)).is_err());
            }
        }

        #[test]
        fn plan_covers_every_supported_type_and_never_writes_default_choices() {
            let entries = registration_plan(Path::new("C:\\notes\\renamed.exe")).unwrap();
            for extension in EXTENSIONS {
                assert!(super::super::super::is_supported_markdown_path(Path::new(
                    &format!("document{extension}")
                )));
                assert!(entries.iter().any(|entry| entry.key
                    == format!("Software\\Classes\\{extension}\\OpenWithProgids")
                    && entry.name == PROG_ID
                    && entry.value == Value::Empty));
                assert!(entries.iter().any(|entry| entry.key
                    == "Software\\Classes\\Applications\\renamed.exe\\SupportedTypes"
                    && entry.name == extension));
                assert!(entries.iter().any(|entry| entry.key
                    == format!("{CAPABILITIES_PATH}\\FileAssociations")
                    && entry.name == extension
                    && entry.value == Value::Text(PROG_ID.into())));
            }
            assert!(entries.iter().all(|entry| !entry.key.contains("UserChoice")
                && !EXTENSIONS
                    .iter()
                    .any(|extension| entry.key == format!("Software\\Classes\\{extension}"))));
            assert!(entries.contains(&Entry::text(
                "Software\\RegisteredApplications",
                APPLICATION_NAME,
                CAPABILITIES_PATH
            )));
            assert!(entries.contains(&Entry::text(
                CAPABILITIES_PATH,
                "ApplicationName",
                APPLICATION_NAME
            )));
        }

        #[test]
        fn registration_roundtrips_updates_idempotently_and_preserves_other_associations() {
            let root = TestRoot::new();
            let preserved = vec![
                Entry::text("Software\\Classes\\.md", "", "Other.Markdown"),
                Entry::text("Software\\Classes\\.md\\OpenWithProgids", "Other.Markdown", ""),
                Entry::text("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.md\\UserChoice", "ProgId", "Other.Markdown"),
                Entry::text("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.md\\UserChoice", "Hash", "unchanged-test-hash"),
                Entry::text("Software\\RegisteredApplications", "Other App", "Software\\Other\\Capabilities"),
            ];
            apply_plan(root.key.0, &preserved).unwrap();
            let initial = registration_plan(Path::new("C:\\Old Folder\\rollcat-md.exe")).unwrap();
            apply_plan(root.key.0, &initial).unwrap();
            for entry in &initial {
                assert_eq!(read_value(root.key.0, &entry.key, &entry.name), entry.value);
            }
            let updated = registration_plan(Path::new("D:\\新位置\\rollcat-md.exe")).unwrap();
            apply_plan(root.key.0, &updated).unwrap();
            apply_plan(root.key.0, &updated).unwrap();
            for entry in updated.iter().chain(&preserved) {
                assert_eq!(read_value(root.key.0, &entry.key, &entry.name), entry.value);
            }
        }

        #[test]
        fn settings_uri_encodes_registered_name_and_falls_back_for_older_systems() {
            assert_eq!(
                settings_uri(Some(22631)),
                "ms-settings:defaultapps?registeredAppUser=%E6%BB%9A%E7%8C%ABmd"
            );
            assert_eq!(settings_uri(Some(26100)), settings_uri(Some(22631)));
            for build in [None, Some(19045), Some(22000), Some(22621)] {
                assert_eq!(settings_uri(build), "ms-settings:defaultapps");
            }
        }

        #[test]
        fn initializes_and_releases_sta_on_a_dedicated_thread_without_opening_settings() {
            use windows_sys::Win32::{
                Foundation::CO_E_NOTINITIALIZED,
                System::Com::{CoGetApartmentType, APTTYPE_MAINSTA, APTTYPE_STA},
            };
            std::thread::spawn(|| {
                let mut kind = 0;
                let mut qualifier = 0;
                {
                    let _apartment = ComApartment::initialize().unwrap();
                    assert_eq!(unsafe { CoGetApartmentType(&mut kind, &mut qualifier) }, 0);
                    assert!(kind == APTTYPE_STA || kind == APTTYPE_MAINSTA);
                }
                assert_eq!(
                    unsafe { CoGetApartmentType(&mut kind, &mut qualifier) },
                    CO_E_NOTINITIALIZED
                );
            })
            .join()
            .unwrap();
        }
    }
}
