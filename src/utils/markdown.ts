import { SITE_CONFIG } from '@/config';

const ORIGINAL_LINK = /^\s*>\s*原文链接[：:]/;
const SEPARATOR = /^\s*---\s*$/;
const BLANK = /^\s*$/;

// 生成原文链接块
export function originalLinkBlock(title: string, url: string) {
    return `> 原文链接：[${title} - ${SITE_CONFIG.brand}](${url})`;
}

// 可安全还原到 Markdown 链接中的 ASCII 字符（不含空格、括号、分隔符等）
const SAFE_ASCII = /^[A-Za-z0-9\-._~!$&'*+,;=:@]$/;

// 解码链接地址中的百分号转义，保留会破坏链接的字符（空格、括号、#、? 等）
export function decodeUrl(url: string): string {
    return url
        // 非 ASCII 字符（UTF-8 多字节）
        .replace(/(?:%[89A-Fa-f][0-9A-Fa-f])+/g, (sequence) => {
            try {
                const decoded = decodeURIComponent(sequence);
                return /\s/u.test(decoded) ? sequence : decoded;
            } catch {
                return sequence;
            }
        })
        // 可安全还原的 ASCII 字符，如 %2B -> +
        .replace(/%([0-9A-Fa-f]{2})/g, (match, hex: string) => {
            const char = String.fromCharCode(parseInt(hex, 16));
            return SAFE_ASCII.test(char) ? char : match;
        });
}

// 提取原文链接块（链接地址保持中文等字符原样）
export function originalLink(markdown: string): string | undefined {
    const line = markdown.split('\n').find((item) => ORIGINAL_LINK.test(item))?.trim();
    if (!line) return undefined;

    const match = /\]\((.*)\)$/.exec(line);
    if (!match) return line;

    return `${line.slice(0, match.index + 2)}${decodeUrl(match[1])})`;
}

// 移除原文链接块及其相邻的分隔线（用于页面渲染）
export function stripOriginalLink(markdown: string): string {
    const lines = markdown.split('\n');
    const result: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        if (!ORIGINAL_LINK.test(lines[i])) {
            result.push(lines[i]);
            continue;
        }

        // 删除链接块前面的空行与分隔线
        while (result.length > 0 && BLANK.test(result[result.length - 1])) result.pop();
        if (result.length > 0 && SEPARATOR.test(result[result.length - 1])) {
            result.pop();
            while (result.length > 0 && BLANK.test(result[result.length - 1])) result.pop();
        }

        // 跳过链接块后面的空行与分隔线
        let next = i + 1;
        while (next < lines.length && BLANK.test(lines[next])) next++;
        if (next < lines.length && SEPARATOR.test(lines[next])) {
            next++;
            while (next < lines.length && BLANK.test(lines[next])) next++;
        }
        i = next - 1;
    }

    return result.join('\n').replace(/^\n+/, '').replace(/\n+$/, '\n');
}
