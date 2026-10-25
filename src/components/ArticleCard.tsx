import { content, type Article as ArticleProps} from '@/utils/document'
import Markdown from './Markdown';
import Link from './Link';
import Card from './Card';

function formatDate(date: Date): string {
    return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export default async function ArticleCard(props:ArticleProps) {
    const text = await content(props.category, props.name);
    return (
        <Card className="group animate-rise overflow-hidden p-0 transition-all duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[7px_7px_0_var(--shadow)]">
            <div className='p-5'>
                <div className="mb-3 flex flex-wrap items-center gap-2 text-[10px] tracking-[0.14em]">
                    <span className="retro-chip">{props.category}</span>
                    <time dateTime={props.state.createdTime.toISOString()} className="text-[var(--muted)]">{formatDate(props.state.createdTime)}</time>
                    <span className="ml-auto text-[var(--accent-2)]">●</span>
                </div>
                <Markdown 
                    content={text.split('\n').slice(0, 10).join('\n')}
                    href={`/${encodeURIComponent(props.category)}/${encodeURIComponent(props.name)}`} 
                />
            </div>
            <Link 
                href={`/${encodeURIComponent(props.category)}/${encodeURIComponent(props.name)}`} 
                className='flex items-center justify-between border-t-2 border-[var(--border)] bg-[var(--panel-2)] px-5 py-3 text-xs tracking-[0.16em] text-[var(--muted)] transition-colors duration-150 group-hover:bg-[var(--accent)] group-hover:text-[var(--on-accent)]'
            >
                <span>[ 查看全文 ]</span>
                <span className="transition-transform duration-150 group-hover:translate-x-1">→</span>
            </Link>
        </Card>
    )
}
