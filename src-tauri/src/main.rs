#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(dead_code, unused_variables, unused_imports)]

use std::collections::HashMap;
use std::sync::Arc;
use parking_lot::Mutex;

mod ssh;
mod system;
mod store;

pub struct AppState {
    pub connections: Arc<Mutex<HashMap<String, ssh::connection::SshConnection>>>,
    pub terminals: Arc<Mutex<HashMap<String, ssh::terminal::TerminalSession>>>,
}

fn main() {
    env_logger::init();

    let state = AppState {
        connections: Arc::new(Mutex::new(HashMap::new())),
        terminals: Arc::new(Mutex::new(HashMap::new())),
    };

    tauri::Builder::default()
        .manage(state)
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            // SSH commands
            ssh::connection::ssh_connect,
            ssh::connection::ssh_disconnect,
            ssh::connection::ssh_list_connections,
            ssh::connection::ssh_test_connection,
            ssh::terminal::terminal_create,
            ssh::terminal::terminal_write,
            ssh::terminal::terminal_resize,
            ssh::terminal::terminal_close,
            ssh::terminal::ssh_launch_putty,
            ssh::sftp::sftp_list_dir,
            ssh::sftp::sftp_read_file,
            ssh::sftp::sftp_read_text_file,
            ssh::sftp::sftp_write_file,
            ssh::sftp::sftp_write_text_file,
            ssh::sftp::sftp_mkdir,
            ssh::sftp::sftp_delete,
            ssh::sftp::sftp_rename,
            ssh::sftp::sftp_chmod,
            ssh::sftp::sftp_chown,
            ssh::sftp::sftp_stat,
            ssh::sftp::sftp_download,
            ssh::sftp::sftp_upload,
            ssh::exec::ssh_exec,
            ssh::exec::ssh_exec_stream,
            ssh::exec::ssh_exec_stop,
            
            // System commands
            system::monitor::system_get_stats,
            system::monitor::system_get_disks,
            system::monitor::system_get_network,
            system::process::process_list,
            system::process::process_kill,
            system::process::process_renice,
            system::service::service_list,
            system::service::service_action,
            system::service::service_status,
            system::service::service_logs,
            system::docker::docker_containers,
            system::docker::docker_action,
            system::docker::docker_logs,
            system::docker::docker_images,
            system::docker::docker_exec,
            system::docker::docker_stats,
            system::network::network_ports,
            system::network::network_connections,
            system::network::network_interfaces,
            system::network::network_ping,
            system::network::network_dns_lookup,
            system::package::package_list,
            system::package::package_search,
            system::package::package_install,
            system::package::package_remove,
            system::package::package_update,
            system::package::package_upgradable,
            system::user::user_list,
            system::user::user_add,
            system::user::user_delete,
            system::user::user_modify,
            system::user::group_list,
            system::user::group_add,
            system::user::group_delete,
            system::user::who_is_logged_in,
            system::user::last_logins,
            system::cron::cron_list,
            system::cron::cron_list_all,
            system::cron::cron_add,
            system::cron::cron_remove,
            system::logs::logs_journal,
            system::logs::logs_file,
            system::logs::logs_stream_start,
            system::logs::logs_stream_stop,
            system::logs::logs_dmesg,
            system::firewall::firewall_status,
            system::firewall::firewall_rules,
            system::firewall::firewall_add_rule,
            system::firewall::firewall_delete_rule,
            system::firewall::firewall_toggle,
            system::disk::disk_list,
            system::disk::disk_usage,
            system::disk::disk_smart,
            system::disk::disk_largest_dirs,
            
            // Store commands
            store::connections::store_save_connection,
            store::connections::store_list_connections,
            store::connections::store_delete_connection,
            store::connections::store_update_connection,
            store::settings::settings_get,
            store::settings::settings_save,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
