mod review_clipboard;
mod workflow_files;

pub fn run() {
    tauri::Builder::default()
        .manage(workflow_files::SelectedFiles::default())
        .invoke_handler(tauri::generate_handler![
            review_clipboard::copy_review_prompt,
            workflow_files::open_workflow,
            workflow_files::save_workflow_as,
            workflow_files::save_workflow,
            workflow_files::save_export,
            workflow_files::list_recovery,
            workflow_files::read_recovery,
            workflow_files::write_recovery,
            workflow_files::remove_recovery,
        ])
        .run(tauri::generate_context!())
        .expect("could not start FlowArchitect");
}
