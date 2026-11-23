import type { Metadata } from "next";
import ArticleCard from "@/components/ArticleCard";
import Card from "@/components/Card";
import Frame from "@/components/Frame";
import Pagination from "@/components/Pagination";
import Redirect from "@/components/Redirect";
import { DEFAULT_LANGUAGE, DOCUMENT_CONFIG, isLanguage, LANGUAGES, LANGUAGE_CONFIG } from "@/config";
import { categories as getGategories } from "@/utils/document";
import { absoluteUrl, articlePath, categoryPath, languagePath } from "@/utils/seo";

export interface PageParams {
    lang:string;        // 语言：zh / en
    category:string;    // 分类： 例如 Python 等
}

export async function generateMetadata({params}:{params:Promise<PageParams>}): Promise<Metadata> {
    const path = await params;
    if (!isLanguage(path.lang)) return {};
    const name = decodeURIComponent(path.category);
    const config = LANGUAGE_CONFIG[path.lang];
    const categories = await getGategories(path.lang);
    const category = categories.find(item => item.name === name);
    const count = category?.articles.length ?? 0;
    const title = config.ui.categoryTitle(name);
    const description = config.ui.categoryDescription(name, count);
    const url = absoluteUrl(categoryPath(path.lang, name));

    return {
        title,
        description,
        keywords: [name, ...config.keywords],
        alternates: {
            canonical: url,
        },
        openGraph: {
            type: 'website',
            locale: config.locale,
            url,
            siteName: config.brand,
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
    const development = process.env.NODE_ENV === 'development';

    for (const lang of LANGUAGES) {
        for (const category of await getGategories(lang)) {
            paramsList.push({
                lang,
                category: development ? encodeURIComponent(category.name) : category.name,
            });
        }
    }

    // 旧文章链接（/<分类>/<文章>）与旧首页分页（/page/<页码>）只在开发模式生成，
    // 生产构建由 404 页面（src/app/not-found.tsx）重定向
    if (development) {
        const legacyCategories = await getGategories(DEFAULT_LANGUAGE);
        for (const category of legacyCategories) {
            if (isLanguage(category.name)) continue;
            for (const article of category.articles) {
                paramsList.push({
                    lang: encodeURIComponent(category.name),
                    category: encodeURIComponent(article.name),
                });
            }
        }

        const legacyArticles = legacyCategories.flatMap(category => category.articles);
        const legacyPages = Math.ceil(legacyArticles.length / DOCUMENT_CONFIG.pageSize);
        for (let page = 1; page <= legacyPages; page += 1) {
            paramsList.push({
                lang: 'page',
                category: `${page}`,
            });
        }
    }

    return paramsList;
}

export default async function Page({params}:{params:Promise<PageParams>}) {
    const path = await params;

    if (!isLanguage(path.lang)) {
        return (
            <Redirect
                href={articlePath(
                    DEFAULT_LANGUAGE,
                    decodeURIComponent(path.lang),
                    decodeURIComponent(path.category),
                )}
            />
        );
    }

    const config = LANGUAGE_CONFIG[path.lang];
    const categories = await getGategories(path.lang);
    const category = categories.find((item) => item.name === decodeURIComponent(path.category));
    const articles = categories.flatMap(category => category.articles).sort((x, y) => y.state.createdTime.getTime() - x.state.createdTime.getTime());
    const last = Math.ceil((category?.articles.length??0) / DOCUMENT_CONFIG.pageSize);
    const name = category?.name ?? decodeURIComponent(path.category);
    const title = config.ui.categoryTitle(name);
    const url = absoluteUrl(categoryPath(path.lang, name));

    const jsonLd = {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'CollectionPage',
                name: title,
                url,
                inLanguage: config.htmlLang,
                isPartOf: {
                    '@type': 'WebSite',
                    name: config.brand,
                    url: absoluteUrl(languagePath(path.lang)),
                },
            },
            {
                '@type': 'BreadcrumbList',
                itemListElement: [
                    {
                        '@type': 'ListItem',
                        position: 1,
                        name: config.ui.home,
                        item: absoluteUrl(languagePath(path.lang)),
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
            <Frame language={path.lang} categories={categories} articles={articles.slice(0, 30)}>
            <section className="flex items-end justify-between gap-3 px-1">
                <div>
                    <p className="retro-label">[ CATEGORY ]</p>
                    <h1 className="mt-1 text-2xl font-bold tracking-[0.12em] text-[var(--fg)]">
                        <span className="text-[var(--accent)]">#</span> {name}<span className="blink text-[var(--accent)]">_</span>
                    </h1>
                </div>
                <span className="retro-chip shrink-0">{config.ui.articlesCount(category?.articles.length ?? 0)}</span>
            </section>
            <p className="px-1 text-sm leading-6 text-[var(--muted)]">
                {config.ui.categoryDescription(name, category?.articles.length ?? 0)}
            </p>
            {
                (category?.articles.length ?? 0) === 0 &&
                <Card className="p-8 text-center text-sm text-[var(--muted)]">
                    {config.ui.categoryEmpty}
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
                language={path.lang}
                next={last > 1 ? `${categoryPath(path.lang, name)}/page/2` : undefined}
                page={last > 1 ? 1 : undefined}
                last={last > 1 ? last : undefined}
            />
            </Frame>
        </>
    )
}
