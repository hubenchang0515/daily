import { DOCUMENT_CONFIG, SITE_CONFIG } from '@/config';

// 将站内路径转换为绝对地址
export function absoluteUrl(pathname = '/') {
    const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
    return new URL(`${SITE_CONFIG.basePath}${path}`, SITE_CONFIG.origin).toString();
}

export function categoryPath(category: string) {
    return `/${encodeURIComponent(category)}`;
}

export function articlePath(category: string, article: string) {
    return `/${encodeURIComponent(category)}/${encodeURIComponent(article)}`;
}

// 文章源文件在 GitHub 仓库中的地址
export function documentSourceUrl(category: string, article: string) {
    const file = [DOCUMENT_CONFIG.root, 'document', category, article]
        .map(encodeURIComponent)
        .join('/');
    return `${SITE_CONFIG.repo}/blob/HEAD/${file}`;
}

// 提取 Markdown 一级标题
export function markdownTitle(text: string) {
    return /^#\s+(.+)$/m.exec(text)?.[1]?.trim();
}

// 提取正文首段作为摘要
export function markdownDescription(text: string, limit = 150) {
    const buffer: string[] = [];
    let inCode = false;

    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (line.startsWith('```')) {
            inCode = !inCode;
            continue;
        }
        if (inCode) continue;
        if (!line) {
            if (buffer.length > 0) break;
            continue;
        }
        if (/^#{1,6}\s/.test(line)) {
            if (buffer.length > 0) break;
            continue;
        }
        if (/^!\[[^\]]*\]\([^)]*\)$/.test(line)) continue;
        buffer.push(line);
    }

    const plain = buffer.join(' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[*_`>#~]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (plain.length === 0) return SITE_CONFIG.description;
    return plain.length > limit ? `${plain.slice(0, limit).trim()}…` : plain;
}
