use serde::{Deserialize, Serialize};
use crate::AppState;
use super::monitor::DiskUsage;
use crate::ssh::exec::run_cmd;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BlockDevice {
    pub name: String,
    pub kname: Option<String>,
    pub path: Option<String>,
    pub size: String,
    pub size_bytes: Option<u64>,
    pub type_name: String,
    pub fstype: Option<String>,
    pub label: Option<String>,
    pub uuid: Option<String>,
    pub mountpoint: Option<String>,
    pub model: Option<String>,
    pub ro: Option<bool>,
    pub pttype: Option<String>,      // "gpt", "dos" (MBR)
    pub parttype: Option<String>,    // Partition type GUID / code
    pub children: Option<Vec<BlockDevice>>,
    pub is_system: Option<bool>,     // True if /, /boot, /boot/efi
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FstabEntry {
    pub spec: String,       // device, UUID=..., or LABEL=...
    pub file: String,       // mount point (e.g. /mnt/data)
    pub vfstype: String,    // ext4, xfs, etc.
    pub mntops: String,     // defaults,noatime
    pub freq: i32,          // dump freq
    pub passno: i32,        // fsck pass number
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LargestDir {
    pub path: String,
    pub size: String,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SmartStatus {
    pub device: String,
    pub health: String,
    pub temperature_c: Option<u32>,
    pub power_on_hours: Option<u64>,
    pub raw_output: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SwapInfo {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub free_bytes: u64,
    pub total_formatted: String,
    pub used_formatted: String,
    pub free_formatted: String,
    pub active_file: Option<String>,
    pub is_enabled: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TmpInfo {
    pub mount_point: String,
    pub filesystem: String,
    pub is_tmpfs: bool,
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub avail_bytes: u64,
    pub size_formatted: String,
    pub used_formatted: String,
    pub avail_formatted: String,
    pub percent: f32,
}

/// Helper to execute privileged disk commands via SSH using unified sudo authentication & admin PATH
async fn run_sudo(state: &AppState, conn_id: &str, cmd: &str) -> (String, i32) {
    let full_cmd = format!("export PATH=\"/usr/sbin:/sbin:/usr/local/sbin:$PATH\"; {}", cmd);
    crate::ssh::exec::run_cmd_priv(state, conn_id, &full_cmd).await
}

fn ensure_parted_script() -> &'static str {
    r#"export PATH="/usr/sbin:/sbin:/usr/local/sbin:$PATH"
if ! command -v parted >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
        DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null 2>&1 && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq parted >/dev/null 2>&1
    elif command -v dnf >/dev/null 2>&1; then
        dnf install -y -q parted >/dev/null 2>&1
    elif command -v yum >/dev/null 2>&1; then
        yum install -y -q parted >/dev/null 2>&1
    elif command -v pacman >/dev/null 2>&1; then
        pacman -Sy --noconfirm parted >/dev/null 2>&1
    elif command -v apk >/dev/null 2>&1; then
        apk add --no-cache parted >/dev/null 2>&1
    fi
fi
"#
}

fn format_bytes(bytes: u64) -> String {
    if bytes >= 1024 * 1024 * 1024 * 1024 {
        format!("{:.1} TB", bytes as f64 / (1024.0 * 1024.0 * 1024.0 * 1024.0))
    } else if bytes >= 1024 * 1024 * 1024 {
        format!("{:.1} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
    } else if bytes >= 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    } else if bytes >= 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{} B", bytes)
    }
}

pub fn is_critical_system_mount(_mountpoint: Option<&str>) -> bool {
    // User requested: "disk application system protected feature remove. I manage it."
    false
}

fn parse_device_json(dev: &serde_json::Value) -> BlockDevice {
    let name = dev.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let kname = dev.get("kname").and_then(|v| v.as_str()).map(|s| s.to_string());
    let path = dev.get("path").and_then(|v| v.as_str()).map(|s| s.to_string())
        .or_else(|| if !name.is_empty() && !name.starts_with('/') { Some(format!("/dev/{}", name)) } else { None });

    let size_val = dev.get("size");
    let (size_str, size_bytes) = if let Some(bytes) = size_val.and_then(|v| v.as_u64()) {
        (format_bytes(bytes), Some(bytes))
    } else if let Some(s) = size_val.and_then(|v| v.as_str()) {
        (s.to_string(), None)
    } else {
        ("0B".to_string(), None)
    };

    let type_name = dev.get("type").and_then(|v| v.as_str()).unwrap_or("disk").to_string();
    let fstype = dev.get("fstype").and_then(|v| v.as_str()).map(|s| s.to_string());
    let label = dev.get("label").and_then(|v| v.as_str()).map(|s| s.to_string());
    let uuid = dev.get("uuid").and_then(|v| v.as_str()).map(|s| s.to_string());
    let mountpoint = dev.get("mountpoint").and_then(|v| v.as_str()).map(|s| s.to_string());
    let model = dev.get("model").and_then(|v| v.as_str()).map(|s| s.to_string());
    let ro = dev.get("ro").and_then(|v| v.as_bool());
    let pttype = dev.get("pttype").and_then(|v| v.as_str()).map(|s| s.to_string());
    let parttype = dev.get("parttype").and_then(|v| v.as_str()).map(|s| s.to_string());

    let mut is_system = is_critical_system_mount(mountpoint.as_deref());

    let children = dev.get("children").and_then(|c| c.as_array()).map(|arr| {
        arr.iter().map(|child_val| {
            let child = parse_device_json(child_val);
            if child.is_system == Some(true) {
                is_system = true;
            }
            child
        }).collect()
    });

    BlockDevice {
        name,
        kname,
        path,
        size: size_str,
        size_bytes,
        type_name,
        fstype,
        label,
        uuid,
        mountpoint,
        model,
        ro,
        pttype,
        parttype,
        children,
        is_system: Some(is_system),
    }
}

#[tauri::command]
pub async fn disk_list(state: tauri::State<'_, AppState>, conn_id: String) -> Result<Vec<BlockDevice>, String> {
    // Try lsblk with JSON and detailed partition attributes
    let (stdout, code) = run_cmd(&state, &conn_id, "lsblk -J -b -o NAME,KNAME,PATH,SIZE,TYPE,FSTYPE,LABEL,UUID,MOUNTPOINT,RO,MODEL,PTTYPE,PARTTYPE 2>/dev/null || lsblk -J -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT,MODEL").await;

    if code == 0 && !stdout.trim().is_empty() {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&stdout) {
            if let Some(blockdevices) = val.get("blockdevices").and_then(|b| b.as_array()) {
                let devices: Vec<BlockDevice> = blockdevices.iter().map(parse_device_json).collect();
                return Ok(devices);
            }
        }
    }

    // Fallback: plaintext lsblk parsing if json flag is not supported on older distributions
    let (plain, _) = run_cmd(&state, &conn_id, "lsblk -r -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT 2>/dev/null").await;
    let mut devices = Vec::new();
    for line in plain.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 3 {
            let name = parts[0].to_string();
            let path = Some(format!("/dev/{}", name));
            let mountpoint = parts.get(4).map(|s| s.to_string());
            let is_system = is_critical_system_mount(mountpoint.as_deref());

            devices.push(BlockDevice {
                name,
                kname: None,
                path,
                size: parts[1].to_string(),
                size_bytes: None,
                type_name: parts[2].to_string(),
                fstype: parts.get(3).map(|s| s.to_string()),
                label: None,
                uuid: None,
                mountpoint,
                model: None,
                ro: None,
                pttype: None,
                parttype: None,
                children: None,
                is_system: Some(is_system),
            });
        }
    }

    Ok(devices)
}

#[tauri::command]
pub async fn disk_usage(state: tauri::State<'_, AppState>, conn_id: String) -> Result<Vec<DiskUsage>, String> {
    let (stdout, code) = run_cmd(&state, &conn_id, "df -B1 -P -x tmpfs -x devtmpfs -x squashfs").await;

    if code == 0 && !stdout.trim().is_empty() {
        let mut usages = Vec::new();
        for line in stdout.lines().skip(1) {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 6 {
                let filesystem = parts[0].to_string();
                let total: u64 = parts[1].parse().unwrap_or(0);
                let used: u64 = parts[2].parse().unwrap_or(0);
                let available: u64 = parts[3].parse().unwrap_or(0);
                let percent: f32 = parts[4].trim_end_matches('%').parse().unwrap_or(0.0);
                let mount_point = parts[5].to_string();

                usages.push(DiskUsage {
                    filesystem,
                    mount_point,
                    total,
                    used,
                    available,
                    percent,
                });
            }
        }
        return Ok(usages);
    }

    Ok(vec![])
}

#[tauri::command]
pub async fn disk_smart(state: tauri::State<'_, AppState>, conn_id: String, device: String) -> Result<String, String> {
    let clean_dev = device.trim_start_matches("/dev/");
    let cmd = format!("smartctl -H -A /dev/{} 2>/dev/null || smartctl -H /dev/{} 2>/dev/null || echo 'SMART info unavailable for {}'", clean_dev, clean_dev, clean_dev);
    let (stdout, _) = run_sudo(&state, &conn_id, &cmd).await;
    Ok(stdout)
}

#[tauri::command]
pub async fn disk_largest_dirs(state: tauri::State<'_, AppState>, conn_id: String, path: String) -> Result<String, String> {
    let cmd = format!("du -h -d 1 '{}' 2>/dev/null | sort -hr | head -n 10", path);
    let (stdout, _) = run_cmd(&state, &conn_id, &cmd).await;
    Ok(stdout)
}

// -------------------------------------------------------------
// Disk Mount, Remount & Unmount Operations
// -------------------------------------------------------------

#[tauri::command]
pub async fn disk_mount(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    device: String,
    mount_point: String,
    fstype: Option<String>,
    options: Option<String>,
    persist_fstab: bool,
) -> Result<String, String> {
    let clean_mp = mount_point.trim();
    if clean_mp.is_empty() {
        return Err("Mount point cannot be empty.".to_string());
    }

    let mut mount_cmd = format!("mkdir -p '{}' && mount", clean_mp);
    if let Some(ref fs) = fstype {
        if !fs.is_empty() && fs != "auto" {
            mount_cmd.push_str(&format!(" -t {}", fs));
        }
    }
    if let Some(ref opt) = options {
        if !opt.trim().is_empty() {
            mount_cmd.push_str(&format!(" -o {}", opt.trim()));
        }
    }
    mount_cmd.push_str(&format!(" '{}' '{}'", device.trim(), clean_mp));

    if persist_fstab {
        let fs_val = fstype.as_deref().unwrap_or("auto");
        let opts_val = options.as_deref().unwrap_or("defaults");
        // Append to /etc/fstab if not already present
        mount_cmd.push_str(&format!(
            " && (grep -qs '[[:space:]]{}[[:space:]]' /etc/fstab || printf '%s %s %s %s 0 2\\n' '{}' '{}' '{}' '{}' >> /etc/fstab)",
            clean_mp, device.trim(), clean_mp, fs_val, opts_val
        ));
    }

    let (stdout, code) = run_sudo(&state, &conn_id, &mount_cmd).await;
    if code != 0 {
        return Err(format!("Mount failed (exit code {}): {}", code, stdout.trim()));
    }

    Ok(format!("Successfully mounted '{}' to '{}'", device, clean_mp))
}

#[tauri::command]
pub async fn disk_unmount(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    target: String,
    force: bool,
    lazy: bool,
    remove_from_fstab: bool,
) -> Result<String, String> {
    let clean_target = target.trim();
    if clean_target.is_empty() {
        return Err("Target device or mount point cannot be empty.".to_string());
    }

    let mut umount_cmd = "umount".to_string();
    if force {
        umount_cmd.push_str(" -f");
    }
    if lazy {
        umount_cmd.push_str(" -l");
    }
    umount_cmd.push_str(&format!(" '{}'", clean_target));

    if remove_from_fstab {
        umount_cmd.push_str(&format!(
            " && sed -i '\\#[[:space:]]{}[[:space:]]#d' /etc/fstab 2>/dev/null || true",
            clean_target
        ));
    }

    let (stdout, code) = run_sudo(&state, &conn_id, &umount_cmd).await;
    if code != 0 {
        return Err(format!("Unmount failed (exit code {}): {}", code, stdout.trim()));
    }

    Ok(format!("Successfully unmounted '{}'", clean_target))
}

#[tauri::command]
pub async fn disk_remount(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    mount_point: String,
    options: String,
) -> Result<String, String> {
    let clean_mp = mount_point.trim();
    let opts = options.trim();
    let cmd = format!("mount -o remount,{} '{}'", opts, clean_mp);
    let (stdout, code) = run_sudo(&state, &conn_id, &cmd).await;
    if code != 0 {
        return Err(format!("Remount failed (exit code {}): {}", code, stdout.trim()));
    }
    Ok(format!("Successfully remounted '{}' with options '{}'", clean_mp, opts))
}

#[tauri::command]
pub async fn disk_get_fstab(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<Vec<FstabEntry>, String> {
    let (stdout, _) = run_cmd(&state, &conn_id, "cat /etc/fstab 2>/dev/null").await;
    let mut entries = Vec::new();

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() >= 4 {
            entries.push(FstabEntry {
                spec: parts[0].to_string(),
                file: parts[1].to_string(),
                vfstype: parts[2].to_string(),
                mntops: parts[3].to_string(),
                freq: parts.get(4).and_then(|s| s.parse().ok()).unwrap_or(0),
                passno: parts.get(5).and_then(|s| s.parse().ok()).unwrap_or(0),
            });
        }
    }

    Ok(entries)
}

// -------------------------------------------------------------
// Partition Table (GPT / MBR) Operations
// -------------------------------------------------------------

#[tauri::command]
pub async fn disk_create_label(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    device: String,
    label_type: String, // "gpt" or "msdos"
) -> Result<String, String> {
    let clean_dev = device.trim();
    let clean_lbl = label_type.trim().to_lowercase();
    if clean_lbl != "gpt" && clean_lbl != "msdos" {
        return Err("Partition table type must be 'gpt' or 'msdos' (MBR).".to_string());
    }

    let cmd = format!(
        r#"{ensure_parted}
if command -v parted >/dev/null 2>&1; then
    parted -s '{dev}' mklabel {lbl}
elif command -v sfdisk >/dev/null 2>&1; then
    echo "label: {lbl}" | sfdisk '{dev}'
else
    echo "Error: Neither parted nor sfdisk command found." >&2
    exit 127
fi
partprobe '{dev}' 2>/dev/null || true
"#,
        ensure_parted = ensure_parted_script(),
        dev = clean_dev,
        lbl = clean_lbl
    );
    let (stdout, code) = run_sudo(&state, &conn_id, &cmd).await;
    if code != 0 {
        return Err(format!("Failed to initialize {} partition table on {}: {}", clean_lbl.to_uppercase(), clean_dev, stdout.trim()));
    }

    Ok(format!("Successfully created {} partition table on '{}'", clean_lbl.to_uppercase(), clean_dev))
}

// -------------------------------------------------------------
// Partition Add, Resize, Flag & Delete Operations
// -------------------------------------------------------------

#[tauri::command]
pub async fn disk_create_partition(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    device: String,
    part_type: String, // "primary" | "logical"
    start: String,     // e.g. "1MiB", "0%", or custom
    end: String,       // e.g. "+5GiB", "10GiB", "100%", "5GB"
    fstype: Option<String>,
    label: Option<String>,
) -> Result<String, String> {
    let clean_dev = device.trim().to_string();
    let dev_path = if clean_dev.starts_with('/') { clean_dev } else { format!("/dev/{}", clean_dev) };
    let clean_type = if part_type.trim().is_empty() { "primary" } else { part_type.trim() };
    let clean_start = if start.trim().is_empty() { "1MiB" } else { start.trim() };
    let clean_end = if end.trim().is_empty() { "100%" } else { end.trim() };
    let fs_val = fstype.as_deref().unwrap_or("").trim().to_lowercase();
    let lbl_val = label.as_deref().unwrap_or("").trim();

    let script = format!(
        r#"{ensure_parted}
set -e

DEV='{dev}'
PART_TYPE='{ptype}'
USER_START='{start}'
USER_END='{end}'
FS='{fs}'
LABEL='{label}'

if [ ! -b "$DEV" ]; then
    echo "Block device '$DEV' does not exist." >&2
    exit 1
fi

# Detect or initialize partition table (GPT)
PT_CHECK=$(parted -s "$DEV" print 2>&1 || true)
if echo "$PT_CHECK" | grep -qi "unrecognised disk label\|unknown partition table"; then
    parted -s "$DEV" mklabel gpt
    partprobe "$DEV" 2>/dev/null || true
    sleep 1
fi

# Detect partition table type
PT_TYPE=$(blkid -s PTTYPE -o value "$DEV" 2>/dev/null || parted -s -m "$DEV" print 2>/dev/null | grep "^$DEV:" | cut -d: -f6 || echo "gpt")
PT_TYPE=$(echo "$PT_TYPE" | tr '[:upper:]' '[:lower:]')
if [ -z "$PT_TYPE" ]; then
    PT_TYPE="gpt"
fi

# Find the highest ending boundary in MiB among existing partitions
LAST_END_MIB=$(parted -s -m "$DEV" unit MiB print 2>/dev/null | awk -F: '$1 ~ /^[0-9]+$/ {{ 
    val = $3; 
    gsub(/[^0-9.]/, "", val); 
    num = int(val); 
    if (num > max) max = num 
}} END {{ if (max > 0) print max; else print 1 }}')

if [ -z "$LAST_END_MIB" ] || [ "$LAST_END_MIB" -lt 1 ]; then
    LAST_END_MIB=1
fi

# Determine START
if [ "$USER_START" = "1MiB" ] || [ "$USER_START" = "0%" ] || [ -z "$USER_START" ]; then
    if [ "$LAST_END_MIB" -gt 1 ]; then
        START_MIB=$((LAST_END_MIB + 1))
        CALC_START="${{START_MIB}}MiB"
    else
        START_MIB=1
        CALC_START="1MiB"
    fi
else
    CALC_START="$USER_START"
    START_MIB=$(echo "$USER_START" | sed -E 's/[^0-9]//g')
    if [ -z "$START_MIB" ] || [ "$START_MIB" -lt 1 ]; then START_MIB=1; fi
fi

# Determine END
CLEAN_END="$USER_END"
if echo "$CLEAN_END" | grep -q '^+'; then
    NUM=$(echo "$CLEAN_END" | sed -E 's/^\+([0-9.]+).*/\1/')
    UNIT=$(echo "$CLEAN_END" | sed -E 's/^\+[0-9.]+//' | tr '[:lower:]' '[:upper:]')
    ADD_MIB=1024
    case "$UNIT" in
        T|TB|TIB) ADD_MIB=$(awk "BEGIN {{print int($NUM * 1048576)}}") ;;
        G|GB|GIB) ADD_MIB=$(awk "BEGIN {{print int($NUM * 1024)}}") ;;
        M|MB|MIB) ADD_MIB=$(awk "BEGIN {{print int($NUM)}}") ;;
        K|KB|KIB) ADD_MIB=$(awk "BEGIN {{print int($NUM / 1024)}}") ;;
        *)        ADD_MIB=$(awk "BEGIN {{print int($NUM * 1024)}}") ;;
    esac
    if [ -z "$ADD_MIB" ] || [ "$ADD_MIB" -le 0 ]; then ADD_MIB=1024; fi

    END_MIB=$((START_MIB + ADD_MIB))
    CALC_END="${{END_MIB}}MiB"
