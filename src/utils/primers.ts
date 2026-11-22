import fs from 'fs';
import path from 'path';
import { DEFAULT_LANGUAGE, LANGUAGE_CONFIG, LINKS, Language } from '@/config';
import { decodeUrl } from './markdown';

export interface SitemapNode {
    links: Record<string, string>;
}

interface Pattern {
    lang: string[];
    regexps: RegExp[];
}

// 匹配列表
const PATTERNS_ZH: Pattern[] = [
    {
        lang: ["html"],
        regexps: [
            /https:\/\/primers\.xplanc\.org\/document\/zh\/03\.HTML\/EX\.HTML%20%E5%85%83%E7%B4%A0\/EX\.(.+?)\.md/g
        ],
    },

    {
        lang: ["python", "py"],
        regexps: [
            /https:\/\/primers\.xplanc\.org\/document\/zh\/02\.Python\/EX\.%E5%86%85%E5%BB%BA%E5%87%BD%E6%95%B0\/EX\.(.+?)\.md/g
        ],
    },

    {
        lang: ["lua"],
        regexps: [
            /https:\/\/primers\.xplanc\.org\/document\/zh\/09\.Lua\/91\.%E5%86%85%E7%BD%AE%E5%87%BD%E6%95%B0\/EX\.(.+?)\.md/g,
            /https:\/\/primers\.xplanc\.org\/document\/zh\/09\.Lua\/92\.%E5%86%85%E7%BD%AE%E6%A8%A1%E5%9D%97\/EX\.(.+?)-module\.md/g,
        ],
    },

    {
        lang: ["c", "cpp", "c++"],
        regexps: [
            /https:\/\/primers\.xplanc\.org\/document\/zh\/06\.C\/EX\.%E6%A0%87%E5%87%86%E5%BA%93\.hide\/EX\.(.+?)\.md/g,
            /https:\/\/primers\.xplanc\.org\/document\/zh\/06\.C\/99\.API%20%E5%B8%AE%E5%8A%A9%E6%89%8B%E5%86%8C\/EX\.(.+?)\.md/g,
        ]
    },

    {
        lang: ["bash", "shell", "sh"],
        regexps: [
            /https:\/\/primers\.xplanc\.org\/document\/zh\/10\.Bash\/90\.%E5%B8%AE%E5%8A%A9%E6%89%8B%E5%86%8C\/EX\.(.+?)\.md/g
        ],
    },
]

const PATTERNS_EN: Pattern[] = [
    {
        lang: ["python"],
        regexps: [
            /https:\/\/primers\.xplanc\.org\/document\/en\/02\.Python\/EX\.Built-in%20functions\/EX\.(.+?)\.md/g
        ],
    }
]

const PATTERNS: Record<Language, Pattern[]> = {
    zh: PATTERNS_ZH,
    en: PATTERNS_EN,
}

// 文章分类对应的 Primer 语言
const CATEGORY_LANGUAGES: Record<string, string[]> = {
    html: ['html'],
    python: ['python'],
    lua: ['lua'],
    linux: ['bash'],
    bash: ['bash', 'shell', 'sh'],
    shell: ['bash', 'shell', 'sh'],
    sh: ['bash', 'shell', 'sh'],
    c: ['c'],
    cpp: ['c'],
    'c++': ['c'],
};

// 根据文章分类得到候选语言，未知分类时不匹配任何语言
export function primerLanguages(category: string): string[] {
    return CATEGORY_LANGUAGES[category.toLocaleLowerCase()] ?? [];
}

// 提取文章内代码块的语言标记（```lang / ~~~lang）
export function fenceLanguages(markdown: string): string[] {
    const languages = new Set<string>();

    for (const line of markdown.split('\n')) {
        const match = /^\s*(?:`{3,}|~{3,})\s*([^\s`~]+)/.exec(line);
        if (match) {
            languages.add(match[1].toLocaleLowerCase());
        }
    }

    return Array.from(languages);
}

