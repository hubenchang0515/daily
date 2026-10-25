import fs from 'fs';
import path from 'path';

export interface SitemapNode {
    links: Record<string, string>;
}

interface Pattern {
    lang: string[];
    regexps: RegExp[];
}

// 匹配列表
const PATTERNS: Pattern[] = [
    {
        lang: ["html"],
        regexps: [
            /https:\/\/primers.xplanc\.org\/document\/zh\/03\.HTML\/EX\.HTML%20%E5%85%83%E7%B4%A0\/EX\.(.+?)\.md/g
        ],
    },

    {
        lang: ["python", "py"],
        regexps: [
            /https:\/\/primers.xplanc\.org\/document\/zh\/02\.Python\/EX\.%E5%86%85%E5%BB%BA%E5%87%BD%E6%95%B0\/EX\.(.+?)\.md/g
        ],
    },

    {
        lang: ["lua"],
        regexps: [
            /https:\/\/primers.xplanc\.org\/document\/zh\/09\.Lua\/91\.%E5%86%85%E7%BD%AE%E5%87%BD%E6%95%B0\/EX\.(.+?)\.md/g,
            /https:\/\/primers.xplanc\.org\/document\/zh\/09\.Lua\/92\.%E5%86%85%E7%BD%AE%E6%A8%A1%E5%9D%97\/EX\.(.+?)-module\.md/g,
        ],
    },

    {
        lang: ["c", "cpp", "c++"],
        regexps: [
            /https:\/\/primers.xplanc\.org\/document\/zh\/06\.C\/EX\.%E6%A0%87%E5%87%86%E5%BA%93\.hide\/EX\.(.+?)\.md/g,
            /https:\/\/primers.xplanc\.org\/document\/zh\/06\.C\/99\.API%20%E5%B8%AE%E5%8A%A9%E6%89%8B%E5%86%8C\/EX\.(.+?)\.md/g,
        ]
    },

    {
        lang: ["bash", "shell", "sh"],
        regexps: [
            /https:\/\/primers.xplanc\.org\/document\/zh\/10.Bash\/90\.%E5%B8%AE%E5%8A%A9%E6%89%8B%E5%86%8C\/EX\.(.+?)\.md/g
        ],
    },
]

// 构建时由 scripts/fetch-primers-sitemap.mjs 生成
const SITEMAP_FILE = path.join(process.cwd(), '.cache', 'primers-sitemap.xml');

let sitemap: Record<string, SitemapNode> | undefined;

function parseSitemap(data: string): Record<string, SitemapNode> {
    const result: Record<string, SitemapNode> = {};

    for (const pattern of PATTERNS) {
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

export function getPrimerSitemap(): Record<string, SitemapNode> {
    if (sitemap) {
        return sitemap;
    }

    try {
        sitemap = parseSitemap(fs.readFileSync(SITEMAP_FILE, 'utf-8'));
    } catch (err) {
        console.warn('读取 sitemap 缓存失败，请先执行 npm run fetch:sitemap:', err);
        sitemap = {};
    }

    return sitemap;
}
