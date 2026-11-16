use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State, WebviewWindow};

const MAX_BYTES: u64 = 8 * 1024 * 1024;
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy)]
enum FileDialog {
    OpenWorkflow,
    SaveWorkflow,
    ExportPng,
    ExportMarkdown,
}

impl FileDialog {
    fn extension(self) -> &'static str {
        match self {
            Self::OpenWorkflow | Self::SaveWorkflow => "json",
            Self::ExportPng => "png",
            Self::ExportMarkdown => "md",
        }
    }
}

#[derive(Default)]
pub struct SelectedFiles(Mutex<HashSet<String>>);

#[cfg(target_os = "linux")]
async fn choose_file(
    window: &WebviewWindow,
    purpose: FileDialog,
    suggested_name: String,
) -> Result<Option<PathBuf>, String> {
    use gtk::prelude::{FileChooserExt, NativeDialogExt};

    let (tx, mut rx) = tauri::async_runtime::channel(1);
    let window_handle = window.clone();
    window
        .run_on_main_thread(move || {
            let choice = (|| {
                let parent = window_handle
                    .gtk_window()
                    .map_err(|_| "The native file dialog could not open.")?;
                let (title, filter_name) = match purpose {
                    FileDialog::OpenWorkflow => ("Open workflow", "Workflow JSON"),
                    FileDialog::SaveWorkflow => ("Save workflow", "Workflow JSON"),
                    FileDialog::ExportPng => ("Export PNG", "PNG images"),
                    FileDialog::ExportMarkdown => ("Export Markdown", "Markdown documents"),
                };
                let save = !matches!(purpose, FileDialog::OpenWorkflow);
                let (action, accept) = if save {
                    (gtk::FileChooserAction::Save, "_Save")
                } else {
                    (gtk::FileChooserAction::Open, "_Open")
                };
                let dialog = gtk::FileChooserNative::new(
                    Some(title),
                    Some(&parent),
                    action,
                    Some(accept),
                    Some("_Cancel"),
                );
                dialog.set_modal(true);
                dialog.set_local_only(true);
                let filter = gtk::FileFilter::new();
                filter.set_name(Some(filter_name));
                let extension = purpose.extension();
                filter.add_pattern(&format!("*.{extension}"));
                filter.add_pattern(&format!("*.{}", extension.to_ascii_uppercase()));
                dialog.add_filter(filter);
                if save {
                    dialog.set_current_name(&suggested_name);
                    dialog.set_do_overwrite_confirmation(true);
                } else {
                    let all_files = gtk::FileFilter::new();
                    all_files.set_name(Some("All files"));
                    all_files.add_pattern("*");
                    dialog.add_filter(all_files);
                }
                if dialog.run() == gtk::ResponseType::Accept {
                    dialog.filename().map(Some).ok_or("Select a local file.")
                } else {
                    Ok(None)
                }
            })();
            let _ = tx.try_send(choice);
        })
        .map_err(|_| "The native file dialog could not open.")?;
    rx.recv()
        .await
        .ok_or("The native file dialog closed unexpectedly.")?
        .map_err(str::to_owned)
}

#[cfg(not(target_os = "linux"))]
async fn choose_file(
    _: &WebviewWindow,
    _: FileDialog,
    _: String,
) -> Result<Option<PathBuf>, String> {
    Err("Native file dialogs are available on Linux.".into())
}

fn path_string(path: PathBuf) -> Result<String, String> {
    path.into_os_string()
        .into_string()
        .map_err(|_| "The selected path contains unsupported characters.".into())
}

fn read_text(path: &Path) -> io::Result<String> {
    if !fs::metadata(path)?.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Not a regular file",
        ));
    }
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "File exceeds 8 MiB",
        ));
    }
    String::from_utf8(bytes).map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))
}

fn write_atomic(path: &Path, contents: &str) -> io::Result<()> {
    if contents.len() as u64 > MAX_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "File exceeds 8 MiB",
        ));
    }
    write_atomic_bytes(path, contents.as_bytes())
}

