import { DEFAULT_LANGUAGE, LANGUAGE_CONFIG, Language } from '@/config';
import { Article } from '@/utils/document';
import { articlePath } from '@/utils/seo';
import Link from './Link';

export interface ArticleNavProps {
    language?: Language;
    previous?: Article;     // 较新的一篇
    next?: Article;         // 较旧的一篇
}

function href(article: Article): string {
    return articlePath(article.language, article.category, article.name);
}

function title(article: Article): string {
    return article.name.replace(/\.md$/, '');
}

export default function ArticleNav(props: ArticleNavProps) {
    const language = props.language ?? DEFAULT_LANGUAGE;
    const config = LANGUAGE_CONFIG[language];
    const item = 'flex min-w-0 items-center gap-2 px-3 py-2 text-xs tracking-[0.14em]';
    const disabled = 'flex min-w-0 items-center gap-2 px-3 py-2 text-xs tracking-[0.14em] text-[var(--muted)] opacity-50';

    return (
        <nav
            aria-label={`${config.ui.previousArticle} / ${config.ui.nextArticle}`}
            className="grid grid-cols-1 gap-2 border-t-2 border-dashed border-[var(--border)] px-5 py-4 sm:grid-cols-2 sm:px-8"
        >
            {
                props.previous
                    ? (
                        <Link href={href(props.previous)} title={title(props.previous)} className={`${item} retro-button`}>
                            <span className="shrink-0 font-bold">[ ← {config.ui.previousArticle} ]</span>
                            <span className="truncate">{title(props.previous)}</span>
                        </Link>
                    )
                    : <span className={disabled}>[ ← {config.ui.previousArticle} ]</span>
            }
            {
                props.next
                    ? (
                        <Link href={href(props.next)} title={title(props.next)} className={`${item} retro-button justify-end text-right`}>
                            <span className="truncate">{title(props.next)}</span>
                            <span className="shrink-0 font-bold">[ {config.ui.nextArticle} → ]</span>
                        </Link>
                    )
                    : <span className={`${disabled} justify-end`}>[ {config.ui.nextArticle} → ]</span>
            }
        </nav>
    );
}
