import { SITE_CONFIG } from '@/config';

const ORIGINAL_LINK = /^\s*>\s*原文链接[：:]/;
const SEPARATOR = /^\s*---\s*$/;
const BLANK = /^\s*$/;

// 生成原文链接块
export function originalLinkBlock(title: string, url: string) {
    return `> 原文链接：[${title} - ${SITE_CONFIG.brand}](${url})`;
}

// 提取原文链接块
export function originalLink(markdown: string): string | undefined {
    return markdown.split('\n').find((line) => ORIGINAL_LINK.test(line))?.trim();
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
