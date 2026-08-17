#![allow(unused)]
mod crypto;
mod totp;
mod vault;

use chrono::Utc;
use serde_json::{json, Value};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};
use uuid::Uuid;
use vault::{Credential, LogEntry};

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Open NICOFIRE", true, None::<&str>)?;
            let lock = MenuItem::with_id(app, "lock", "Lock Vault", true, None::<&str>)?;
            let sep  = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &lock, &sep, &quit])?;

            TrayIconBuilder::new()
                .menu(&menu)
                .icon(app.default_window_icon().cloned().unwrap())
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            let _ = w.show(); let _ = w.set_focus();
                        }
                    }
                })
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "show" => { if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); } }
                    "lock" => { vault::lock(); if let Some(w) = app.get_webview_window("main") { let _ = w.emit("locked", ()); } }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_status, unlock, lock, change_password,
            get_all, save_credential, update_credential, delete_credential,
            toggle_favorite, get_health, gen_password, get_totp,
            get_settings, set_settings, copy_clipboard, clear_clipboard,
            export_vault, import_vault, export_encrypted, import_encrypted, get_logs,
        ])
        .run(tauri::generate_context!())
        .expect("NICOFIRE failed to start");
}

fn log(level: &str, ctx: &str, msg: &str) {
    let entry = LogEntry { ts: Utc::now().timestamp_millis(), level: level.into(), context: ctx.into(), message: msg.into() };
    let mut st = vault::state().lock().unwrap();
    if let Some(d) = st.data.as_mut() {
        d.logs.push(entry);
        if d.logs.len() > 500 { d.logs.remove(0); }
    }
}

#[tauri::command]
fn get_status() -> Value {
    json!({ "unlocked": vault::is_unlocked(), "vaultExists": vault::vault_exists() })
}

#[tauri::command]
fn unlock(password: String) -> Value {
    match vault::unlock(&password) {
        Ok(true)  => { log("INFO","auth","Vault unlocked"); let _ = vault::save(); json!({"success":true}) }
        Ok(false) => json!({"success":false,"error":"Wrong master password"}),
        Err(e)    => json!({"success":false,"error":e}),
    }
}

#[tauri::command]
fn lock() { vault::lock(); }

#[tauri::command]
fn change_password(current: String, new: String) -> Value {
    match vault::change_password(&current, &new) {
        Ok(true)  => json!({"success":true}),
        Ok(false) => json!({"success":false,"error":"Current password is wrong"}),
        Err(e)    => json!({"success":false,"error":e}),
    }
}

#[tauri::command]
fn get_all() -> Value {
    if !vault::is_unlocked() { return json!({"locked":true,"credentials":[]}); }
    let st = vault::state().lock().unwrap();
    let c = st.data.as_ref().map(|d| d.credentials.clone()).unwrap_or_default();
    json!({"credentials": c})
}

#[tauri::command]
fn save_credential(cred: Value) -> Value {
    if !vault::is_unlocked() { return json!({"success":false,"error":"Locked"}); }
    let now = Utc::now().to_rfc3339();
    let c = Credential {
        id: Uuid::new_v4().to_string(),
        website: s(&cred,"website"), username: s(&cred,"username"), password: s(&cred,"password"),
        label: os(&cred,"label"), folder: os(&cred,"folder"),
        tags: cred.get("tags").and_then(|t| t.as_array()).map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default(),
        favorite: cred.get("favorite").and_then(|f| f.as_bool()).unwrap_or(false),
        totp_secret: os(&cred,"totp_secret"), notes: os(&cred,"notes"),
        created_at: now.clone(), updated_at: now,
    };
    let id = c.id.clone();
    { let mut st = vault::state().lock().unwrap(); if let Some(d) = st.data.as_mut() { d.credentials.push(c); } }
    log("INFO","vault",&format!("Saved {}", s(&cred,"website")));
    match vault::save() { Ok(_) => json!({"success":true,"id":id}), Err(e) => json!({"success":false,"error":e}) }
}

#[tauri::command]
fn update_credential(cred: Value) -> Value {
    if !vault::is_unlocked() { return json!({"success":false,"error":"Locked"}); }
    let id = s(&cred,"id");
    let now = Utc::now().to_rfc3339();
    {
        let mut st = vault::state().lock().unwrap();
        if let Some(d) = st.data.as_mut() {
            if let Some(c) = d.credentials.iter_mut().find(|c| c.id == id) {
                c.website = s(&cred,"website"); c.username = s(&cred,"username"); c.password = s(&cred,"password");
                c.label = os(&cred,"label"); c.folder = os(&cred,"folder");
                c.tags = cred.get("tags").and_then(|t| t.as_array()).map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default();
                c.favorite = cred.get("favorite").and_then(|f| f.as_bool()).unwrap_or(c.favorite);
                c.totp_secret = os(&cred,"totp_secret"); c.notes = os(&cred,"notes");
                c.updated_at = now;
            }
        }
    }
    match vault::save() { Ok(_) => json!({"success":true}), Err(e) => json!({"success":false,"error":e}) }
}

#[tauri::command]
fn delete_credential(id: String) -> Value {
    if !vault::is_unlocked() { return json!({"success":false,"error":"Locked"}); }
    { let mut st = vault::state().lock().unwrap(); if let Some(d) = st.data.as_mut() { d.credentials.retain(|c| c.id != id); } }
    log("INFO","vault","Deleted credential");
    match vault::save() { Ok(_) => json!({"success":true}), Err(e) => json!({"success":false,"error":e}) }
}

