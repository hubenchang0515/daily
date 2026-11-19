import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { parseArgs, promisify } from 'node:util';
import { DOCUMENT_CONFIG } from '../src/config';
import { readableUrl } from '../src/utils/seo';

const execFileAsync = promisify(execFile);

const README_FILE = path.join(process.cwd(), 'README.md');
const DOCUMENT_DIR = path.join(process.cwd(), DOCUMENT_CONFIG.root, 'document');
const SECTION_TITLE = '## 文章目录';
const BEGIN_MARK = '<!-- ARTICLES:BEGIN -->';
const END_MARK = '<!-- ARTICLES:END -->';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const USAGE = `用法: npm run index [选项]

按分类在 README.md 末尾生成文章目录。

选项:
  -c, --check    只检查目录是否为最新，不写入文件（过期时以非零码退出）
  -h, --help     显示帮助`;

interface Article {
    title: string;
    url: string;
    date: string;
}

interface Category {
    name: string;
    articles: Article[];
}

// 读取 Git 历史中每个文件的首次提交日期（格式为 YYYY-MM-DD）
async function creationDates(repo: string): Promise<Map<string, string>> {
    const dates = new Map<string, string>();

    try {
        const { stdout } = await execFileAsync(
            'git',
            ['-C', repo, '-c', 'core.quotepath=false', 'log', '--reverse', '--format=%ad', '--date=short', '--name-only'],
            { maxBuffer: 32 * 1024 * 1024 },
        );

        let current = '';
        for (const raw of stdout.split(/\r?\n/)) {
            const line = raw.trim();
            if (!line) {
                continue;
            }
            if (DATE_PATTERN.test(line)) {
                current = line;
                continue;
            }
            if (!current) {
                continue;
            }

            // 仓库根目录可能高于 daily-document，只保留 document 之后的相对路径
            const index = line.indexOf(`${DOCUMENT_CONFIG.root}/document/`);
            const key = index >= 0
                ? line.slice(index + DOCUMENT_CONFIG.root.length + '/document/'.length)
                : line.startsWith('document/') ? line.slice('document/'.length) : '';
            if (key && !dates.has(key)) {
                dates.set(key, current);
            }
        }
    } catch {
        // 没有 Git 历史时退回文件修改时间
    }

    return dates;
}

function titleOf(text: string): string | undefined {
    return /^#\s+(.+)$/m.exec(text)?.[1]?.trim();
}

// 链接地址保留中文，只转义 Markdown 中有特殊含义的字符（encodeURIComponent 不会处理括号）
const URL_ESCAPES: Record<string, string> = {
    '(': '%28',
    ')': '%29',
    '<': '%3C',
    '>': '%3E',
    ' ': '%20',
};

function articleUrl(category: string, file: string): string {
    const pathname = `/${category}/${file}`.replace(/[()<>\s]/g, (ch) => URL_ESCAPES[ch] ?? ch);
    return readableUrl(pathname);
}

function escapeLinkText(text: string): string {
    return text.replace(/([\\[\]]+)/g, '\\$1');
}

function formatDate(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function collect(): Promise<Category[]> {
    const dates = await creationDates(path.join(process.cwd(), DOCUMENT_CONFIG.root));
    const entries = await fs.readdir(DOCUMENT_DIR, { withFileTypes: true });
    const categories: Category[] = [];

    for (const entry of entries.filter((item) => item.isDirectory())) {
        const directory = path.join(DOCUMENT_DIR, entry.name);
        const files = (await fs.readdir(directory, { withFileTypes: true }))
            .filter((file) => !file.isDirectory() && file.name.toLowerCase().endsWith('.md'));

        const articles: Article[] = [];
        for (const file of files) {
            const filePath = path.join(directory, file.name);
            let text = '';
            let modified = new Date();
            try {
                text = await fs.readFile(filePath, 'utf8');
                modified = (await fs.stat(filePath)).mtime;
            } catch {
                // 读取失败时仍按文件名生成条目
            }

            articles.push({
                title: titleOf(text) ?? file.name.replace(/\.md$/i, ''),
                url: articleUrl(entry.name, file.name),
                date: dates.get(`${entry.name}/${file.name}`) ?? formatDate(modified),
            });
        }

        articles.sort((x, y) => y.date.localeCompare(x.date) || x.title.localeCompare(y.title, 'zh'));
        if (articles.length > 0) {
            categories.push({ name: entry.name, articles });
        }
    }

    // 与站点分类列表保持一致：文章多的分类在前
    return categories.sort((x, y) => y.articles.length - x.articles.length || x.name.localeCompare(y.name, 'zh'));
}

function buildSection(categories: Category[]): string {
    const total = categories.reduce((sum, category) => sum + category.articles.length, 0);
    const lines = [`共 ${total} 篇。`];

    for (const category of categories) {
        lines.push('', `### ${category.name}（${category.articles.length}）`, '');
        for (const article of category.articles) {
            lines.push(`- ${article.date} [${escapeLinkText(article.title)}](${article.url})`);
        }
    }

    return lines.join('\n');
}

function merge(readme: string, section: string): string {
    // 只匹配独立成行的标记，避免正文中提到标记名时被误判
    const lines = readme.split('\n');
    const begin = lines.findIndex((line) => line.trim() === BEGIN_MARK);
    const end = begin >= 0
        ? lines.findIndex((line, index) => index > begin && line.trim() === END_MARK)
        : -1;

    if (begin >= 0 && end > begin) {
        return [...lines.slice(0, begin + 1), section, ...lines.slice(end)].join('\n');
    }

    const base = readme.replace(/\s*$/, '');
    return `${base}\n\n${SECTION_TITLE}\n\n${BEGIN_MARK}\n${section}\n${END_MARK}\n`;
}

async function main(): Promise<void> {
    const { values } = parseArgs({
        options: {
            check: { type: 'boolean', short: 'c' },
            help: { type: 'boolean', short: 'h' },
        },
    });

    if (values.help) {
        console.log(USAGE);
        return;
    }

    const readme = await fs.readFile(README_FILE, 'utf8');
    const section = buildSection(await collect());
    const updated = merge(readme, section);

    if (updated === readme) {
        console.log('README 文章目录已是最新');
        return;
    }

    if (values.check) {
        console.error('README 文章目录不是最新，请运行 npm run index');
        process.exitCode = 1;
        return;
    }

    await fs.writeFile(README_FILE, updated, 'utf8');
    console.log('README 文章目录已更新');
}

main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
});
