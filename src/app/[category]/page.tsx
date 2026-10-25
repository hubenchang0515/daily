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
}

export async function generateMetadata({params}:{params:Promise<PageParams>}): Promise<Metadata> {
    const path = await params;
    const name = decodeURIComponent(path.category);
    const categories = await getGategories();
    const category = categories.find(item => item.name === name);
    const count = category?.articles.length ?? 0;
    const description = `码日新「${name}」分类，共 ${count} 篇通俗易懂的 ${name} 实战文章。`;
    const url = absoluteUrl(categoryPath(name));

    return {
        title: `${name} 分类`,
        description,
        keywords: [name, SITE_CONFIG.brand, '编程', '技术文章'],
        alternates: {
            canonical: url,
        },
        openGraph: {
            type: 'website',
            locale: SITE_CONFIG.locale,
            url,
            siteName: SITE_CONFIG.brand,
            title: `${name} 分类`,
            description,
        },
        twitter: {
            card: 'summary',
            title: `${name} 分类`,
            description,
        },
    };
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
    const url = absoluteUrl(categoryPath(name));

    const jsonLd = {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'CollectionPage',
                name: `${name} 分类`,
                url,
                inLanguage: 'zh-CN',
                isPartOf: {
                    '@type': 'WebSite',
                    name: SITE_CONFIG.brand,
                    url: absoluteUrl('/'),
                },
            },
            {
                '@type': 'BreadcrumbList',
                itemListElement: [
                    {
                        '@type': 'ListItem',
                        position: 1,
                        name: '首页',
                        item: absoluteUrl('/'),
                    },
                    {
                        '@type': 'ListItem',
                        position: 2,
                        name,
                        item: url,
                    },
                ],
            },
        ],
    };

    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
            />
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
            <p className="px-1 text-sm leading-6 text-[var(--muted)]">
                {name} 分类下共有 {category?.articles.length ?? 0} 篇编程实战文章，涵盖常见问题排查、代码示例与实践经验。
            </p>
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
                next={last > 1 ? `${categoryPath(name)}/page/2` : undefined}
                page={last > 1 ? 1 : undefined}
                last={last > 1 ? last : undefined}
            />
            </Frame>
        </>
    )
}