#[tauri::command]
fn toggle_favorite(id: String) -> Value {
    { let mut st = vault::state().lock().unwrap();
      if let Some(d) = st.data.as_mut() {
        if let Some(c) = d.credentials.iter_mut().find(|c| c.id == id) { c.favorite = !c.favorite; }
      } }
    match vault::save() { Ok(_) => json!({"success":true}), Err(e) => json!({"success":false,"error":e}) }
}

#[tauri::command]
fn get_health() -> Value { serde_json::to_value(vault::health()).unwrap() }

#[tauri::command]
fn gen_password(length: usize, upper: bool, lower: bool, digits: bool, symbols: bool) -> Value {
    let pw = crypto::generate_password(length, upper, lower, digits, symbols);
    let strength = vault::password_strength(&pw);
    json!({"password": pw, "strength": strength})
}

#[tauri::command]
fn get_totp(secret: String) -> Value {
    match totp::generate(&secret) {
        Ok((code, rem)) => json!({"success":true,"code":code,"remaining":rem}),
        Err(e) => json!({"success":false,"error":e}),
    }
}

#[tauri::command]
fn get_settings() -> Value {
    let st = vault::state().lock().unwrap();
    let s = st.data.as_ref().map(|d| d.settings.clone()).unwrap_or_default();
    serde_json::to_value(s).unwrap()
}

#[tauri::command]
fn set_settings(settings: Value) -> Value {
    { let mut st = vault::state().lock().unwrap();
      if let Some(d) = st.data.as_mut() {
        if let Ok(s) = serde_json::from_value(settings) { d.settings = s; }
      } }
    match vault::save() { Ok(_) => json!({"success":true}), Err(e) => json!({"success":false,"error":e}) }
}

#[tauri::command]
fn copy_clipboard(text: String) -> Value {
    // Copy to clipboard AND mark the content to be excluded from Windows
    // Clipboard History and cloud clipboard sync, so the secret is not
    // retained by the OS or pushed to other devices.
    #[cfg(target_os = "windows")]
    {
        use std::process::{Command, Stdio};
        let esc = text.replace('\'', "''");
        let script = format!(
            "Add-Type -AssemblyName System.Windows.Forms; \
             $d = New-Object System.Windows.Forms.DataObject; \
             $d.SetText('{}'); \
             $d.SetData('ExcludeClipboardContentFromMonitorProcessing', $true); \
             $d.SetData('CanIncludeInClipboardHistory', $false); \
             $d.SetData('CanUploadToCloudClipboard', $false); \
             [System.Windows.Forms.Clipboard]::SetDataObject($d, $true)",
            esc
        );
        let _ = Command::new("powershell")
            .args(["-NoProfile","-NonInteractive","-STA","-Command", &script])
            .stdin(Stdio::null()).output();
    }
    json!({"success":true})
}

#[tauri::command]
fn clear_clipboard() -> Value {
    #[cfg(target_os = "windows")]
    {
        use std::process::{Command, Stdio};
        let _ = Command::new("powershell")
            .args(["-NoProfile","-NonInteractive","-Command","Set-Clipboard -Value ' '"])
            .stdin(Stdio::null()).output();
    }
    json!({"success":true})
}

#[tauri::command]
fn export_vault() -> Value {
    // Plaintext export retained but NOT the default path in the UI.
    if !vault::is_unlocked() { return json!({"success":false,"error":"Locked"}); }
    let st = vault::state().lock().unwrap();
    let creds = st.data.as_ref().map(|d| d.credentials.clone()).unwrap_or_default();
    json!({"success":true,"credentials":creds})
}

/// Encrypted export — protected by a user passphrase (the recommended path).
#[tauri::command]
fn export_encrypted(passphrase: String) -> Value {
    if !vault::is_unlocked() { return json!({"success":false,"error":"Locked"}); }
    if passphrase.len() < 8 { return json!({"success":false,"error":"Passphrase must be at least 8 characters"}); }
    match vault::export_encrypted(&passphrase) {
        Ok(blob) => json!({"success":true,"blob":blob}),
        Err(e)   => json!({"success":false,"error":e}),
    }
}

/// Import an encrypted export produced by NICOFIRE.
#[tauri::command]
fn import_encrypted(blob: String, passphrase: String) -> Value {
    if !vault::is_unlocked() { return json!({"success":false,"error":"Locked"}); }
    match vault::import_encrypted(&blob, &passphrase) {
        Ok(added) => json!({"success":true,"added":added}),
        Err(e)    => json!({"success":false,"error":e}),
    }
}

#[tauri::command]
fn import_vault(credentials: Value) -> Value {
    if !vault::is_unlocked() { return json!({"success":false,"error":"Locked"}); }
    let incoming: Vec<Credential> = serde_json::from_value(credentials).unwrap_or_default();
    let mut added = 0;
    { let mut st = vault::state().lock().unwrap();
      if let Some(d) = st.data.as_mut() {
        for mut c in incoming {
            if !d.credentials.iter().any(|e| e.website == c.website && e.username == c.username) {
                if c.id.is_empty() { c.id = Uuid::new_v4().to_string(); }
                d.credentials.push(c); added += 1;
            }
        }
      } }
    match vault::save() { Ok(_) => json!({"success":true,"added":added}), Err(e) => json!({"success":false,"error":e}) }
}

#[tauri::command]
fn get_logs() -> Value {
    let st = vault::state().lock().unwrap();
    let l = st.data.as_ref().map(|d| d.logs.clone()).unwrap_or_default();
    json!({"logs": l})
}

fn s(v: &Value, k: &str) -> String { v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string() }
fn os(v: &Value, k: &str) -> Option<String> { v.get(k).and_then(|x| x.as_str()).filter(|s| !s.is_empty()).map(String::from) }
