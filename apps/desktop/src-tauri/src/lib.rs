use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SaveSlotMeta {
    pub id: String,
    pub name: String,
    #[serde(rename = "householdName")]
    pub household_name: String,
    #[serde(rename = "playTimeSeconds")]
    pub play_time_seconds: u64,
    #[serde(rename = "schemaVersion")]
    pub schema_version: u32,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
pub struct AppPaths {
    pub saves: String,
    #[serde(rename = "userContent")]
    pub user_content: String,
}

fn saves_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("saves");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn user_content_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("userContent");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Reject absolute paths and `..` segments — path jail for assets.
fn jailed_join(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let rel = Path::new(relative);
    if rel.is_absolute() {
        return Err("absolute paths are not allowed".into());
    }
    for c in rel.components() {
        match c {
            Component::Normal(_) => {}
            Component::CurDir => {}
            _ => return Err("path traversal is not allowed".into()),
        }
    }
    let joined = root.join(rel);
    let canon_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    // Best-effort: ensure joined stays under root when it exists
    if let Ok(canon) = joined.canonicalize() {
        if !canon.starts_with(&canon_root) {
            return Err("path escapes resource root".into());
        }
        return Ok(canon);
    }
    Ok(joined)
}

#[tauri::command]
fn list_saves(app: tauri::AppHandle) -> Result<Vec<SaveSlotMeta>, String> {
    let dir = saves_dir(&app)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(meta) = v.get("meta") {
                if let Ok(m) = serde_json::from_value::<SaveSlotMeta>(meta.clone()) {
                    out.push(m);
                }
            }
        }
    }
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(out)
}

#[tauri::command]
fn load_game(app: tauri::AppHandle, id: String) -> Result<Vec<u8>, String> {
    let path = saves_dir(&app)?.join(format!("{id}.json"));
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let body_b64 = v
        .get("body")
        .and_then(|b| b.as_str())
        .ok_or_else(|| "missing body".to_string())?;
    B64.decode(body_b64).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_game(
    app: tauri::AppHandle,
    id: String,
    meta: SaveSlotMeta,
    body: Vec<u8>,
) -> Result<(), String> {
    let dir = saves_dir(&app)?;
    let final_path = dir.join(format!("{id}.json"));
    let tmp_path = dir.join(format!("{id}.json.tmp"));
    let body_b64 = B64.encode(&body);
    let payload = serde_json::json!({ "meta": meta, "body": body_b64 });
    let bytes = serde_json::to_vec_pretty(&payload).map_err(|e| e.to_string())?;
    fs::write(&tmp_path, &bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, &final_path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_save(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = saves_dir(&app)?.join(format!("{id}.json"));
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_asset(app: tauri::AppHandle, relative_pack_path: String) -> Result<Vec<u8>, String> {
    let resource = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("packs");
    let path = jailed_join(&resource, &relative_pack_path)?;
    fs::read(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_app_paths(app: tauri::AppHandle) -> Result<AppPaths, String> {
    Ok(AppPaths {
        saves: saves_dir(&app)?.to_string_lossy().into_owned(),
        user_content: user_content_dir(&app)?.to_string_lossy().into_owned(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            list_saves,
            load_game,
            save_game,
            delete_save,
            get_asset,
            get_app_paths
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                if let Some(win) = app.get_webview_window("main") {
                    // Right-click inspect / F12-style tools for blank-screen diagnosis
                    win.open_devtools();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running LifeSim");
}