elif [ "$CLEAN_END" = "100%" ]; then
    CALC_END="100%"
else
    CALC_END="$CLEAN_END"
fi

BEFORE_PARTS=$(lsblk -ln -o PATH "$DEV" 2>/dev/null | grep -v "^$DEV$" | wc -l)

# Execute mkpart
FS_ARG=""
if [ -n "$FS" ] && [ "$FS" != "none" ]; then
    FS_ARG="$FS"
fi

if [ "$PT_TYPE" = "gpt" ]; then
    PART_NAME="$LABEL"
    if [ -z "$PART_NAME" ]; then PART_NAME="data"; fi
    if [ -n "$FS_ARG" ]; then
        parted -s -a optimal "$DEV" mkpart "$PART_NAME" "$FS_ARG" "$CALC_START" "$CALC_END"
    else
        parted -s -a optimal "$DEV" mkpart "$PART_NAME" "$CALC_START" "$CALC_END"
    fi
else
    MBR_TYPE="$PART_TYPE"
    if [ -z "$MBR_TYPE" ]; then MBR_TYPE="primary"; fi
    if [ -n "$FS_ARG" ]; then
        parted -s -a optimal "$DEV" mkpart "$MBR_TYPE" "$FS_ARG" "$CALC_START" "$CALC_END"
    else
        parted -s -a optimal "$DEV" mkpart "$MBR_TYPE" "$CALC_START" "$CALC_END"
    fi
