import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { DOCUMENT_CONFIG } from '../src/config';

const DEFAULT_MODEL = 'opencode/beam-free';

const USAGE = `用法: npm run gen -- <分类> [主题] [选项]

示例:
  npm run gen -- linux
  npm run gen -- linux "lsof 命令详解"
  npm run gen -- linux "Git 常用技巧" --slug git-tips

省略主题时由 AI 自拟，并避开已有文章。

选项:
  -s, --slug <名称>   指定文件名（默认取文章标题）
  -m, --model <模型>  指定 opencode 模型，默认 Beam Free (opencode/beam-free)
  -f, --force         覆盖同名文件
      --dry-run       只输出内容，不写入文件
  -h, --help          显示帮助

仅在 --dry-run 时显示模型的思考过程。`;

interface OpenCodeEvent {
    type?: string;
    part?: {
        type?: string;
        text?: string;
    };
    error?: {
        data?: {
            message?: string;
        };
    };
}

interface RunResult {
    text: string;
    preview: string;
}

function buildPrompt(category: string, topic: string | undefined, existing: string[]): string {
    const instruction = topic
        ? `请以“${topic}”为主题`
        : '请自行拟定一个适合发布在个人博客上的新主题，且不要与已有文章重复';
    const existingSection = existing.length
        ? `\n\n已有文章：\n${existing.map((item) => `- ${item}`).join('\n')}`
        : '';

    return `你是一位擅长技术写作的中文作者。${instruction}，写一篇适合发布在个人博客上的文章，文章分类为“${category}”。${existingSection}

要求：
1. 直接输出 Markdown 正文，第一行使用一级标题，不要用代码块包裹整篇文章。
2. 结构清晰，篇幅约 1500～2500 字，根据需要合理使用小标题、列表、表格和代码块。
3. 内容准确、具体、可操作；涉及命令或代码时给出可运行的示例。
4. 不要使用任何工具，不要读写文件，不要询问问题。
5. 只输出文章内容，不要添加解释、说明或结束语。
6. 使用中文撰写文章，标题不要太长尽量在一行以内`;
}

function runOpenCode(args: string[], showReasoning: boolean): Promise<RunResult> {
    return new Promise((resolve, reject) => {
        const child = spawn('opencode', args, {
            cwd: process.cwd(),
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        const texts: string[] = [];
        let buffer = '';
        let stderr = '';
        let streamError = '';
        let preview = '';
        let reasoningShown = false;
        let settled = false;

        const finish = (error?: Error) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            if (error) {
                reject(error);
            } else {
                resolve({ text: texts.join(''), preview });
            }
        };

        const handleLine = (line: string) => {
            const trimmed = line.trim();
            if (!trimmed) {
                return;
            }

            let event: OpenCodeEvent;
            try {
                event = JSON.parse(trimmed) as OpenCodeEvent;
            } catch {
                return;
            }

            if (event.type === 'reasoning' && event.part?.type === 'reasoning' && typeof event.part.text === 'string') {
                if (showReasoning) {
                    if (!reasoningShown) {
                        process.stderr.write('\n思考过程：\n');
                        reasoningShown = true;
                    }
                    process.stderr.write(event.part.text.endsWith('\n') ? event.part.text : `${event.part.text}\n`);
                }
            } else if (event.type === 'text' && event.part?.type === 'text' && typeof event.part.text === 'string') {
                texts.push(event.part.text);
            } else if (event.type === 'error') {
                streamError = event.error?.data?.message ?? 'opencode 返回错误';
            }
        };

        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            finish(new Error('opencode 执行超时（15 分钟）'));
        }, 15 * 60 * 1000);

        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
            preview = (preview + chunk).slice(0, 500);
            buffer += chunk;
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                handleLine(line);
            }
        });

        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => {
            stderr += chunk;
        });

        child.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'ENOENT') {
                finish(new Error('找不到 opencode 命令，请先安装并确保它在 PATH 中'));
            } else {
                finish(err);
            }
        });

        child.on('close', (code) => {
            handleLine(buffer);
            if (reasoningShown) {
                process.stderr.write('\n');
            }
            if (code === 0 && !streamError) {
                finish();
            } else {
                finish(new Error(`opencode 执行失败: ${streamError || stderr.trim() || `退出码 ${code}`}`));
            }
        });
    });
}

