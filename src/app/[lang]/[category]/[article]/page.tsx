import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ListIcon from "@/assets/icons/ListIcon";
import ArticleNav from "@/components/ArticleNav";
import Card from "@/components/Card";
import Discussion from "@/components/Discussion";
import Frame from "@/components/Frame";
import Link from "@/components/Link";
import Markdown from "@/components/Markdown";
import RepostButton from "@/components/RepostButton";
import { isLanguage, LANGUAGES, LANGUAGE_CONFIG, OWNER_CONFIG } from "@/config";
import { categories as getGategories, content, state } from "@/utils/document";
import { markdownForRepost } from "@/utils/repost";
import { originalLink, originalLinkBlock, stripOriginalLink } from "@/utils/markdown";
import { absoluteUrl, articlePath, categoryPath, decodePathSegment, documentSourceUrl, languagePath, markdownDescription, markdownTitle, readableUrl } from "@/utils/seo";

export interface PageParams {
    lang:string;        // 语言：zh / en
    category:string;    // 分类： 例如 Python 等
    article:string;     // 文章： xxx.md
}

export async function generateMetadata({params}:{params:Promise<PageParams>}): Promise<Metadata> {
    const path = await params;
    if (!isLanguage(path.lang)) return {};
    const language = path.lang;
    const config = LANGUAGE_CONFIG[language];
    const category = decodePathSegment(path.category);
    const article = decodePathSegment(path.article);
    const text = await content(language, category, article);
    const title = markdownTitle(text) ?? article.replace(/\.md$/, '');
    const description = markdownDescription(text, language);
    const url = absoluteUrl(articlePath(language, category, article));
    const { createdTime, updatedTime } = await state(language, category, article);

    return {
        title,
        description,
        keywords: [category, ...config.keywords],
        alternates: {
            canonical: url,
        },
        openGraph: {
            type: 'article',
            locale: config.locale,
            url,
            siteName: config.brand,
            title,
            description,
            publishedTime: createdTime.toISOString(),
            modifiedTime: updatedTime.toISOString(),
            authors: [config.owner.name],
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
    for (const lang of LANGUAGES) {
        for (const category of await getGategories(lang)) {
            for (const article of category.articles) {
                if (process.env.NODE_ENV === 'development') {
                    paramsList.push({
                        lang,
                        category: encodeURIComponent(category.name),
                        article: encodeURIComponent(article.name),
                    });
                } else {
                    paramsList.push({
                        lang,
                        category: category.name,
                        article: article.name,
                    });
                }
            }
        }
    }

    return paramsList;
}

export default async function Page({params}:{params:Promise<PageParams>}) {
    const path = await params;
    if (!isLanguage(path.lang)) notFound();
    const language = path.lang;
    const config = LANGUAGE_CONFIG[language];
    const category = decodePathSegment(path.category);
    const articleName = decodePathSegment(path.article);
    const text = await content(language, category, articleName);
    const categories = await getGategories(language);
    const articles = categories.flatMap(item => item.articles).sort((x, y) => y.state.createdTime.getTime() - x.state.createdTime.getTime());
    const href = absoluteUrl(articlePath(language, category, articleName));
    const article = articleName.replace(/\.md$/, '');
    const title = markdownTitle(text) ?? article;
    const { createdTime, updatedTime } = await state(language, category, articleName);
    const index = articles.findIndex(item => item.category === category && item.name === articleName);
    const previous = index > 0 ? articles[index - 1] : undefined;                     // 列表中较新的一篇
    const next = index >= 0 && index < articles.length - 1 ? articles[index + 1] : undefined;  // 列表中较旧的一篇
    // 转载时原文链接固定在开头
    const original = originalLink(text) ?? originalLinkBlock(language, title, readableUrl(`/${language}/${category}/${articleName}`));
    const repost = `${original}\n\n---\n\n${markdownForRepost(stripOriginalLink(text), category, language).trimEnd()}\n`;

    const jsonLd = {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'Article',
                headline: title,
                description: markdownDescription(text, language),
                datePublished: createdTime.toISOString(),
                dateModified: updatedTime.toISOString(),
                author: {
                    '@type': 'Person',
                    name: config.owner.name,
                    url: OWNER_CONFIG.url,
                },
                publisher: {
                    '@type': 'Organization',
                    name: config.brand,
                    url: absoluteUrl(languagePath(language)),
                },
                mainEntityOfPage: {
                    '@type': 'WebPage',
                    '@id': href,
                },
                articleSection: category,
                inLanguage: config.htmlLang,
                keywords: [category, 'programming'].join(', '),
                url: href,
            },
            {
                '@type': 'BreadcrumbList',
                itemListElement: [
                    {
                        '@type': 'ListItem',
                        position: 1,
                        name: config.ui.home,
                        item: absoluteUrl(languagePath(language)),
                    },
                    {
                        '@type': 'ListItem',
                        position: 2,
                        name: category,
                        item: absoluteUrl(categoryPath(language, category)),
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
            <Frame language={language} categories={categories} articles={articles.slice(0,30)}>
            <nav aria-label={config.ui.breadcrumb} className="flex flex-nowrap items-center gap-2 overflow-hidden px-1 text-[10px] tracking-[0.14em] text-[var(--muted)]">
                <Link href={languagePath(language)} className="shrink-0 transition-colors hover:text-[var(--accent)]">~</Link>
                <span className="shrink-0">/</span>
                <Link href={categoryPath(language, category)} className="shrink-0 transition-colors hover:text-[var(--accent)]">{category}</Link>
                <span className="shrink-0">/</span>
                <span className="min-w-0 truncate text-[var(--fg)]">{article}.md</span>
            </nav>
            <Card className="p-0">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[var(--border)] bg-[var(--panel-2)] px-4 py-2 text-[10px] tracking-[0.16em] text-[var(--muted)]">
                    <span className="truncate">
                        FILE:{' '}
                        <Link
                            href={documentSourceUrl(language, category, articleName)}
                            title={config.ui.source}
                            className="transition-colors hover:text-[var(--accent)]"
                        >
                            {article}.md
                        </Link>
                    </span>
                    <div className="flex items-center gap-2">
                        <RepostButton content={repost} language={language}/>
                        <Link
                            href={categoryPath(language, category)}
                            title={config.ui.backToCategory}
                            className="retro-button inline-flex items-center gap-1.5 px-2 py-1 text-[10px] tracking-[0.12em]"
                        >
                            <span className="[&_svg]:h-4 [&_svg]:w-4"><ListIcon/></span>
                            <span>{category}</span>
                        </Link>
                    </div>
                </div>
                <div className="p-5 sm:p-8">
                    <Markdown content={text} href={href} category={category} language={language} showPrimerList/>
                </div>
                <ArticleNav language={language} previous={previous} next={next}/>
            </Card>
            <Discussion language={language}/>
            </Frame>
        </>
    )
}