fi

partprobe "$DEV" 2>/dev/null || true
udevadm settle 2>/dev/null || sleep 2

NEW_PART=$(lsblk -ln -o PATH "$DEV" 2>/dev/null | grep -v "^$DEV$" | tail -n 1)
AFTER_PARTS=$(lsblk -ln -o PATH "$DEV" 2>/dev/null | grep -v "^$DEV$" | wc -l)

if [ -z "$NEW_PART" ] || [ ! -b "$NEW_PART" ] || [ "$AFTER_PARTS" -le "$BEFORE_PARTS" ]; then
    echo "Partition creation failed: Block device was not created on $DEV ($CALC_START to $CALC_END)." >&2
    exit 1
fi

# Optional Filesystem Format
if [ -n "$FS" ] && [ "$FS" != "none" ]; then
    case "$FS" in
        ext4)  mkfs.ext4 -F "$NEW_PART" ;;
        ext3)  mkfs.ext3 -F "$NEW_PART" ;;
        ext2)  mkfs.ext2 -F "$NEW_PART" ;;
        xfs)   mkfs.xfs -f "$NEW_PART" ;;
        btrfs) mkfs.btrfs -f "$NEW_PART" ;;
        vfat|fat32) mkfs.vfat -F 32 "$NEW_PART" ;;
        ntfs)  mkfs.ntfs -f -q "$NEW_PART" ;;
        swap)  mkswap -f "$NEW_PART" ;;
    esac
