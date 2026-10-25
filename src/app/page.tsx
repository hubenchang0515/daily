import ArticleCard from "@/components/ArticleCard";
import Card from "@/components/Card";
import Frame from "@/components/Frame";
import Pagination from "@/components/Pagination";
import { DOCUMENT_CONFIG, SITE_CONFIG } from "@/config";
import { categories as getGategories } from "@/utils/document";

export default async function Home() {
    const categories = await getGategories();
    const articles = categories.flatMap(category => category.articles).sort((x, y) => y.state.createdTime.getTime() - x.state.createdTime.getTime());
    const last = Math.ceil(articles.length / DOCUMENT_CONFIG.pageSize);

    return (
        <Frame categories={categories} articles={articles.slice(0,30)}>
            <section className="flex items-end justify-between gap-3 px-1">
                <div>
                    <p className="retro-label">[ LATEST LOG ]</p>
                    <h1 className="mt-1 text-2xl font-bold tracking-[0.12em] text-[var(--fg)]">
                        &gt; 最新文章<span className="blink text-[var(--accent)]">_</span>
                    </h1>
                </div>
                <span className="retro-chip shrink-0">{articles.length} 篇</span>
            </section>
            <p className="px-1 text-sm leading-6 text-[var(--muted)]">
                {SITE_CONFIG.description}
            </p>
            {
                articles.length === 0 &&
                <Card className="p-8 text-center text-sm text-[var(--muted)]">
                    还没有文章，去写一篇吧。
                </Card>
            }
            {
                articles.slice(0, DOCUMENT_CONFIG.pageSize).map((article, i) => {
                    return (
                        <ArticleCard key={i} {...article}/>
                    )
                })
            }
            <Pagination
                next={last > 1 ? '/page/2' : undefined}
                page={last > 1 ? 1 : undefined}
                last={last > 1 ? last : undefined}
            />
        </Frame>
    );
}