function unwrapFence(content: string): string {
    const match = content.trim().match(/^```(?:markdown|md)?\s*\r?\n([\s\S]*)\r?\n```$/i);
    return (match ? match[1] : content).trim();
}

function titleOf(content: string): string | undefined {
    const line = content.split(/\r?\n/).find((item) => /^#\s+\S/.test(item));
    return line?.replace(/^#\s+/, '').trim();
}

async function existingArticles(): Promise<string[]> {
    const root = path.join(process.cwd(), DOCUMENT_CONFIG.root, 'document');
    let categories;
    try {
        categories = await fs.readdir(root, { withFileTypes: true });
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw err;
    }

    const articles: string[] = [];
    for (const category of categories.filter((item) => item.isDirectory())) {
        const directory = path.join(root, category.name);
        const files = await fs.readdir(directory, { withFileTypes: true });
        for (const file of files.filter((item) => !item.isDirectory() && item.name.endsWith('.md'))) {
            const filePath = path.join(directory, file.name);
            let title: string | undefined;
            try {
                title = titleOf(await fs.readFile(filePath, 'utf8'));
            } catch {
                title = undefined;
            }
            articles.push(`${category.name}/${(title || file.name.replace(/\.md$/i, '')).slice(0, 100)}`);
        }
    }

    return articles.sort();
}

function normalizeSlug(value: string): string {
    const base = path.basename(value.trim());
    const name = base.toLowerCase().endsWith('.md') ? base.slice(0, -3) : base;
    return name.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^[.-]+|[.-]+$/g, '');
}

function validCategory(category: string): boolean {
    return category !== '.' && category !== '..' && !/[\\/]/.test(category) && path.basename(category) === category;
}

async function exists(file: string): Promise<boolean> {
    try {
        await fs.access(file);
        return true;
    } catch {
        return false;
    }
}

async function main(): Promise<void> {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            slug: { type: 'string', short: 's' },
            model: { type: 'string', short: 'm' },
            force: { type: 'boolean', short: 'f' },
            'dry-run': { type: 'boolean' },
            help: { type: 'boolean', short: 'h' },
        },
    });

    if (values.help) {
        console.log(USAGE);
        return;
    }

    const [category, ...topicParts] = positionals;
    const topic = topicParts.join(' ').trim();

    if (!category || !validCategory(category)) {
        console.error(USAGE);
        process.exitCode = 1;
        return;
    }

    const existing = await existingArticles();
    const dryRun = Boolean(values['dry-run']);
    const args = ['run', '--format', 'json'];
    if (dryRun) {
        args.push('--thinking');
    }
    args.push('--model', values.model ?? DEFAULT_MODEL);
    args.push(buildPrompt(category, topic || undefined, existing));

    console.error('正在调用 opencode 生成文章...');

    const result = await runOpenCode(args, dryRun);
    if (!result.text.trim()) {
        throw new Error(`opencode 没有返回文章内容: ${result.preview.trim()}`);
    }

    const content = unwrapFence(result.text);
    const slug = normalizeSlug(values.slug ?? titleOf(content) ?? topic);
    if (!slug) {
        throw new Error('无法生成文件名，请使用 --slug 指定');
    }

    const directory = path.join(process.cwd(), DOCUMENT_CONFIG.root, 'document', category);
    const file = path.join(directory, `${slug}.md`);
    const relative = path.relative(process.cwd(), file);

    if (dryRun) {
        console.log(content);
        console.error(`[dry-run] 未写入文件: ${relative}`);
        return;
    }

    if (!values.force && await exists(file)) {
        throw new Error(`文件已存在: ${relative}（使用 --force 覆盖）`);
    }

    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(file, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
    console.log(`文章已生成: ${relative} (${content.length} 字符)`);
}

main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
});
