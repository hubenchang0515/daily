import type { Metadata } from "next";
import ListIcon from "@/assets/icons/ListIcon";
import Card from "@/components/Card";
import Discussion from "@/components/Discussion";
import Frame from "@/components/Frame";
import Link from "@/components/Link";
import Markdown from "@/components/Markdown";
import RepostButton from "@/components/RepostButton";
import { OWNER_CONFIG, SITE_CONFIG } from "@/config";
import { categories as getGategories, content, state } from "@/utils/document";
import { markdownForRepost } from "@/utils/repost";
import { absoluteUrl, articlePath, categoryPath, markdownDescription, markdownTitle } from "@/utils/seo";

export interface PageParams {
    category:string;    // 分类： 例如 Python 等
    article:string;     // 文章： xxx.md
}

export async function generateMetadata({params}:{params:Promise<PageParams>}): Promise<Metadata> {
    const path = await params;
    const category = decodeURIComponent(path.category);
    const article = decodeURIComponent(path.article);
    const text = await content(category, article);
    const title = markdownTitle(text) ?? article.replace(/\.md$/, '');
    const description = markdownDescription(text);
    const url = absoluteUrl(articlePath(category, article));
    const { createdTime, updatedTime } = await state(category, article);

    return {
        title,
        description,
        keywords: [category, SITE_CONFIG.brand, '编程', '技术文章'],
        alternates: {
            canonical: url,
        },
        openGraph: {
            type: 'article',
            locale: SITE_CONFIG.locale,
            url,
            siteName: SITE_CONFIG.brand,
            title,
            description,
            publishedTime: createdTime.toISOString(),
            modifiedTime: updatedTime.toISOString(),
            authors: [OWNER_CONFIG.name],
            section: category,
            tags: [category],
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
    const category = decodeURIComponent(path.category);
    const articleName = decodeURIComponent(path.article);
    const text = await content(category, articleName);
    const categories = await getGategories();
    const articles = categories.flatMap(item => item.articles).sort((x, y) => y.state.createdTime.getTime() - x.state.createdTime.getTime());
    const href = absoluteUrl(articlePath(category, articleName));
    const article = articleName.replace(/\.md$/, '');
    const title = markdownTitle(text) ?? article;
    const { createdTime, updatedTime } = await state(category, articleName);
    const repost = `${markdownForRepost(text, category).trimEnd()}\n\n---\n\n> 转载自：[${title} - ${SITE_CONFIG.brand}](${href})\n`;

    const jsonLd = {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'Article',
                headline: title,
                description: markdownDescription(text),
                datePublished: createdTime.toISOString(),
                dateModified: updatedTime.toISOString(),
                author: {
                    '@type': 'Person',
                    name: OWNER_CONFIG.name,
                    url: OWNER_CONFIG.url,
                },
                publisher: {
                    '@type': 'Organization',
                    name: SITE_CONFIG.brand,
                    url: SITE_CONFIG.origin,
                },
                mainEntityOfPage: {
                    '@type': 'WebPage',
                    '@id': href,
                },
                articleSection: category,
                inLanguage: 'zh-CN',
                keywords: [category, '编程'].join(', '),
                url: href,
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
                        name: category,
                        item: absoluteUrl(categoryPath(category)),
                    },
                    {
                        '@type': 'ListItem',
                        position: 3,
                        name: title,
                        item: href,
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
            <Frame categories={categories} articles={articles.slice(0,30)}>
            <nav aria-label="面包屑" className="flex flex-wrap items-center gap-2 px-1 text-[10px] tracking-[0.14em] text-[var(--muted)]">
                <Link href="/" className="transition-colors hover:text-[var(--accent)]">~</Link>
                <span>/</span>
                <Link href={categoryPath(category)} className="transition-colors hover:text-[var(--accent)]">{category}</Link>
                <span>/</span>
                <span className="truncate text-[var(--fg)]">{article}.md</span>
            </nav>
            <Card className="p-0">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[var(--border)] bg-[var(--panel-2)] px-4 py-2 text-[10px] tracking-[0.16em] text-[var(--muted)]">
                    <span className="truncate">FILE: {article}.md</span>
                    <div className="flex items-center gap-2">
                        <span className="retro-chip">{category}</span>
                        <RepostButton content={repost}/>
                        <Link href={categoryPath(category)} title="返回分类" className="retro-button p-1">
                            <span className="[&_svg]:h-4 [&_svg]:w-4"><ListIcon/></span>
                        </Link>
                    </div>
                </div>
                <div className="p-5 sm:p-8">
                    <Markdown content={text} href={href} lang={category}/>
                </div>
            </Card>
            <Discussion/>
            </Frame>
        </>
    )
}
