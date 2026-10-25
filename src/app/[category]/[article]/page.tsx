import ListIcon from "@/assets/icons/ListIcon";
import Card from "@/components/Card";
import Discussion from "@/components/Discussion";
import Frame from "@/components/Frame";
import Link from "@/components/Link";
import Markdown from "@/components/Markdown";
import { SITE_CONFIG } from "@/config";
import { categories as getGategories, content } from "@/utils/document";

export interface PageParams {
    category:string;    // 分类： 例如 Python 等
    article:string;     // 文章： xxx.md
}

// 生成静态页面路径
export async function generateStaticParams() {
    const paramsList:PageParams[] = []
    for (const category of await getGategories()) {
        for (const article of category.articles) {
            if (process.env.NODE_ENV === 'development') {
                paramsList.push({
                    category: encodeURIComponent(category.name),
                    article: encodeURIComponent(article.name),
                });
            } else {
                paramsList.push({
                    category: category.name,
                    article: article.name,
                });
            }
        }
    }
    
    return paramsList;
}

export default async function Page({params}:{params:Promise<PageParams>}) {
    const path = await params;
    const text = await content(decodeURIComponent(path.category), decodeURIComponent(path.article));
    const categories = await getGategories();
    const articles = categories.flatMap(category => category.articles).sort((x, y) => y.state.createdTime.getTime() - x.state.createdTime.getTime());
    const href = `${SITE_CONFIG.origin}${SITE_CONFIG.basePath}/${path.category}/${path.article}`;
    const category = decodeURIComponent(path.category);
    const article = decodeURIComponent(path.article).replace(/\.md$/, '');

    return (
        <Frame categories={categories} articles={articles.slice(0,30)}>
            <nav aria-label="面包屑" className="flex flex-wrap items-center gap-2 px-1 text-[10px] tracking-[0.14em] text-[var(--muted)]">
                <Link href="/" className="transition-colors hover:text-[var(--accent)]">~</Link>
                <span>/</span>
                <Link href={`/${path.category}`} className="transition-colors hover:text-[var(--accent)]">{category}</Link>
                <span>/</span>
                <span className="truncate text-[var(--fg)]">{article}.md</span>
            </nav>
            <Card className="p-0">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[var(--border)] bg-[var(--panel-2)] px-4 py-2 text-[10px] tracking-[0.16em] text-[var(--muted)]">
                    <span className="truncate">FILE: {article}.md</span>
                    <div className="flex items-center gap-2">
                        <span className="retro-chip">{category}</span>
                        <Link href={`/${path.category}`} title="返回分类" className="retro-button p-1">
                            <span className="[&_svg]:h-4 [&_svg]:w-4"><ListIcon/></span>
                        </Link>
                    </div>
                </div>
                <div className="p-5 sm:p-8">
                    <Markdown content={text} href={href}/>
                </div>
            </Card>
            <Discussion/>
        </Frame>
    )
}
