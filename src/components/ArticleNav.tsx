import { Article } from '@/utils/document';
import Link from './Link';

export interface ArticleNavProps {
    previous?: Article;     // 较新的一篇
    next?: Article;         // 较旧的一篇
}

function href(article: Article): string {
    return `/${encodeURIComponent(article.category)}/${encodeURIComponent(article.name)}`;
}

function title(article: Article): string {
    return article.name.replace(/\.md$/, '');
}

export default function ArticleNav(props: ArticleNavProps) {
    const item = 'flex min-w-0 items-center gap-2 px-3 py-2 text-xs tracking-[0.14em]';
    const disabled = 'flex min-w-0 items-center gap-2 px-3 py-2 text-xs tracking-[0.14em] text-[var(--muted)] opacity-50';

    return (
        <nav
            aria-label="文章翻页"
            className="grid grid-cols-1 gap-2 border-t-2 border-dashed border-[var(--border)] px-5 py-4 sm:grid-cols-2 sm:px-8"
        >
            {
                props.previous
                    ? (
                        <Link href={href(props.previous)} title={title(props.previous)} className={`${item} retro-button`}>
                            <span className="shrink-0 font-bold">[ ← 上一篇 ]</span>
                            <span className="truncate">{title(props.previous)}</span>
                        </Link>
                    )
                    : <span className={disabled}>[ ← 上一篇 ]</span>
            }
            {
                props.next
                    ? (
                        <Link href={href(props.next)} title={title(props.next)} className={`${item} retro-button justify-end text-right`}>
                            <span className="truncate">{title(props.next)}</span>
                            <span className="shrink-0 font-bold">[ 下一篇 → ]</span>
                        </Link>
                    )
                    : <span className={`${disabled} justify-end`}>[ 下一篇 → ]</span>
            }
        </nav>
    );
}
