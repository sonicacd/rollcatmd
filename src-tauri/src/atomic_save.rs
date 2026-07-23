use std::{
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    process,
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT_TEMP_ID: AtomicU64 = AtomicU64::new(0);

const MAX_TEMP_ATTEMPTS: usize = 128;

/// Writes `contents` to a temporary file next to `target`, flushes it to disk,
/// and atomically replaces `target` only after the complete write succeeds.
pub(crate) fn write_atomic(target: &Path, contents: &[u8]) -> io::Result<()> {
    write_atomic_with(target, contents, replace_file_atomic)
}

fn write_atomic_with<F>(target: &Path, contents: &[u8], replace: F) -> io::Result<()>
where
    F: FnOnce(&Path, &Path) -> io::Result<()>,
{
    let parent = target
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "保存路径没有父目录"))?;

    if target.file_name().is_none() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "保存路径没有文件名",
        ));
    }
    if !parent.is_dir() {
        return Err(io::Error::new(io::ErrorKind::NotFound, "保存目录不存在"));
    }
    if target.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "保存路径是目录",
        ));
    }

    let (temporary_path, temporary_file) = create_temporary_file(target)?;
    let mut pending_temporary = PendingTemporary::new(temporary_path);

    write_and_sync(temporary_file, pending_temporary.path(), target, contents)?;
    replace(pending_temporary.path(), target)?;
    pending_temporary.disarm();
    sync_parent_directory(parent)?;

    Ok(())
}

fn create_temporary_file(target: &Path) -> io::Result<(PathBuf, File)> {
    let parent = target
        .parent()
        .expect("target was validated before this call");
    let file_name = target
        .file_name()
        .expect("target was validated before this call");

    for _ in 0..MAX_TEMP_ATTEMPTS {
        let id = NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed);
        let mut temporary_name = OsString::from(".");
        temporary_name.push(file_name);
        temporary_name.push(format!(".{}.{}.tmp", process::id(), id));
        let temporary_path = parent.join(temporary_name);

        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)
        {
            Ok(file) => return Ok((temporary_path, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }

    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "无法创建唯一的临时文件",
    ))
}

fn write_and_sync(
    mut temporary_file: File,
    temporary_path: &Path,
    target: &Path,
    contents: &[u8],
) -> io::Result<()> {
    copy_target_permissions(temporary_path, target)?;

    temporary_file.write_all(contents)?;
    temporary_file.sync_all()
}

