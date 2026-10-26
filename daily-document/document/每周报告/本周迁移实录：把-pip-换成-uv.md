# 本周迁移实录：把 pip 换成 uv

这周的主要工作只有一件：把一个运行了两年多的 Python 服务从 `pip + venv + requirements.txt` 迁移到 uv。动机很实际：CI 里安装依赖要三分半，`requirements.txt` 又没锁版本，同一个 commit 两次构建偶尔会装出不同的包。周五收工时，冷启动降到 40 秒以内，还顺带改掉了 Dockerfile 和 GitHub Actions。这篇周报记录过程、遇到的问题和最终数据。

## 起点：先量一遍基线

动手前先测量，否则一周后说不清到底快了多少。我在本机和 CI 上各跑三次，取中位数：

```bash
python -m venv .venv
. .venv/bin/activate
time pip install -r requirements.txt
```

本机冷缓存 3 分 18 秒，CI（无缓存）3 分 41 秒，有 pip 缓存时 41 秒。依赖一共 47 个直接包、约 120 个传递依赖。还有一项不容易察觉的成本在评审阶段：`requirements.txt` 里只有版本号，看不出是哪个包引入的，升级时只能逐个试。

## 迁移：四条命令起步

在项目根目录执行：

```bash
uv init --bare --python 3.12
uv add -r requirements.txt
uv add --dev pytest ruff mypy
uv sync
```

`--bare` 只生成 `pyproject.toml`，不会改动已有的 README 和源码目录；`uv add -r` 把旧的 requirements 读进来，重写进 `dependencies`；`uv add --dev` 写进 PEP 735 的 `[dependency-groups]`。生成的 `uv.lock` 要提交进仓库，它是跨平台的完整解析结果，也是“可复现”三个字的全部依据。

整理后的配置文件大致如下：

```toml
[project]
name = "weekly-report"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.32",
  "pydantic-settings>=2.6",
]

[dependency-groups]
dev = ["pytest>=8.3", "ruff>=0.8", "mypy>=1.13"]

[tool.uv]
package = false
```

生产环境安装时用 `uv sync --no-dev`，dev 组不会进镜像。老工具链暂时不认 `pyproject.toml` 的话，用 `uv export --format requirements-txt --no-hashes -o requirements.txt` 导出一份做过渡，别两边同时手工维护。

## 私有源：花时间最多的一小时

公司内部包走自建源，配置加在 `pyproject.toml` 里：

```toml
[[tool.uv.index]]
name = "internal"
url = "https://pypi.internal.example.com/simple"
```

凭据不要写进文件，用环境变量传入，变量名里的 index 名要大写、连字符换成下划线：

```bash
export UV_INDEX_INTERNAL_USERNAME="$ARTIFACTORY_USER"
export UV_INDEX_INTERNAL_PASSWORD="$ARTIFACTORY_TOKEN"
```

如果内部源只是补充、不替代 PyPI，加上 `explicit = true`，再在 `[tool.uv.sources]` 里为具体包指定来源；如果它是完整镜像，则用 `default = true`。这一条我一开始写反了，结果所有包都去内部源找，报了一屏 404。

## 遇到的问题记录

1. **`--locked` 和 `--frozen` 不是一回事。** 前者校验 lock 文件与 `pyproject.toml` 是否一致，不一致直接失败；后者跳过校验，按现有 lock 安装。CI 用 `--locked` 才能挡住“改了依赖却忘了提交 lock”的情况，离线构建用 `--frozen`。
2. **非包项目要显式声明 `package = false`。** 否则 uv 会尝试构建并安装项目自身，没有 `[build-system]` 时直接报错。项目确实是库的话就保留默认行为，并补上构建后端。
3. **IDE 解释器要重新指向。** 旧 venv 建议整个删掉，重新选 `.venv/bin/python`（Windows 上是 `.venv\Scripts\python.exe`），两个环境混用会出现“命令行能跑、IDE 找不到模块”的怪事。
4. **锁文件没提交，CI 缓存等于不存在。** uv 的缓存键基于 `uv.lock` 的哈希，lock 天天变或者根本没进仓库，缓存命中率就是零。
5. **`uv run` 默认先 sync。** 本地很省事，CI 里我改成显式 `uv sync --locked` 再 `uv run --no-sync pytest`，把“安装”和“执行”两步分开，日志也更好读。

缓存本身也能查看大小，构建镜像前顺手清一下：

```bash
uv cache dir
uv cache prune
```

## CI 改造

GitHub Actions 里换掉 setup-python 和 pip 两步，其余不动：

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v6
        with:
          enable-cache: true
      - run: uv sync --locked
      - run: uv run --no-sync pytest -q
```

`setup-uv` 的缓存默认按 lock 文件哈希恢复，第一次跑仍然全量下载，从第二次开始才有收益。所以验收要看连续两次构建，而不是只看第一次的数字。

## 结果

| 指标 | 迁移前 | 迁移后 |
| --- | --- | --- |
| CI 冷启动安装 | 3m41s | 38s |
| CI 命中缓存 | 41s | 6s |
| 版本可复现 | 否 | 是（`uv.lock`） |
| 新增依赖的评审 | 改 requirements.txt | 一行 pyproject 加 lock diff |
| Python 版本管理 | 依赖 runner 预装 | `uv python pin 3.12` |

总迁移成本约 3 小时，其中 1 小时耗在私有源，40 分钟在 CI，剩下的时间是把旧的 `requirements.txt` 和文档里的安装说明一起清理干净。收益主要不在那三分钟，而在于 lock 文件让“这个 bug 在本地复现不了”少了一个常见解释。

## 下周计划

- 把 monorepo 里另外两个子包并进 `[tool.uv.workspace]`，先在一个不常改的包上试，避免一次性动全部。
- Dockerfile 的 builder 阶段换成 `ghcr.io/astral-sh/uv` 镜像，用 BuildKit 的 cache mount 挂载 uv 缓存目录。
- 定一个每周固定时间跑 `uv lock --upgrade`，小步升级并看测试结果，别让依赖攒到季度末一起爆。
- 观察一周 lock 文件的冲突频率，如果两个人同时加依赖经常打架，就在文档里补一条“先 rebase 再 `uv lock`”的约定。

一周下来最大的感受是：工具替换本身只占两成时间，剩下八成都在处理历史遗留的隐式约定，比如谁在脚本里写死了 `pip install`、哪个镜像依赖系统 Python。迁移清单比迁移命令更值得写下来。