fn write_atomic_bytes(path: &Path, contents: &[u8]) -> io::Result<()> {
    let directory = path.parent().ok_or(io::ErrorKind::InvalidInput)?;
    let epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temporary = directory.join(format!(
        ".flowarchitect-{}-{epoch}-{sequence}.tmp",
        std::process::id()
    ));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary)?;
    let result = (|| {
        file.write_all(contents)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, path)?;
        #[cfg(unix)]
        let _ = File::open(directory).and_then(|directory| directory.sync_all());
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

fn read_error(error: io::Error) -> String {
    if error.kind() == io::ErrorKind::InvalidData {
        "The file must be UTF-8 and at most 8 MiB.".into()
    } else {
        "Could not read the workflow file.".into()
    }
}

fn write_error(error: io::Error) -> String {
    if error.kind() == io::ErrorKind::InvalidInput {
        "The workflow could not be written. Files must be at most 8 MiB.".into()
    } else {
        "Could not write the workflow file.".into()
    }
}

#[tauri::command]
pub async fn open_workflow(
    window: WebviewWindow,
    selected: State<'_, SelectedFiles>,
) -> Result<Option<(String, String)>, String> {
    let Some(path) = choose_file(&window, FileDialog::OpenWorkflow, String::new()).await? else {
        return Ok(None);
    };
    let path = path_string(path)?;
    let contents = read_text(Path::new(&path)).map_err(read_error)?;
    selected
        .0
        .lock()
        .map_err(|_| "File access is unavailable.")?
        .insert(path.clone());
    Ok(Some((path, contents)))
}

#[tauri::command]
pub async fn save_workflow_as(
    window: WebviewWindow,
    selected: State<'_, SelectedFiles>,
    suggested_name: String,
    contents: String,
) -> Result<Option<String>, String> {
    let Some(path) = choose_file(&window, FileDialog::SaveWorkflow, suggested_name).await? else {
        return Ok(None);
    };
    let path = path_string(path)?;
    write_atomic(Path::new(&path), &contents).map_err(write_error)?;
    selected
        .0
        .lock()
        .map_err(|_| "File access is unavailable.")?
        .insert(path.clone());
    Ok(Some(path))
}

#[tauri::command]
pub async fn save_workflow(
    selected: State<'_, SelectedFiles>,
    path: String,
    contents: String,
) -> Result<(), String> {
    if !selected
        .0
        .lock()
        .map_err(|_| "File access is unavailable.")?
        .contains(&path)
    {
        return Err("Choose the file location using Save As.".into());
    }
    write_atomic(Path::new(&path), &contents).map_err(write_error)
}

fn write_export(path: &Path, purpose: FileDialog, contents: &[u8]) -> Result<(), String> {
    let extension = purpose.extension();
    if !path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case(extension))
    {
        return Err(format!("Use the .{extension} extension for this export."));
    }
    write_atomic_bytes(path, contents)
        .map_err(|error| format!("Could not write the .{extension} export. {error}"))
}

#[tauri::command]
pub async fn save_export(
    window: WebviewWindow,
    format: String,
    suggested_name: String,
    contents: String,
) -> Result<bool, String> {
    let purpose = match format.as_str() {
        "png" => FileDialog::ExportPng,
        "md" => FileDialog::ExportMarkdown,
        _ => return Err("Unknown export format.".into()),
    };
    let Some(path) = choose_file(&window, purpose, suggested_name).await? else {
        return Ok(false);
    };
    let bytes = match purpose {
        FileDialog::ExportPng => decode_png(&contents)?,
        _ => contents.into_bytes(),
    };
    write_export(&path, purpose, &bytes)?;
    Ok(true)
}

#[cfg(target_os = "linux")]
fn decode_png(contents: &str) -> Result<Vec<u8>, String> {
    let png = gtk::glib::base64_decode(contents);
    if !png.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("Could not encode the workflow as PNG.".into());
    }
    Ok(png)
}

#[cfg(not(target_os = "linux"))]
fn decode_png(_: &str) -> Result<Vec<u8>, String> {
    Err("Native PNG export is available on Linux.".into())
}

fn recovery_directory(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "App data folder is unavailable.")?
        .join("recovery"))
}

fn valid_recovery_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn recovery_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !valid_recovery_id(id) {
        return Err("Invalid recovery ID.".into());
    }
    Ok(recovery_directory(app)?.join(format!("{id}.json")))
}

