import ArticleCard from "@/components/ArticleCard";
import Card from "@/components/Card";
import Frame from "@/components/Frame";
import Pagination from "@/components/Pagination";
import { DOCUMENT_CONFIG } from "@/config";
import { categories as getGategories } from "@/utils/document";

export interface PageParams {
    category:string;    // 分类： 例如 Python 等
}

// 生成静态页面路径
export async function generateStaticParams() {
    const paramsList:PageParams[] = []
    for (const category of await getGategories()) {
        if (process.env.NODE_ENV === 'development') {
            paramsList.push({
                category: encodeURIComponent(category.name),
            });
        } else {
            paramsList.push({
                category: category.name,
            });
        }
    }
    
    return paramsList;
}

export default async function Page({params}:{params:Promise<PageParams>}) {
    const path = await params;
    const categories = await getGategories();
    const category = categories.find((item) => item.name === decodeURIComponent(path.category));
    const articles = categories.flatMap(category => category.articles).sort((x, y) => y.state.createdTime.getTime() - x.state.createdTime.getTime());
    const last = Math.ceil((category?.articles.length??0) / DOCUMENT_CONFIG.pageSize);
    const name = category?.name ?? decodeURIComponent(path.category);

    return (
        <Frame categories={categories} articles={articles.slice(0, 30)}>
            <section className="flex items-end justify-between gap-3 px-1">
                <div>
                    <p className="retro-label">[ CATEGORY ]</p>
                    <h1 className="mt-1 text-2xl font-bold tracking-[0.12em] text-[var(--fg)]">
                        <span className="text-[var(--accent)]">#</span> {name}<span className="blink text-[var(--accent)]">_</span>
                    </h1>
                </div>
                <span className="retro-chip shrink-0">{category?.articles.length ?? 0} 篇</span>
            </section>
            {
                (category?.articles.length ?? 0) === 0 &&
                <Card className="p-8 text-center text-sm text-[var(--muted)]">
                    这个分类下还没有文章。
                </Card>
            }
            {
                category?.articles.slice(0, DOCUMENT_CONFIG.pageSize).map((article, i) => {
                    return (
                        <ArticleCard key={i} {...article}/>
                    )
                })
            }
            <Pagination
                next={last > 1 ? `/${path.category}/page/2` : undefined}
                page={last > 1 ? 1 : undefined}
                last={last > 1 ? last : undefined}
            />
        </Frame>
    )
}
