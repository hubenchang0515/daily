import fs from 'node:fs/promises';
import path from 'node:path';

const SITEMAP_URL = process.env.PRIMERS_SITEMAP_URL ?? 'https://primers.xplanc.org/sitemap.xml';
const SITEMAP_FILE = path.join(process.cwd(), '.cache', 'primers-sitemap.xml');

async function main(): Promise<void> {
    try {
        const response = await fetch(SITEMAP_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; idea-build/1.0)',
                'Accept': 'application/xml,text/xml,*/*',
            },
            signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
            throw new Error(`${response.status} ${response.statusText}`);
        }

        await fs.mkdir(path.dirname(SITEMAP_FILE), { recursive: true });
        await fs.writeFile(SITEMAP_FILE, await response.text());
        console.log(`sitemap 已保存: ${SITEMAP_FILE}`);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        try {
            await fs.access(SITEMAP_FILE);
            console.warn(`获取 sitemap 失败，使用已有缓存: ${message}`);
        } catch {
            console.warn(`获取 sitemap 失败，且无缓存: ${message}`);
        }
    }
}

main();