fi

# Optional filesystem label
if [ -n "$LABEL" ]; then
    case "$FS" in
        ext4|ext3|ext2) e2label "$NEW_PART" "$LABEL" 2>/dev/null || true ;;
        xfs)   xfs_admin -L "$LABEL" "$NEW_PART" 2>/dev/null || true ;;
        btrfs) btrfs filesystem label "$NEW_PART" "$LABEL" 2>/dev/null || true ;;
        vfat|fat32) fatlabel "$NEW_PART" "$LABEL" 2>/dev/null || true ;;
        ntfs)  ntfslabel "$NEW_PART" "$LABEL" 2>/dev/null || true ;;
    esac
fi

partprobe "$DEV" 2>/dev/null || true
echo "$NEW_PART"
"#,
        ensure_parted = ensure_parted_script(),
        dev = dev_path,
        ptype = clean_type,
        start = clean_start,
        end = clean_end,
        fs = fs_val,
        label = lbl_val,
    );

    let (stdout, code) = run_sudo(&state, &conn_id, &script).await;
    if code != 0 {
        return Err(format!("Partition creation failed (code {}): {}", code, stdout.trim()));
    }

    let created_part = stdout.lines().last().unwrap_or("").trim();
    let part_disp = if !created_part.is_empty() { created_part } else { &dev_path };
    Ok(format!("Successfully created partition '{}' ({})", part_disp, clean_end))
}

