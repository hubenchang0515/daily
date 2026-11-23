> Original link: [Running One-Off Tasks Safely with systemd-run - Code Daily · Daily Articles](https://daily.xplanc.org/en/linux/Running-One-Off-Tasks-Safely-with-systemd-run.md)

---

# Running One-Off Tasks Safely with systemd-run

Every Linux user has started a long-running command over SSH, only to lose it when the connection drops. The usual fixes—`nohup`, `screen`, or a trailing `&`—work in a pinch, but they leave you with limited visibility, no resource controls, and manual cleanup. On modern Linux systems, `systemd-run` offers a cleaner alternative: it creates transient units for commands you need to run once, giving you journald logging, status tracking, timers, and cgroup limits without writing a permanent unit file.

## Why Use Transient Units

Transient units are regular systemd units that exist only in memory. You get the same supervision model as services you define in `/etc/systemd/system`, but without creating files that linger after the job is done.

| Approach | Survives logout | Centralized logs | Resource limits | Scheduling | Cleanup |
|---|---|---|---|---|---|
| `command &` | No | Terminal only | No | No | Manual |
| `nohup command &` | Yes | `nohup.out` | No | No | Manual |
| `at` / `cron` | Yes | Varies by setup | Limited | Yes | Edit config |
| `systemd-run` | Yes | journald | Yes (cgroups) | Yes (transient timers) | Automatic with `--collect` |

`systemd-run` is especially useful for maintenance tasks, ad-hoc backups, data imports, and any command you want to observe or constrain.

## Check Your Environment

Most mainstream distributions ship with systemd. Confirm it is available and note the version:

```bash
systemctl --version
systemd --version
```

You need root privileges for system-level units. For personal tasks, `--user` runs the unit in your user session and does not require `sudo`.

```bash
# Run a quick command in the user manager
systemd-run --user --wait --collect --pipe \
  /bin/bash -c 'echo "Running as $(whoami) on $(hostname)"'
```

If the user manager is not running in a non-interactive SSH session, enable lingering:

```bash
sudo loginctl enable-linger "$USER"
```

## Run a Command as a Transient Service

The simplest form creates a background service and returns immediately:

```bash
sudo systemd-run --unit=quick-backup \
  --description="One-off home directory backup" \
  --remain-after-exit \
  /usr/bin/tar czf /var/backups/home.tar.gz /home
```

Key options in this example:

- `--unit=quick-backup` gives the unit a predictable name instead of a generated one.
- `--description=...` adds human-readable context to `systemctl status`.
- `--remain-after-exit` keeps the service in an `active (exited)` state after the command finishes, making it easy to inspect.

Inspect the result with standard systemd tools:

```bash
systemctl status quick-backup.service
journalctl -u quick-backup.service -n 50 --no-pager
```

When you no longer need the unit, stop it and clear any failed state:

```bash
sudo systemctl stop quick-backup.service
sudo systemctl reset-failed quick-backup.service
```

## Wait for Completion and Capture Output

For scripts or interactive administration, you often want the command to behave like a normal foreground process while still getting systemd supervision. Use `--wait`, `--collect`, and `--pipe` together:

```bash
sudo systemd-run --wait --collect --pipe \
  --unit=check-disk \
  /usr/bin/df -h /
```

- `--wait` blocks until the service exits and returns its exit code.
- `--collect` unloads the unit automatically after it finishes, even if it failed.
- `--pipe` connects the service's standard input, output, and error to your terminal.

This pattern is ideal for wrapping a command in resource limits without changing how you invoke it:

```bash
sudo systemd-run --wait --collect --pipe \
  -p WorkingDirectory=/srv/app \
  -p Environment="APP_ENV=production" \
  /usr/local/bin/run-import.sh
```

If you need a pseudo-terminal for programs that expect one, replace `--pipe` with `--pty`.

## Schedule One-Off Jobs with Transient Timers

`systemd-run` can also create transient timers. This is useful when you want a job to run later without editing crontab or creating timer files.

### Run After a Delay

```bash
sudo systemd-run --on-active=30min \
  --unit=cleanup-downloads \
  /usr/bin/find /home/alice/Downloads -type f -mtime +30 -delete
```

The command runs 30 minutes after the timer is created. You can use time spans like `90s`, `2h`, or `1d`.

### Run at a Specific Time

```bash
sudo systemd-run --on-calendar="2026-11-24 03:00:00" \
  --unit=nightly-report \
  /usr/local/bin/generate-report.sh
```

For recurring calendar expressions, systemd's calendar syntax applies. For example, `*-*-* 03:00:00` means every day at 03:00.

Inspect scheduled transient timers:

```bash
systemctl list-timers --all --no-pager
systemctl status nightly-report.timer
journalctl -u nightly-report.service --no-pager
```

The timer unit triggers a service unit with the same base name. When debugging, check both the `.timer` and `.service` units.

## Apply Resource Limits and Sandboxing

One of the strongest reasons to use `systemd-run` is access to systemd's resource and sandboxing properties. These map to cgroup settings and kernel namespaces.

### Resource Limits

```bash
sudo systemd-run --wait --collect --pipe \
  -p MemoryMax=512M \
  -p CPUQuota=80% \
  -p IOWeight=50 \
  /usr/local/bin/heavy-job.sh
```

| Property | Effect | Example |
|---|---|---|
| `MemoryMax=` | Hard memory ceiling | `MemoryMax=512M` |
| `CPUQuota=` | CPU time limit relative to one core | `CPUQuota=80%` |
| `IOWeight=` | Relative I/O priority | `IOWeight=50` |
| `TasksMax=` | Maximum number of tasks/processes | `TasksMax=100` |

If a process exceeds `MemoryMax`, the kernel's OOM killer may terminate it inside the unit's cgroup. Check the journal for OOM messages when a job disappears unexpectedly.

### Basic Sandboxing

For tasks that do not need full system access, add protective properties:

```bash
sudo systemd-run --wait --collect --pipe \
  -p PrivateTmp=yes \
  -p ProtectSystem=strict \
  -p ProtectHome=read-only \
  -p NoNewPrivileges=yes \
  -p ReadWritePaths=/var/lib/myapp \
  /usr/local/bin/untrusted-task.sh
```

These settings reduce blast radius:

- `PrivateTmp=yes` gives the process its own `/tmp`.
- `ProtectSystem=strict` makes most of the filesystem read-only.
- `ProtectHome=read-only` prevents writes to user home directories.
- `NoNewPrivileges=yes` blocks privilege escalation through setuid binaries.
- `ReadWritePaths=` reopens specific paths for writes.

Test sandboxed commands carefully. Overly restrictive settings can cause legitimate failures, such as inability to write logs or temporary files.

## Troubleshooting Common Issues

When a transient unit does not behave as expected, start with these checks:

```bash
# Show recent logs for the unit
journalctl -u quick-backup.service -e --no-pager

# Inspect the generated unit properties
systemctl show quick-backup.service

# List failed units
systemctl --failed --no-pager
```

Common problems include:

- **Unit name already exists:** transient unit names must be unique while loaded. Pick a new name or stop the old unit.
- **Command not found:** use absolute paths inside `systemd-run`, because the execution environment may differ from your shell.
- **Permission errors:** system units run as root by default; add `-p User=alice -p Group=alice` when the job should run as a non-root account.
- **Timer never fires:** verify the system clock, timezone, and the timer status with `systemctl list-timers --all`.

## Quick Reference

| Goal | Command pattern |
|---|---|
| Run in background | `sudo systemd-run --unit=name /path/to/cmd` |
| Run and wait | `sudo systemd-run --wait --collect --pipe /path/to/cmd` |
| Run as current user | `systemd-run --user --wait --collect --pipe /path/to/cmd` |
| Run after delay | `sudo systemd-run --on-active=30min /path/to/cmd` |
| Run at specific time | `sudo systemd-run --on-calendar="..." /path/to/cmd` |
| Limit memory | `sudo systemd-run -p MemoryMax=512M /path/to/cmd` |

`systemd-run` does not replace full unit files for long-lived services, but for one-off jobs it hits a sweet spot: you get the observability and control of systemd with the immediacy of a shell command. The next time you reach for `nohup`, consider making the job a transient unit instead—you will have logs, limits, and a clear lifecycle from the start.

> This article was generated with AI assistance and reviewed by a human. Corrections are welcome.