// code span 只使用文章分类与文章内代码块的语言标记，避免跨语言误匹配
export function articleLanguages(category: string | undefined, markdown: string): string[] {
    const languages = new Set<string>(category ? primerLanguages(category) : []);

    for (const language of fenceLanguages(markdown)) {
        languages.add(language);
    }

    return Array.from(languages);
}

// 构建时由 scripts/fetch-primers-sitemap.mjs 生成
const SITEMAP_FILE = path.join(process.cwd(), '.cache', 'primers-sitemap.xml');

let sitemaps: Record<Language, Record<string, SitemapNode>> | undefined;

function parseSitemap(data: string, language: Language): Record<string, SitemapNode> {
    const result: Record<string, SitemapNode> = {};

    for (const pattern of PATTERNS[language]) {
        let links: [string, string][] = [];

        for (const regexp of pattern.regexps) {
            const matches = data.matchAll(regexp);
            links = links.concat(Array.from(matches).map(match => [match[1], match[0]]));
        }

        for (const lang of pattern.lang) {
            result[lang] = {
                links: Object.fromEntries(links),
            };
        }
    }

    return result;
}

function loadSitemaps(): Record<Language, Record<string, SitemapNode>> {
    if (sitemaps) {
        return sitemaps;
    }

    try {
        const data = fs.readFileSync(SITEMAP_FILE, 'utf-8');
        sitemaps = {
            zh: parseSitemap(data, 'zh'),
            en: parseSitemap(data, 'en'),
        };
    } catch (err) {
        console.warn('读取 sitemap 缓存失败，请先执行 npm run fetch:sitemap:', err);
        sitemaps = { zh: {}, en: {} };
    }

    return sitemaps;
}

export function getPrimerSitemap(language: Language = DEFAULT_LANGUAGE): Record<string, SitemapNode> {
    return loadSitemaps()[language];
}

// 文本开头的限定名，如 `setmetatable(t, mt)`、`table.insert`、`du -x -h`
const LEADING_NAME = /^\s*([A-Za-z_$][\w$]*(?:\s*[.:]\s*[A-Za-z_$][\w$]*)*)/;

// 提取可用于匹配的候选键：原文本、命令/函数名，以及模块名
function primerKeys(text: string): string[] {
    const key = text.replace(/^\W+|\W+$/g, '');
    const keys = [key];

    // `sudo xxx` 优先匹配 xxx，匹配不上时再退回 sudo
    const source = text.replace(/^\s*sudo(?=\s|$)/, '');
    const name = LEADING_NAME.exec(source)?.[1].replace(/\s+/g, '');

    if (name) {
        keys.push(name);

        // 带命名空间时退化到模块名匹配，如 table.insert → table、debug.getmetatable → debug
        const parts = name.split(/[.:]/);
        for (let i = 1; i < parts.length; i++) {
            keys.push(parts.slice(0, i).join('.'));
        }
    }

    if (source !== text) {
        keys.push('sudo');
    }

    return Array.from(new Set(keys));
}

// 根据文本查找对应的 Primer 文档链接
export function getPrimerLink(text: string, languages: string | string[], language: Language = DEFAULT_LANGUAGE): string | undefined {
    const data = getPrimerSitemap(language);

    for (const codeLanguage of Array.isArray(languages) ? languages : [languages]) {
        const links = data[codeLanguage.toLocaleLowerCase()]?.links;
        if (!links) {
            continue;
        }

        for (const key of primerKeys(text)) {
            if (Object.hasOwn(links, key)) {
                return decodeUrl(links[key]);
            }
        }
    }

    return undefined;
}

// 是否为 Primers 文档链接
export function isPrimerUrl(href: string): boolean {
    return /^https?:\/\/(?:www\.)?primers\.xplanc\.org\//i.test(href);
}