#[tauri::command]
pub async fn disk_delete_partition(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    device: String,
    part_number: u32,
    part_device: Option<String>,
) -> Result<String, String> {
    let clean_dev = device.trim().to_string();
    let dev_path = if clean_dev.starts_with('/') { clean_dev } else { format!("/dev/{}", clean_dev) };
    let pdev = part_device.unwrap_or_else(|| {
        if dev_path.chars().last().map(|c| c.is_ascii_digit()).unwrap_or(false) {
            format!("{}p{}", dev_path, part_number)
        } else {
            format!("{}{}", dev_path, part_number)
        }
    });

    let rm_cmd = format!(
        r#"{ensure_parted}
set -e
DEV='{dev}'
NUM={num}
PDEV='{pdev}'

if [ -b "$PDEV" ]; then
    swapoff "$PDEV" 2>/dev/null || true
    umount -f -l "$PDEV" 2>/dev/null || true
    wipefs -a "$PDEV" 2>/dev/null || true
fi

if command -v parted >/dev/null 2>&1; then
    parted -s "$DEV" rm "$NUM"
elif command -v sfdisk >/dev/null 2>&1; then
    sfdisk --delete "$DEV" "$NUM"
else
    echo "Error: Neither parted nor sfdisk command found." >&2
    exit 127
fi

partprobe "$DEV" 2>/dev/null || true
udevadm settle 2>/dev/null || sleep 1
"#,
        ensure_parted = ensure_parted_script(),
        dev = dev_path,
        num = part_number,
        pdev = pdev
    );

    let (stdout, code) = run_sudo(&state, &conn_id, &rm_cmd).await;
    if code != 0 {
        return Err(format!("Failed to delete partition {} on {}: {}", part_number, dev_path, stdout.trim()));
    }

    Ok(format!("Successfully deleted partition #{} on '{}'", part_number, dev_path))
}

#[tauri::command]
pub async fn disk_resize_partition(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    device: String,
    part_number: u32,
    new_end: String,
    part_device: Option<String>,
    fstype: Option<String>,
) -> Result<String, String> {
    let clean_dev = device.trim().to_string();
    let dev_path = if clean_dev.starts_with('/') { clean_dev } else { format!("/dev/{}", clean_dev) };
    let clean_end = new_end.trim().to_string();
    let pdev = part_device.unwrap_or_else(|| {
        if dev_path.chars().last().map(|c| c.is_ascii_digit()).unwrap_or(false) {
            format!("{}p{}", dev_path, part_number)
        } else {
            format!("{}{}", dev_path, part_number)
        }
    });
    let fs = fstype.as_deref().unwrap_or("").to_lowercase();

    let resize_script = format!(
        r#"{ensure_parted}
set -e
DEV='{dev}'
NUM={num}
PDEV='{pdev}'
NEW_END='{end}'
FS='{fs}'

# Find current partition end in MiB
CUR_END_MIB=$(parted -s -m "$DEV" unit MiB print 2>/dev/null | awk -F: -v p="$NUM" '$1 == p {{ 
    val = $3; 
    gsub(/[^0-9.]/, "", val); 
    print int(val) 
}}')
if [ -z "$CUR_END_MIB" ] || [ "$CUR_END_MIB" -le 0 ]; then
    CUR_END_MIB=1024
fi

if echo "$NEW_END" | grep -q '^+'; then
    NUM_VAL=$(echo "$NEW_END" | sed -E 's/^\+([0-9.]+).*/\1/')
    UNIT_VAL=$(echo "$NEW_END" | sed -E 's/^\+[0-9.]+//' | tr '[:lower:]' '[:upper:]')
    ADD_MIB=1024
    case "$UNIT_VAL" in
        T|TB|TIB) ADD_MIB=$(awk "BEGIN {{print int($NUM_VAL * 1048576)}}") ;;
        G|GB|GIB) ADD_MIB=$(awk "BEGIN {{print int($NUM_VAL * 1024)}}") ;;
        M|MB|MIB) ADD_MIB=$(awk "BEGIN {{print int($NUM_VAL)}}") ;;
        K|KB|KIB) ADD_MIB=$(awk "BEGIN {{print int($NUM_VAL / 1024)}}") ;;
        *)        ADD_MIB=$(awk "BEGIN {{print int($NUM_VAL * 1024)}}") ;;
    esac
    TARGET_END_MIB=$((CUR_END_MIB + ADD_MIB))
    TARGET_END="${{TARGET_END_MIB}}MiB"
