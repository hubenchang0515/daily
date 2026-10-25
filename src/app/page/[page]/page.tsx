import type { Metadata } from "next";
import ArticleCard from "@/components/ArticleCard";
import Card from "@/components/Card";
import Frame from "@/components/Frame";
import Pagination from "@/components/Pagination";
import { DOCUMENT_CONFIG, SITE_CONFIG } from "@/config";
import { categories as getGategories } from "@/utils/document";
import { absoluteUrl } from "@/utils/seo";

export interface PageParams {
    page:string;    // 页码
}

export async function generateMetadata({params}:{params:Promise<PageParams>}): Promise<Metadata> {
    const path = await params;
    const page = Number(path.page);
    const title = page <= 1 ? '最新文章' : `最新文章 - 第 ${page} 页`;
    const description = page <= 1
        ? SITE_CONFIG.description
        : `码日新最新文章列表第 ${page} 页，持续更新 Python、Linux、Lua、HTML 等编程实战文章。`;
    const url = page <= 1 ? absoluteUrl('/') : absoluteUrl(`/page/${page}`);

    return {
        title,
        description,
        alternates: {
            canonical: url,
        },
        openGraph: {
            type: 'website',
            locale: SITE_CONFIG.locale,
            url,
            siteName: SITE_CONFIG.brand,
            title,
            description,
        },
        twitter: {
            card: 'summary',
            title,
            description,
        },
    };
}

// 生成静态页面路径
export async function generateStaticParams() {
    const paramsList:PageParams[] = []
    const categories = await getGategories();
    const articles = categories.flatMap(category => category.articles).sort((x, y) => y.state.createdTime.getTime() - x.state.createdTime.getTime());
    for (let i = 1; i <= Math.ceil(articles.length / DOCUMENT_CONFIG.pageSize); i += 1) {
        paramsList.push({
            page: `${i}`,
        });
    }
    
    return paramsList;
}

export default async function Page({params}:{params:Promise<PageParams>}) {
    const categories = await getGategories();
    const articles = categories.flatMap(category => category.articles).sort((x, y) => y.state.createdTime.getTime() - x.state.createdTime.getTime());
    const path = await params;
    const page = Number(path.page);
    const last = Math.ceil(articles.length / DOCUMENT_CONFIG.pageSize);

    return (
        <Frame categories={categories} articles={articles.slice(0, 30)}>
            <section className="flex items-end justify-between gap-3 px-1">
                <div>
                    <p className="retro-label">[ LATEST LOG ]</p>
                    <h1 className="mt-1 text-2xl font-bold tracking-[0.12em] text-[var(--fg)]">
                        &gt; 最新文章<span className="blink text-[var(--accent)]">_</span>
                    </h1>
                    <p className="mt-1 text-[10px] tracking-[0.18em] text-[var(--muted)]">PAGE {page} / {last}</p>
                </div>
                <span className="retro-chip shrink-0">{articles.length} 篇</span>
            </section>
            {
                articles.slice((page - 1)*DOCUMENT_CONFIG.pageSize, (page)*DOCUMENT_CONFIG.pageSize).map((article, i) => {
                    return (
                        <ArticleCard key={i} {...article}/>
                    )
                })
            }
            {
                articles.length === 0 &&
                <Card className="p-8 text-center text-sm text-[var(--muted)]">
                    还没有文章，去写一篇吧。
                </Card>
            }
            <Pagination
                previous={page > 1 ? `/page/${page-1}` : undefined}
                next={page < last ? `/page/${page+1}` : undefined}
                page={last > 0 ? page : undefined}
                last={last > 0 ? last : undefined}
            />
        </Frame>
    );
}
