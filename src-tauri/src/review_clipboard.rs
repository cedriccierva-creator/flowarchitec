#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn copy_review_prompt(
    window: tauri::WebviewWindow,
    contents: String,
) -> Result<(), String> {
    use gtk::{gdk::Display, Clipboard, TargetEntry, TargetFlags};

    const ERROR: &str = "Could not write to the desktop clipboard.";

    if contents.contains('\0') {
        return Err(ERROR.into());
    }
    let (tx, mut rx) = tauri::async_runtime::channel(1);
    window
        .run_on_main_thread(move || {
            let copied = Display::default()
                .and_then(|display| Clipboard::default(&display))
                .is_some_and(|clipboard| {
                    let targets = ["UTF8_STRING", "text/plain;charset=utf-8", "text/plain"]
                        .map(|target| TargetEntry::new(target, TargetFlags::empty(), 0));
                    clipboard.set_with_data(&targets, move |_, selection, _| {
                        selection.set_text(&contents);
                    })
                });
            let _ = tx.try_send(copied);
        })
        .map_err(|_| ERROR)?;

    if rx.recv().await == Some(true) {
        Ok(())
    } else {
        Err(ERROR.into())
    }
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub async fn copy_review_prompt() -> Result<(), String> {
    Err("The native clipboard is available on Linux.".into())
}