elif [ "$NEW_END" = "100%" ]; then
    TARGET_END="100%"
else
    TARGET_END="$NEW_END"
fi

if [ "$FS" = "ext4" ] || [ "$FS" = "ext3" ] || [ "$FS" = "ext2" ]; then
    e2fsck -f -y "$PDEV" 2>/dev/null || true
fi

# Resize partition table
parted -s "$DEV" resizepart "$NUM" "$TARGET_END"
partprobe "$DEV" 2>/dev/null || true
udevadm settle 2>/dev/null || sleep 1

# Filesystem expansion
case "$FS" in
    ext4|ext3|ext2)
        resize2fs "$PDEV"
        ;;
    xfs)
        MP=$(findmnt -n -o TARGET "$PDEV" 2>/dev/null || true)
        if [ -n "$MP" ]; then
            xfs_growfs "$MP"
        else
            TMP_MNT="/tmp/xfs_resize_$$"
            mkdir -p "$TMP_MNT"
            mount "$PDEV" "$TMP_MNT"
            xfs_growfs "$TMP_MNT"
            umount "$TMP_MNT"
            rmdir "$TMP_MNT" 2>/dev/null || true
        fi
        ;;
    btrfs)
        MP=$(findmnt -n -o TARGET "$PDEV" 2>/dev/null || true)
        if [ -n "$MP" ]; then
            btrfs filesystem resize max "$MP"
        fi
        ;;
esac

partprobe "$DEV" 2>/dev/null || true
"#,
        ensure_parted = ensure_parted_script(),
        dev = dev_path,
        num = part_number,
        end = clean_end,
        pdev = pdev,
        fs = fs,
    );

    let (stdout, code) = run_sudo(&state, &conn_id, &resize_script).await;
    if code != 0 {
        return Err(format!("Failed to resize partition {} on {}: {}", part_number, dev_path, stdout.trim()));
    }

    Ok(format!("Successfully resized partition #{} on '{}' to {}", part_number, dev_path, clean_end))
}

#[tauri::command]
pub async fn disk_set_partition_flag(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    device: String,
    part_number: u32,
    flag: String,
    state_on: bool,
) -> Result<String, String> {
    let clean_dev = device.trim().to_string();
    let dev_path = if clean_dev.starts_with('/') { clean_dev } else { format!("/dev/{}", clean_dev) };
    let state_str = if state_on { "on" } else { "off" };
    let cmd = format!(
        r#"{ensure_parted}
if command -v parted >/dev/null 2>&1; then
    parted -s '{dev}' set {num} {flag} {st}
fi
partprobe '{dev}' 2>/dev/null || true
"#,
        ensure_parted = ensure_parted_script(),
        dev = dev_path,
        num = part_number,
        flag = flag.trim(),
        st = state_str
    );
    let (stdout, code) = run_sudo(&state, &conn_id, &cmd).await;
    if code != 0 {
        return Err(format!("Failed to set flag '{}' on partition {}: {}", flag, part_number, stdout.trim()));
    }
    Ok(format!("Successfully set flag '{}' {} on partition #{}", flag, state_str, part_number))
}

// -------------------------------------------------------------
// Filesystem Format, Label & Check/Repair Operations
// -------------------------------------------------------------

#[tauri::command]
pub async fn disk_format_filesystem(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    device: String,
    fstype: String,
    label: Option<String>,
    quick: bool,
) -> Result<String, String> {
    let clean_dev = device.trim().to_string();
    let dev_path = if clean_dev.starts_with('/') { clean_dev } else { format!("/dev/{}", clean_dev) };
    let clean_fs = fstype.trim().to_lowercase();

    // Safely unmount partition if mounted
    let _ = run_sudo(&state, &conn_id, &format!("swapoff '{}' 2>/dev/null || true; umount -f -l '{}' 2>/dev/null || true", dev_path, dev_path)).await;

    let lbl = label.as_deref().unwrap_or("").trim();
    let format_cmd = match clean_fs.as_str() {
        "ext4" => {
            if !lbl.is_empty() {
                format!("mkfs.ext4 -F -L '{}' '{}'", lbl, dev_path)
            } else {
                format!("mkfs.ext4 -F '{}'", dev_path)
            }
        }
        "ext3" => {
            if !lbl.is_empty() {
                format!("mkfs.ext3 -F -L '{}' '{}'", lbl, dev_path)
            } else {
                format!("mkfs.ext3 -F '{}'", dev_path)
            }
        }
        "xfs" => {
            if !lbl.is_empty() {
                format!("mkfs.xfs -f -L '{}' '{}'", lbl, dev_path)
            } else {
                format!("mkfs.xfs -f '{}'", dev_path)
            }
        }
        "btrfs" => {
            if !lbl.is_empty() {
                format!("mkfs.btrfs -f -L '{}' '{}'", lbl, dev_path)
            } else {
                format!("mkfs.btrfs -f '{}'", dev_path)
            }
        }
        "vfat" | "fat32" => {
            if !lbl.is_empty() {
                format!("mkfs.vfat -F 32 -n '{}' '{}'", lbl, dev_path)
            } else {
                format!("mkfs.vfat -F 32 '{}'", dev_path)
            }
        }
        "ntfs" => {
            let q_flag = if quick { "-Q" } else { "-f" };
            if !lbl.is_empty() {
                format!("mkfs.ntfs {} -L '{}' '{}'", q_flag, lbl, dev_path)
            } else {
                format!("mkfs.ntfs {} '{}'", q_flag, dev_path)
            }
        }
        "swap" => {
            if !lbl.is_empty() {
                format!("mkswap -L '{}' '{}'", lbl, dev_path)
            } else {
                format!("mkswap '{}'", dev_path)
            }
        }
        other => return Err(format!("Unsupported filesystem type '{}'. Supported: ext4, ext3, xfs, btrfs, vfat, ntfs, swap", other)),
    };

    let (stdout, code) = run_sudo(&state, &conn_id, &format!("{} 2>&1", format_cmd)).await;
    if code != 0 {
        return Err(format!("Format to {} failed (exit code {}): {}", clean_fs, code, stdout.trim()));
    }

    Ok(format!("Successfully formatted '{}' as {}", dev_path, clean_fs.to_uppercase()))
}