#[tauri::command]
pub async fn list_recovery(app: AppHandle) -> Result<Vec<String>, String> {
    let entries = match fs::read_dir(recovery_directory(&app)?) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err("Could not list recovery snapshots.".into()),
    };
    let mut snapshots = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "json") {
            if let Some(id) = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .filter(|id| valid_recovery_id(id))
            {
                let modified = entry
                    .metadata()
                    .and_then(|meta| meta.modified())
                    .unwrap_or(UNIX_EPOCH);
                snapshots.push((modified, id.to_owned()));
            }
        }
    }
    snapshots.sort_unstable_by(|a, b| b.cmp(a));
    Ok(snapshots.into_iter().map(|(_, id)| id).collect())
}

#[tauri::command]
pub async fn read_recovery(app: AppHandle, id: String) -> Result<String, String> {
    read_text(&recovery_path(&app, &id)?).map_err(read_error)
}

#[tauri::command]
pub async fn write_recovery(app: AppHandle, id: String, contents: String) -> Result<(), String> {
    let path = recovery_path(&app, &id)?;
    fs::create_dir_all(recovery_directory(&app)?)
        .map_err(|_| "Could not create the recovery folder.")?;
    write_atomic(&path, &contents).map_err(write_error)
}

#[tauri::command]
pub async fn remove_recovery(app: AppHandle, id: String) -> Result<(), String> {
    match fs::remove_file(recovery_path(&app, &id)?) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("Could not remove the recovery snapshot.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn separate_atomic_files_and_failed_replacement() -> io::Result<()> {
        let directory = std::env::temp_dir().join(format!(
            "flowarchitect-test-{}-{}",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&directory)?;
        let result = (|| {
            let first = directory.join("first.json");
            let second = directory.join("second.json");
            write_atomic(&first, "first")?;
            write_atomic(&second, "second")?;
            write_atomic(&first, "updated")?;
            assert_eq!(read_text(&first)?, "updated");
            assert_eq!(read_text(&second)?, "second");
            assert!(write_atomic(&first, &"x".repeat(MAX_BYTES as usize + 1)).is_err());
            assert_eq!(read_text(&first)?, "updated");

            let obstruction = directory.join("destination.json");
            fs::create_dir(&obstruction)?;
            assert!(write_atomic(&obstruction, "cannot replace a directory").is_err());
            assert_eq!(fs::read_dir(&directory)?.count(), 3);
            Ok(())
        })();
        let cleanup = fs::remove_dir_all(directory);
        result.and(cleanup)
    }

    #[test]
    fn recovery_ids_cannot_address_other_paths() {
        assert!(valid_recovery_id("0123456789abcdef0123456789abcdef"));
        assert!(!valid_recovery_id("../0123456789abcdef0123456789abc"));
        assert!(!valid_recovery_id("project.json"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn exports_png_bytes_and_utf8_markdown() -> Result<(), Box<dyn std::error::Error>> {
        let directory = std::env::temp_dir().join(format!(
            "flowarchitect-export-test-{}-{}",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&directory)?;
        let result = (|| {
            let png = decode_png("iVBORw0KGgo=")?;
            let png_path = directory.join("diagram.PNG");
            write_export(&png_path, FileDialog::ExportPng, &png)?;
            assert_eq!(fs::read(&png_path)?, b"\x89PNG\r\n\x1a\n");
            assert!(decode_png("not a png").is_err());

            let md_path = directory.join("architecture.md");
            let markdown = "# Project\n\nRévision\n";
            write_export(&md_path, FileDialog::ExportMarkdown, markdown.as_bytes())?;
            assert_eq!(fs::read_to_string(&md_path)?, markdown);

            let obstruction = directory.join("blocked.png");
            fs::create_dir(&obstruction)?;
            let error = write_export(&obstruction, FileDialog::ExportPng, &png).unwrap_err();
            assert!(error.starts_with("Could not write the .png export."));
            assert!(write_export(&md_path, FileDialog::ExportPng, &png).is_err());
            assert_eq!(fs::read_to_string(&md_path)?, markdown);
            assert_eq!(fs::read_dir(&directory)?.count(), 3);
            Ok(())
        })();
        let cleanup = fs::remove_dir_all(directory);
        result.and(cleanup.map_err(Into::into))
    }
}
