> Original link: [Reclaiming Disk Space from Open-but-Deleted Files - Code Daily · Daily Articles](https://daily.xplanc.org/en/linux/Reclaiming-Disk-Space-from-Open-but-Deleted-Files.md)

---

# Reclaiming Disk Space from Open-but-Deleted Files

A Linux file can disappear from every directory listing and still occupy disk space. This happens when a process already has the file open: `rm` removes the directory entry, but the inode remains until the last file descriptor is closed. The result is a classic incident where `df` reports a full filesystem while `du` cannot find the files consuming it. Knowing how to identify and release those hidden blocks is a useful operational skill.

## Why `df` and `du` disagree

`df` asks the filesystem how many blocks are allocated. `du` walks directory entries and sums the sizes of files it can see. If a file has been unlinked but is still open, `du` cannot find it, while `df` still counts its blocks.

```bash
df -h /var
du -xhd1 /var | sort -h | tail
```

The `-x` flag keeps `du` on one filesystem, which avoids confusing results from nested mounts. If `df` shows 90% usage but `du` accounts for much less, open-but-deleted files are a likely cause.

## Find the process holding the file

The quickest check is `lsof` with a link count filter. A file with fewer than one hard link has been removed from the namespace:

```bash
sudo lsof +L1
```

A typical result looks like this:

```text
COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NLINK  NODE NAME
java     1842 app    7w   REG  253,1 524288000     0 393221 /var/log/app/app.log (deleted)
```

The important fields are `PID`, `FD`, `SIZE/OFF`, and `NAME`. Here, process 1842 is still holding a 500 MB deleted log through file descriptor 7.

Broaden the output with `-nP` to skip DNS and port-name lookups:

```bash
sudo lsof +L1 -nP
```

If `lsof` is unavailable, the same information can be assembled from `/proc`:

```bash
for fd in /proc/[0-9]*/fd/*; do
    target=$(readlink "$fd" 2>/dev/null) || continue
    case "$target" in
        *" (deleted)"*)
            pid=${fd#/proc/}
            pid=${pid%%/*}
            cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)
            printf '%s\t%s\t%s\n' "$pid" "$cmd" "$target"
            ;;
    esac
done | sort -u
```

Run that as root to inspect every process. The output is tab-separated: PID, command line, and deleted target.

## Release the space

There are three common ways to close the last reference. Choose the least disruptive one that fits the service.

| Method | Command pattern | Best for | Risk |
| --- | --- | --- | --- |
| Reload or restart | `sudo systemctl restart SERVICE` | Services that can safely reopen files | Brief interruption |
| Send a reopen signal | `sudo kill -USR1 PID` | Log-heavy daemons such as nginx | Must be supported by the app |
| Truncate via `/proc` | `sudo truncate -s 0 /proc/PID/fd/FD` | Immediate recovery without a restart | Existing content is discarded |

For example, nginx reopens its logs when the master process receives `USR1`:

```bash
pid=$(cat /run/nginx.pid)
sudo kill -USR1 "$pid"
sudo lsof +L1 | grep nginx
```

For a generic systemd service, a restart is simpler:

```bash
sudo systemctl status rsyslog
sudo systemctl restart rsyslog
df -h /var
```

When a restart is undesirable and the file is only a log, truncate it through the open descriptor:

```bash
pid=1842
fd=7
sudo truncate -s 0 "/proc/$pid/fd/$fd"
df -h /var
```

The process keeps writing to the same inode, but the inode now has zero length, so the allocated blocks are returned immediately. This is often the fastest emergency fix.

Avoid this trick for files used for random access, databases, or memory-mapped data. Truncating such a file under a running process can corrupt state or cause `SIGBUS` when mapped regions are accessed. Restart the owning service in those cases.

As a last resort, killing the process also closes its descriptors, but prefer a graceful signal or service restart first:

```bash
sudo systemctl kill -s TERM myapp.service
```

## Reproduce it locally

The following demo creates a 200 MB file, holds it open with `tail -f`, deletes the directory entry, and then frees the space through `/proc`:

```bash
truncate -s 200M "$HOME/demo.log"
tail -f "$HOME/demo.log" >/dev/null &
holder=$!

df -h "$HOME" | tail -1
rm "$HOME/demo.log"

lsof -p "$holder" | grep 'demo.log'
fd=$(lsof -p "$holder" -Fn | awk '
    /^f/ { f=substr($0,2) }
    /^n.*demo\.log.*\(deleted\)/ { print f; exit }
')

if [ -n "$fd" ]; then
    truncate -s 0 "/proc/$holder/fd/$fd"
fi

df -h "$HOME" | tail -1
kill "$holder"
```

The second `df` should show the space returned. The `tail` process continues running until killed, but its old log inode is empty.

## Prevent the next occurrence

Most cases come from log rotation that renames or deletes a file without telling the application to reopen it. A rotation rule should either recreate the file and signal the daemon, or use `copytruncate` as a fallback.

A signal-based rotation rule looks like this:

```text
/var/log/myapp/*.log {
    daily
    rotate 14
    compress
    missingok
    notifempty
    create 0640 myapp adm
    sharedscripts
    postrotate
        systemctl kill -s HUP myapp.service >/dev/null 2>&1 || true
    endscript
}
```

`copytruncate` copies the contents and then truncates the original path, so an application that never reopens its logs keeps writing to the same inode:

```text
/var/log/myapp/app.log {
    daily
    rotate 7
    copytruncate
    missingok
    notifempty
}
```

Use `copytruncate` only when the application cannot be signaled. It has a small window where writes can be lost between the copy and the truncate.

Useful habits include:

- Alert when filesystem usage crosses a threshold, not only when it reaches 100%.
- Run `sudo lsof +L1` during incidents before restarting services blindly.
- Check rotation configs after deployments that change log paths or service names.
- Prefer application-native log reopening over `copytruncate`.
- Verify reclamation with `df` after taking action, not just by restarting.

## Quick checklist

1. Compare `df -h` with `du -xhd1` on the affected mount.
2. Run `sudo lsof +L1` to find deleted files that are still open.
3. Prefer a service reload, reopen signal, or graceful restart.
4. If the file is disposable, truncate it via `/proc/PID/fd/FD`.
5. Confirm with `df -h`, then fix the rotation or shutdown path that caused it.

## Related Articles

- [Running One-Off Tasks Safely with systemd-run](https://daily.xplanc.org/en/linux/Running-One-Off-Tasks-Safely-with-systemd-run.md)

> This article was generated with AI assistance and reviewed by a human. Corrections are welcome.