#[tauri::command]
pub async fn disk_set_label(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    device: String,
    fstype: String,
    label: String,
) -> Result<String, String> {
    let clean_dev = device.trim();
    let clean_fs = fstype.trim().to_lowercase();
    let clean_lbl = label.trim();

    let cmd = if clean_fs.contains("ext") {
        format!("e2label '{}' '{}'", clean_dev, clean_lbl)
    } else if clean_fs == "xfs" {
        format!("xfs_admin -L '{}' '{}'", clean_lbl, clean_dev)
    } else if clean_fs == "vfat" || clean_fs == "fat32" {
        format!("fatlabel '{}' '{}'", clean_dev, clean_lbl)
    } else if clean_fs == "btrfs" {
        format!("btrfs filesystem label '{}' '{}'", clean_dev, clean_lbl)
    } else if clean_fs == "ntfs" {
        format!("ntfslabel '{}' '{}'", clean_dev, clean_lbl)
    } else {
        return Err(format!("Setting label for '{}' filesystem is not supported.", clean_fs));
    };

    let (stdout, code) = run_sudo(&state, &conn_id, &cmd).await;
    if code != 0 {
        return Err(format!("Failed to set label: {}", stdout.trim()));
    }

    Ok(format!("Successfully updated label for '{}' to '{}'", clean_dev, clean_lbl))
}

#[tauri::command]
pub async fn disk_check_filesystem(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    device: String,
    _fstype: Option<String>,
    repair: bool,
) -> Result<String, String> {
    let clean_dev = device.trim();
    let flag = if repair { "-y" } else { "-n" };
    let cmd = format!("fsck {} '{}' 2>&1", flag, clean_dev);
    let (stdout, _) = run_sudo(&state, &conn_id, &cmd).await;
    Ok(stdout)
}

// -------------------------------------------------------------
// Swap Space Management (Increase, Decrease, Enable, Disable)
// -------------------------------------------------------------

