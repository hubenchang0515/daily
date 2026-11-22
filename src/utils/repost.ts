import { Language } from '@/config';
import { articleLanguages, insertPrimerSection, preparePrimerLinks } from './primers';

// 生成用于转载的 Markdown：与页面渲染保持一致，Primers 文档只在首次出现处转为链接，并在文末汇总
export function markdownForRepost(markdown: string, category: string, language: Language): string {
    const languages = articleLanguages(category, markdown);
    const prepared = preparePrimerLinks(markdown, languages);

    return insertPrimerSection(prepared.markdown, prepared.links, language);
}
