import { articleLanguages, getPrimerLink } from './primers';

function replaceCodeSpans(text: string, languages: string[]): string {
    return text.replace(/(?<!`)(`+)(?!`)([^`\n]*?)\1(?!`)/g, (span, ticks, content) => {
        const href = getPrimerLink(content, languages);
        return href ? `[${ticks}${content}${ticks}](${href})` : span;
    });
}

// 生成用于转载的 Markdown：保留代码块，将可匹配的 code span 替换为 Primer 链接
export function markdownForRepost(markdown: string, category: string): string {
    const languages = articleLanguages(category, markdown);
    const lines = markdown.split('\n');
    const result: string[] = [];
    let buffer: string[] = [];
    let fence: string | undefined;

    const flush = () => {
        if (buffer.length > 0) {
            result.push(replaceCodeSpans(buffer.join('\n'), languages));
            buffer = [];
        }
    };

    for (const line of lines) {
        const match = /^\s*(`{3,}|~{3,})/.exec(line);
        const marker = match?.[1];

        if (fence) {
            result.push(line);

            if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) {
                fence = undefined;
            }
        } else if (marker) {
            flush();
            fence = marker;
            result.push(line);
        } else {
            buffer.push(line);
        }
    }

    flush();
    return result.join('\n');
}
