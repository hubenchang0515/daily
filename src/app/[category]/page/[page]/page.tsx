import type { Metadata } from "next";
import ArticleCard from "@/components/ArticleCard";
import Card from "@/components/Card";
import Frame from "@/components/Frame";
import Pagination from "@/components/Pagination";
import { DOCUMENT_CONFIG, SITE_CONFIG } from "@/config";
import { categories as getGategories } from "@/utils/document";
import { absoluteUrl, categoryPath } from "@/utils/seo";

export interface PageParams {
    category:string;    // 分类： 例如 Python 等
    page:string;        // 页码
}

export async function generateMetadata({params}:{params:Promise<PageParams>}): Promise<Metadata> {
    const path = await params;
    const name = decodeURIComponent(path.category);
    const page = Number(path.page);
    const categories = await getGategories();
    const category = categories.find(item => item.name === name);
    const last = Math.max(1, Math.ceil((category?.articles.length ?? 0) / DOCUMENT_CONFIG.pageSize));
    const title = page <= 1 ? `${name} 分类` : `${name} 分类 - 第 ${page} 页`;
    const description = `码日新「${name}」分类第 ${page} 页，共 ${last} 页，包含 ${name} 相关的编程实战文章。`;
    const url = page <= 1
        ? absoluteUrl(categoryPath(name))
        : absoluteUrl(`${categoryPath(name)}/page/${page}`);

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
    for (const category of categories) {
        for (let i = 1; i <= Math.ceil(category.articles.length / DOCUMENT_CONFIG.pageSize); i += 1) {
            if (process.env.NODE_ENV === 'development') {
                paramsList.push({
                    category: encodeURIComponent(category.name),
                    page: `${i}`,
                });
            } else {
                paramsList.push({
                    category: category.name,
                    page: `${i}`,
                });
            }
            
        }
    }
    
    
    return paramsList;
}

export default async function Page({params}:{params:Promise<PageParams>}) {
    const categories = await getGategories();
    const articles = categories.flatMap(category => category.articles).sort((x, y) => y.state.createdTime.getTime() - x.state.createdTime.getTime());
    const path = await params;
    const category = categories.find((item) => item.name === decodeURIComponent(path.category));
    const page = Number(path.page);
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
                    <p className="mt-1 text-[10px] tracking-[0.18em] text-[var(--muted)]">PAGE {page} / {last}</p>
                </div>
                <span className="retro-chip shrink-0">{category?.articles.length ?? 0} 篇</span>
            </section>
            {
                category?.articles.slice((page - 1)*DOCUMENT_CONFIG.pageSize, (page)*DOCUMENT_CONFIG.pageSize).map((article, i) => {
                    return (
                        <ArticleCard key={i} {...article}/>
                    )
                })
            }
            {
                (category?.articles.length ?? 0) === 0 &&
                <Card className="p-8 text-center text-sm text-[var(--muted)]">
                    这个分类下还没有文章。
                </Card>
            }
            <Pagination
                previous={page > 1 ? `${categoryPath(name)}/page/${page-1}` : undefined}
                next={page < last ? `${categoryPath(name)}/page/${page+1}` : undefined}
                page={last > 0 ? page : undefined}
                last={last > 0 ? last : undefined}
            />
        </Frame>
    );
}