// 同一篇文档的归一化标识：忽略 #锚点，并统一百分号转义
export function primerKey(href: string): string {
    return decodeUrl(href).replace(/#.*$/, '');
}

// 文末汇总列表里的 Primers 文档
export interface PrimerLink {
    href: string;
}

// Primers 站点名称，取自外链配置
const PRIMER_TITLE = LINKS.find((link) => /primers\.xplanc\.org/i.test(link.url))?.title ?? 'Primers';

// 从文档地址得到可读标题，如：
// https://primers.xplanc.org/document/zh/10.Bash/90.帮助手册/EX.test.md
// -> Bash/帮助手册/test - Primers 编程伙伴
export function primerTitle(href: string, language: Language = DEFAULT_LANGUAGE): string {
    let pathname: string;

    try {
        pathname = new URL(href).pathname;
    } catch {
        return href;
    }

    const segments = pathname
        .split('/')
        .filter(Boolean)
        .map((segment) => {
            try {
                return decodeURIComponent(segment);
            } catch {
                return segment;
            }
        });

    // 去掉 document 与语言前缀
    if (segments[0] === 'document') {
        segments.shift();
        if (segments.length > 0 && /^(zh|en)$/i.test(segments[0])) {
            segments.shift();
        }
    }

    const parts = segments
        .map((segment, index) => {
            let value = segment;
            if (index === segments.length - 1) {
                value = value.replace(/\.md$/i, '');
            }
            return value
                .replace(/^\d+\./, '')      // 10.Bash -> Bash
                .replace(/^EX\./, '')       // EX.test -> test
                .replace(/\.hide$/i, '')    // 标准库.hide -> 标准库
                .replace(/-module$/i, '');  // string-module -> string
        })
        .filter(Boolean);

    if (parts.length === 0) {
        return href;
    }

    const suffix = language === 'en' ? 'Primers' : PRIMER_TITLE;
    return `${parts.join('/')} - ${suffix}`;
}

// 代码块内允许转换为链接的文档（行号基于预处理后的 Markdown）
export interface PrimerBlockLinks {
    startLine: number;
    endLine: number;
    keys: Set<string>;
}

export interface PreparedPrimers {
    markdown: string;
    links: PrimerLink[];
    blocks: PrimerBlockLinks[];
}

// 行内代码、Markdown 链接、代码块标识符
const INLINE_CODE = /(?<!`)(`+)(?!`)([^`\n]*?)\1(?!`)/g;
const INLINE_LINK = /(?<!!)\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
const FENCE_LINE = /^\s*(`{3,}|~{3,})\s*([^\s`~]*)/;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;
const BLOCK_TOKEN = /[A-Za-z_$][\w$]*/g;

interface InlineToken {
    type: 'link' | 'code';
    index: number;
    raw: string;
    text?: string;
    href?: string;
    ticks?: string;
    content?: string;
}

// 取行内下一个链接或代码片段，按出现位置区分先后
function nextInlineToken(line: string, from: number): InlineToken | undefined {
    INLINE_LINK.lastIndex = from;
    INLINE_CODE.lastIndex = from;

    const link = INLINE_LINK.exec(line);
    const code = INLINE_CODE.exec(line);

    if (link && (!code || link.index < code.index)) {
        return {
            type: 'link',
            index: link.index,
            raw: link[0],
            text: link[1],
            href: link[2],
        };
    }

    if (!code) {
        return undefined;
    }

    return {
        type: 'code',
        index: code.index,
        raw: code[0],
        ticks: code[1],
        content: code[2],
    };
}

// 处理一行普通文本：首次出现的 Primers 文档转为链接，重复出现保留原文
// 标题本身会再包一层链接，行内代码不再插入链接，避免出现嵌套 <a>
function convertInlineLine(line: string, languages: string[], language: Language, remember: (href: string) => boolean): string {
    const linkCode = !/^\s{0,3}#{1,6}\s/.test(line);
    let result = '';
    let cursor = 0;

    while (cursor < line.length) {
        const token = nextInlineToken(line, cursor);
        if (!token) {
            result += line.slice(cursor);
            break;
        }

        result += line.slice(cursor, token.index);

        if (token.type === 'link') {
            const href = token.href ?? '';
            const text = token.text ?? '';

            if (!isPrimerUrl(href)) {
                result += token.raw;
            } else {
                // 已转换过：退化为纯文本，避免全文重复出现同一个链接
                result += remember(href) ? token.raw : text;
            }
        } else {
            const content = token.content ?? '';
            const href = linkCode ? getPrimerLink(content, languages, language) : undefined;

            if (href && remember(href)) {
                result += `[${token.ticks}${content}${token.ticks}](${href})`;
            } else {
                result += token.raw;
            }
        }

        cursor = token.index + token.raw.length;
    }

    return result;
}

// 预处理文章：每个 Primers 文档只在首次出现处转换一次，并收集文末列表所需信息
export function preparePrimerLinks(markdown: string, languages: string | string[], language: Language = DEFAULT_LANGUAGE): PreparedPrimers {
    const langs = Array.isArray(languages) ? languages : [languages];
    const lines = markdown.split('\n');
    const output: string[] = [];
    const links: PrimerLink[] = [];
    const blocks: PrimerBlockLinks[] = [];
    const used = new Set<string>();

    const remember = (href: string): boolean => {
        const key = primerKey(href);
        if (used.has(key)) {
            return false;
        }
        used.add(key);
        links.push({ href });
        return true;
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const fence = FENCE_LINE.exec(line);

        if (!fence) {
            output.push(convertInlineLine(line, langs, language, remember));
            continue;
        }

        // 代码块：整段扫描一次，确定其中可以转换的文档，避免重复
        const marker = fence[1];
        const fenceLanguage = fence[2];
        const content: string[] = [];
        output.push(line);

        let j = i + 1;
        for (; j < lines.length; j++) {
            output.push(lines[j]);

            const close = FENCE_CLOSE.exec(lines[j]);
            if (close && close[1][0] === marker[0] && close[1].length >= marker.length) {
                break;
            }

            content.push(lines[j]);
        }

        const keys = new Set<string>();
        if (fenceLanguage) {
            for (const match of content.join('\n').matchAll(BLOCK_TOKEN)) {
                const href = getPrimerLink(match[0], fenceLanguage, language);
                if (href && remember(href)) {
                    keys.add(primerKey(href));
                }
            }
        }

        blocks.push({ startLine: i + 1, endLine: j + 1, keys });
        i = j;
    }

    return { markdown: output.join('\n'), links, blocks };
}

// 生成本文涉及的 Primers 文档列表
function primerSection(links: PrimerLink[], language: Language): string {
    const items = links.map(({ href }) => {
        const label = primerTitle(href, language).replace(/([\\[\]])/g, '\\$1');
        return `- [${label}](${href})`;
    });

    return `## ${LANGUAGE_CONFIG[language].ui.references}\n\n${items.join('\n')}`;
}

// 在文末追加 Primers 文档列表，尽量保持 AI 声明位于最后一行
export function insertPrimerSection(markdown: string, links: PrimerLink[], language: Language = DEFAULT_LANGUAGE): string {
    if (links.length === 0) {
        return markdown;
    }

    const section = primerSection(links, language);
    const lines = markdown.split('\n');

    let tail = lines.length - 1;
    while (tail >= 0 && lines[tail].trim() === '') {
        tail--;
    }

    if (tail >= 0 && /^>\s*(?:本文由\s*AI|This article was generated with AI)/i.test(lines[tail])) {
        lines.splice(tail, 0, section, '');
        return lines.join('\n');
    }

    return `${markdown.replace(/\s*$/, '')}\n\n${section}\n`;
}