#[cfg(unix)]
fn copy_target_permissions(temporary: &Path, target: &Path) -> io::Result<()> {
    if let Ok(metadata) = fs::metadata(target) {
        fs::set_permissions(temporary, metadata.permissions())?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn copy_target_permissions(_temporary: &Path, _target: &Path) -> io::Result<()> {
    // ReplaceFileW preserves the existing file's attributes and ACLs on Windows.
    Ok(())
}

#[cfg(windows)]
fn replace_file_atomic(temporary: &Path, target: &Path) -> io::Result<()> {
    use std::{iter, os::windows::ffi::OsStrExt, ptr};
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, ReplaceFileW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str()
            .encode_wide()
            .chain(iter::once(0))
            .collect()
    }

    let temporary_wide = wide(temporary);
    let target_wide = wide(target);

    match fs::symlink_metadata(target) {
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            // The temporary file is in the same directory, so this is a
            // same-volume rename. WRITE_THROUGH waits for the move to reach disk.
            let succeeded = unsafe {
                MoveFileExW(
                    temporary_wide.as_ptr(),
                    target_wide.as_ptr(),
                    MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
                )
            };
            return if succeeded != 0 {
                Ok(())
            } else {
                Err(io::Error::last_os_error())
            };
        }
        Err(error) => return Err(error),
    }

    // Supplying a backup gives us a recovery copy even for the uncommon partial
    // failure modes documented for ReplaceFileW.
    let mut backup_name = temporary.as_os_str().to_os_string();
    backup_name.push(".backup");
    let backup = PathBuf::from(backup_name);
    match fs::symlink_metadata(&backup) {
        Ok(_) => {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "原子替换备份路径已存在",
            ));
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let backup_wide = wide(&backup);

    let succeeded = unsafe {
        ReplaceFileW(
            target_wide.as_ptr(),
            temporary_wide.as_ptr(),
            backup_wide.as_ptr(),
            0,
            ptr::null(),
            ptr::null(),
        )
    };

    if succeeded != 0 {
        // The target is already committed. A cleanup failure should not turn a
        // successful save into a reported failure; a leftover backup is safe.
        let _ = fs::remove_file(backup);
        return Ok(());
    }

    let replace_error = io::Error::last_os_error();
    if backup.exists() && !target.exists() {
        // If ReplaceFileW moved the original before failing, put that original
        // back at the requested path. Leave the backup in place if recovery also
        // fails so the user's previous data remains recoverable.
        let restored = unsafe {
            MoveFileExW(
                backup_wide.as_ptr(),
                target_wide.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if restored == 0 {
            let restore_error = io::Error::last_os_error();
            return Err(io::Error::new(
                restore_error.kind(),
                format!(
                    "原子替换失败（{replace_error}），恢复原文件也失败（{restore_error}）；备份保留在 {}",
                    backup.display()
                ),
            ));
        }
    }

    Err(replace_error)
}

#[cfg(not(windows))]
fn replace_file_atomic(temporary: &Path, target: &Path) -> io::Result<()> {
    fs::rename(temporary, target)
}

#[cfg(unix)]
fn sync_parent_directory(parent: &Path) -> io::Result<()> {
    File::open(parent)?.sync_all()
}

#[cfg(not(unix))]
fn sync_parent_directory(_parent: &Path) -> io::Result<()> {
    // MoveFileExW uses MOVEFILE_WRITE_THROUGH on Windows.
    Ok(())
}

struct PendingTemporary {
    path: PathBuf,
    armed: bool,
}

impl PendingTemporary {
    fn new(path: PathBuf) -> Self {
        Self { path, armed: true }
    }

    fn path(&self) -> &Path {
        &self.path
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for PendingTemporary {
    fn drop(&mut self) {
        if self.armed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEST_ID: AtomicU64 = AtomicU64::new(0);

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            loop {
                let id = NEXT_TEST_ID.fetch_add(1, Ordering::Relaxed);
                let path = std::env::temp_dir().join(format!(
                    "rollcat-md-atomic-save-test-{}-{id}",
                    process::id()
                ));
                match fs::create_dir(&path) {
                    Ok(()) => return Self(path),
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                    Err(error) => panic!("create test directory {path:?}: {error}"),
                }
            }
        }

        fn join(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn creates_and_replaces_files_atomically() {
        let directory = TestDirectory::new();
        let target = directory.join("notes.md");

        write_atomic(&target, b"first").expect("create file");
        assert_eq!(fs::read(&target).expect("read created file"), b"first");

        write_atomic(&target, b"second\nline").expect("replace file");
        assert_eq!(
            fs::read(&target).expect("read replaced file"),
            b"second\nline"
        );
        assert_eq!(
            fs::read_dir(&directory.0).expect("list directory").count(),
            1,
            "temporary and backup files should be cleaned up"
        );
    }

    #[test]
    fn replacement_failure_preserves_original_and_removes_temporary() {
        let directory = TestDirectory::new();
        let target = directory.join("notes.md");
        fs::write(&target, b"original").expect("seed original file");

        let error = write_atomic_with(&target, b"replacement", |_temporary, _target| {
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "injected replacement failure",
            ))
        })
        .expect_err("replacement should fail");

        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
        assert_eq!(
            fs::read(&target).expect("read original after failure"),
            b"original"
        );
        assert_eq!(
            fs::read_dir(&directory.0).expect("list directory").count(),
            1,
            "failed writes should not leave a temporary file"
        );
    }

    #[test]
    fn rejects_directory_targets_without_modifying_them() {
        let directory = TestDirectory::new();
        let error = write_atomic(&directory.0, b"content").expect_err("directory is not a file");

        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert!(directory.0.is_dir());
    }
}
