> Original link: [Finding Memory Leaks in Python with tracemalloc - Code Daily · Daily Articles](https://daily.xplanc.org/en/python/Finding-Memory-Leaks-in-Python-with-tracemalloc.md)

---

# Finding Memory Leaks in Python with tracemalloc

A process that grows from 200 MB to 2 GB over a weekend is rarely a mystery you can solve by staring at code. You need to know which line allocated the memory that is still alive. Python ships with a tool for exactly that: `tracemalloc`.

It is not a profiler for speed, and it is not a replacement for heap analyzers. It answers one narrow, useful question: *which Python allocation sites are responsible for the memory currently held?*

## Why process RSS misleads you

Operating-system memory includes the interpreter, shared libraries, allocator fragmentation, and memory that Python has freed but not returned to the OS. Watching RSS can tell you that something is wrong; it cannot tell you where.

| Signal | Answers | Blind spot |
| --- | --- | --- |
| RSS / `ps` | Is the process growing? | Cannot attribute growth to code |
| `tracemalloc` | Which Python lines hold memory? | Misses most C-extension allocations |
| `gc` module | Are objects uncollectable or referenced? | No byte-level attribution |
| `objgraph` | Who references this object? | Requires a suspect object first |

Start with `tracemalloc`, then confirm with `gc.get_referrers()`.

## Capturing a useful snapshot

The traceback depth matters. `tracemalloc.start(1)` records only the allocating frame; `start(25)` records enough context to see the caller chain. Keep the number stable across snapshots, because `compare_to()` rejects snapshots with different traceback depths.

```python
import tracemalloc

tracemalloc.start(25)

# ... application work ...

snapshot = tracemalloc.take_snapshot()
for stat in snapshot.statistics("lineno")[:10]:
    print(stat)
```

A single snapshot shows the largest live allocations, but it cannot distinguish a legitimate cache from a leak. The useful measurement is a **diff** between two snapshots taken around repeated work.

## Reproducing a leak in a loop

Here is a deliberately leaky service. Each request appends a payload to a module-level list that is never trimmed.

```python
import tracemalloc

AUDIT_LOG = []

def handle_request(request_id: int, payload: bytes) -> None:
    AUDIT_LOG.append({"id": request_id, "body": payload})

def run_batch(n: int) -> None:
    for i in range(n):
        handle_request(i, b"x" * 4096)
```

Measure it with a baseline taken *after* warm-up, so imports and lazy initialization do not pollute the result:

```python
import tracemalloc
from leaks import run_batch

tracemalloc.start(25)

run_batch(100)                      # warm-up: populate caches, import lazily
baseline = tracemalloc.take_snapshot()

run_batch(5_000)                    # suspected leak path
after = tracemalloc.take_snapshot()

for stat in after.compare_to(baseline, "lineno")[:8]:
    print(stat)
    print("  ", stat.traceback.format()[-2:])
```

Typical output points at the append site:

```text
leaks.py:6: size=20.5 MiB (+20.5 MiB), count=5000 (+5000), average=4096 B
   ['  File "leaks.py", line 6', '    AUDIT_LOG.append(...)']
```

Read the columns carefully:

- **size** is retained bytes at that allocation site.
- **count** is the number of live blocks.
- **+/-** is the change relative to the baseline.
- **average** helps distinguish many small objects from a few large ones.

A positive diff is not automatically a bug; a cache that grows to a bounded size is fine. A diff that scales linearly with the number of requests usually is not.

## Removing noise with filters

Most reports are dominated by the standard library and third-party imports. Exclude them so your own frames surface:

```python
import tracemalloc

filters = [
    tracemalloc.Filter(False, tracemalloc.__file__),
    tracemalloc.Filter(False, "<frozen importlib._bootstrap>"),
    tracemalloc.Filter(False, "/usr/lib/python3.12/site-packages/*"),
]

snapshot = tracemalloc.take_snapshot().filter_traces(filters)
```

You can also go the other way and keep only one package:

```python
filters = [tracemalloc.Filter(True, "*/myproject/*")]
```

Filters apply to filenames. Use absolute patterns generously; a filter that matches nothing silently gives you a clean-looking but useless report.

## A repeatable harness

Wrap the pattern so every investigation uses the same warm-up and depth:

```python
import tracemalloc
from collections.abc import Callable

def growth(fn: Callable[[], None], repeats: int = 1_000) -> list:
    tracemalloc.start(20)
    try:
        fn()                         # warm-up
        before = tracemalloc.take_snapshot()
        for _ in range(repeats):
            fn()
        after = tracemalloc.take_snapshot()
    finally:
        tracemalloc.stop()
    return after.compare_to(before, "lineno")
```

Call `tracemalloc.stop()` in a `finally` block. Leaving tracing enabled changes allocation behavior and can slow a hot path by several times, which distorts timing tests run later.

You can also enable tracing without touching code:

```bash
PYTHONTRACEMALLOC=20 python -m myapp
```

Then at any point, dump the current state from a signal handler or an admin endpoint using `tracemalloc.take_snapshot()`.

## From allocation to reference

`tracemalloc` tells you where memory was allocated, not why it is still reachable. Once you have a suspect, use `gc` to find the holders:

```python
import gc
import tracemalloc

tracemalloc.start(20)
run_batch(5_000)

snapshot = tracemalloc.take_snapshot()
top = snapshot.statistics("traceback")[0]
print(top.traceback.format())

# Find the actual objects allocated near the suspect line.
for obj in gc.get_objects():
    if isinstance(obj, dict) and obj.get("id") == 4999:
        print(gc.get_referrers(obj)[:3])
```

If the referrer list contains a module-level list or a singleton, the "leak" is retention by design. If it contains a frame or a closure, an object graph is keeping a callback alive.

## What tracemalloc will not catch

- **C extensions**: NumPy, Pillow, and database drivers often allocate outside Python's allocator, so their buffers may be invisible or only partially attributed.
- **Allocator fragmentation**: freed memory retained by the process but no longer traced.
- **Leaks in subprocesses**: each process needs its own tracing.
- **Reference cycles awaiting collection**: run `gc.collect()` before taking the final snapshot if you want to exclude collectable garbage.

For those cases, pair `tracemalloc` with `memray` or a native heap profiler.

## A short checklist

1. Reproduce the growth with a loop, not a single request.
2. Start tracing at a fixed depth and keep it fixed.
3. Take the baseline after warm-up.
4. Compare snapshots with `"lineno"` for sites and `"traceback"` for call paths.
5. Filter out the standard library and site-packages.
6. Confirm reachability with `gc.get_referrers()` before calling it a leak.
7. Add a regression test that asserts bounded growth over N iterations.

The last point matters most. A leak fixed without a test tends to return, and `tracemalloc` makes the assertion cheap: run the workload, compare snapshots, and fail if retained bytes exceed a threshold.

> This article was generated with AI assistance and reviewed by a human. Corrections are welcome.