#[tauri::command]
pub async fn disk_get_swap_info(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<SwapInfo, String> {
    let script = r#"
        TOTAL_KB=$(grep -i '^SwapTotal:' /proc/meminfo 2>/dev/null | awk '{print $2}')
        FREE_KB=$(grep -i '^SwapFree:' /proc/meminfo 2>/dev/null | awk '{print $2}')
        if [ -z "$TOTAL_KB" ]; then TOTAL_KB=0; fi
        if [ -z "$FREE_KB" ]; then FREE_KB=0; fi
        USED_KB=$((TOTAL_KB - FREE_KB))
        
        TOTAL_B=$((TOTAL_KB * 1024))
        FREE_B=$((FREE_KB * 1024))
        USED_B=$((USED_KB * 1024))
        
        ACTIVE_FILE=$(swapon --show=NAME --noheadings 2>/dev/null | head -n 1 || true)
        if [ -z "$ACTIVE_FILE" ]; then
            ACTIVE_FILE=$(awk 'NR>1 {print $1}' /proc/swaps 2>/dev/null | head -n 1 || true)
        fi
        
        printf "%s|%s|%s|%s\n" "$TOTAL_B" "$USED_B" "$FREE_B" "$ACTIVE_FILE"
    "#;
    let (stdout, _) = run_sudo(&state, &conn_id, script).await;
    let parts: Vec<&str> = stdout.trim().split('|').collect();
    let total_bytes: u64 = parts.get(0).and_then(|s| s.parse().ok()).unwrap_or(0);
    let used_bytes: u64 = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
    let free_bytes: u64 = parts.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
    let active_file = parts.get(3).filter(|s| !s.is_empty()).map(|s| s.to_string());

    Ok(SwapInfo {
        total_bytes,
        used_bytes,
        free_bytes,
        total_formatted: format_bytes(total_bytes),
        used_formatted: format_bytes(used_bytes),
        free_formatted: format_bytes(free_bytes),
        active_file,
        is_enabled: total_bytes > 0,
    })
}

#[tauri::command]
pub async fn disk_manage_swap(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    action: String,          // "set_size", "enable", "disable"
    size_mb: Option<u64>,    // e.g. 2048, 4096, 8192, or 0 to remove
) -> Result<String, String> {
    let act = action.trim().to_lowercase();
    let target_mb = size_mb.unwrap_or(2048);

    let script = match act.as_str() {
        "disable" => r#"
            swapoff -a 2>/dev/null || true
            echo "Swap successfully disabled."
        "#.to_string(),
        "enable" => r#"
            if [ -f /swapfile ]; then
                swapon /swapfile 2>/dev/null || swapon -a
            else
                swapon -a
            fi
            echo "Swap successfully enabled."
        "#.to_string(),
        "set_size" => format!(r#"
set -e
TARGET_MB={target_mb}

# Turn off active swap
swapoff -a 2>/dev/null || true

if [ "$TARGET_MB" -eq 0 ]; then
    rm -f /swapfile
    sed -i '\#/swapfile#d' /etc/fstab 2>/dev/null || true
    echo "Swapfile successfully removed."
    exit 0
fi

# Allocate swapfile
if ! fallocate -l "${{TARGET_MB}}M" /swapfile 2>/dev/null; then
    dd if=/dev/zero of=/swapfile bs=1M count="$TARGET_MB" status=none
fi

chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile

if ! grep -qs '/swapfile' /etc/fstab; then
    printf '\n/swapfile none swap sw 0 0\n' >> /etc/fstab
fi

echo "Successfully configured swap space to ${{TARGET_MB}} MB (/swapfile active)."
"#, target_mb = target_mb),
        _ => return Err(format!("Unknown swap action '{}'. Supported: 'set_size', 'enable', 'disable'", act)),
    };

    let (stdout, code) = run_sudo(&state, &conn_id, &script).await;
    if code != 0 {
        return Err(format!("Swap management failed: {}", stdout.trim()));
    }

    Ok(stdout.trim().to_string())
}

// -------------------------------------------------------------
// Tmp Space Management (Increase, Decrease, Remount & Persist)
// -------------------------------------------------------------

#[tauri::command]
pub async fn disk_get_tmp_info(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<TmpInfo, String> {
    let script = r#"
        MNT_LINE=$(findmnt -n -o TARGET,FSTYPE,SIZE,USED,AVAIL,USE% /tmp 2>/dev/null || true)
        DF_LINE=$(df -B1 -P /tmp 2>/dev/null | tail -n 1 || true)
        
        if [ -n "$DF_LINE" ]; then
            FS=$(echo "$DF_LINE" | awk '{print $1}')
            TOT=$(echo "$DF_LINE" | awk '{print $2}')
            USD=$(echo "$DF_LINE" | awk '{print $3}')
            AVL=$(echo "$DF_LINE" | awk '{print $4}')
            PCT=$(echo "$DF_LINE" | awk '{print $5}' | tr -d '%')
            
            IS_TMPFS="false"
            if echo "$MNT_LINE" | grep -qi "tmpfs" || [ "$FS" = "tmpfs" ]; then
                IS_TMPFS="true"
                FS="tmpfs"
            fi
            printf "%s|%s|%s|%s|%s|%s\n" "$FS" "$TOT" "$USD" "$AVL" "$PCT" "$IS_TMPFS"
        else
            echo "unknown|0|0|0|0|false"
        fi
    "#;
    let (stdout, _) = run_sudo(&state, &conn_id, script).await;
    let parts: Vec<&str> = stdout.trim().split('|').collect();
    let fs = parts.get(0).unwrap_or(&"unknown").to_string();
    let total_bytes: u64 = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
    let used_bytes: u64 = parts.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
    let avail_bytes: u64 = parts.get(3).and_then(|s| s.parse().ok()).unwrap_or(0);
    let percent: f32 = parts.get(4).and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let is_tmpfs = parts.get(5).map(|s| *s == "true").unwrap_or(false);

    Ok(TmpInfo {
        mount_point: "/tmp".to_string(),
        filesystem: fs,
        is_tmpfs,
        total_bytes,
        used_bytes,
        avail_bytes,
        size_formatted: format_bytes(total_bytes),
        used_formatted: format_bytes(used_bytes),
        avail_formatted: format_bytes(avail_bytes),
        percent,
    })
}

#[tauri::command]
pub async fn disk_manage_tmp(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    size: String,        // e.g. "2G", "4G", "1G", "500M"
    persist: bool,
) -> Result<String, String> {
    let clean_size = size.trim().to_uppercase();
    if clean_size.is_empty() {
        return Err("Size cannot be empty (e.g. '2G', '4G').".to_string());
    }

    let script = format!(r#"
set -e
SIZE="{size}"

# Check if /tmp is already mounted as tmpfs
if findmnt -n -o FSTYPE /tmp 2>/dev/null | grep -qi "tmpfs"; then
    mount -o remount,size="$SIZE" /tmp
else
    mount -t tmpfs -o size="$SIZE",mode=1777 tmpfs /tmp
fi

# Persist in /etc/fstab if requested
if [ "{persist}" = "true" ]; then
    if grep -qs '[[:space:]]/tmp[[:space:]]' /etc/fstab; then
        sed -i "s|.*[[:space:]]/tmp[[:space:]].*|tmpfs /tmp tmpfs defaults,noatime,mode=1777,size=$SIZE 0 0|" /etc/fstab
    else
        printf '\ntmpfs /tmp tmpfs defaults,noatime,mode=1777,size=%s 0 0\n' "$SIZE" >> /etc/fstab
    fi
fi

systemctl daemon-reload 2>/dev/null || true
echo "Successfully updated /tmp space to $SIZE (tmpfs active)."
"#, size = clean_size, persist = persist);

    let (stdout, code) = run_sudo(&state, &conn_id, &script).await;
    if code != 0 {
        return Err(format!("Failed to adjust /tmp space: {}", stdout.trim()));
    }

    Ok(stdout.trim().to_string())
}
