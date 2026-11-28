import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ArticleCard from "@/components/ArticleCard";
import Frame from "@/components/Frame";
import Pagination from "@/components/Pagination";
import Redirect from "@/components/Redirect";
import { DEFAULT_LANGUAGE, DOCUMENT_CONFIG, isLanguage, LANGUAGES, LANGUAGE_CONFIG } from "@/config";
import { categories as getGategories } from "@/utils/document";
import { absoluteUrl, categoryPath, decodePathSegment, languagePath } from "@/utils/seo";

export interface PageParams {
    lang:string;        // 语言：zh / en
    page:string;        // 页码
}

export async function generateMetadata({params}:{params:Promise<PageParams>}): Promise<Metadata> {
    const path = await params;
    if (!isLanguage(path.lang)) return {};
    const page = Number(path.page);
    const config = LANGUAGE_CONFIG[path.lang];
    const title = page <= 1 ? config.ui.latest : config.ui.latestPage(page);
    const description = page <= 1 ? config.description : config.ui.latestDescription(page);
    const url = page <= 1
        ? absoluteUrl(languagePath(path.lang))
        : absoluteUrl(`${languagePath(path.lang)}/page/${page}`);

    return {
        title,
        description,
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
        const categories = await getGategories(lang);
        const articles = categories.flatMap(category => category.articles);
        for (let i = 1; i <= Math.ceil(articles.length / DOCUMENT_CONFIG.pageSize); i += 1) {
            paramsList.push({
                lang,
                page: `${i}`,
            });
        }
    }

    // 旧分类分页（/<分类>/page/<页码>）只在开发模式生成，
    // 生产构建由 404 页面（src/app/not-found.tsx）重定向
    if (development) {
        for (const category of await getGategories(DEFAULT_LANGUAGE)) {
            if (isLanguage(category.name)) continue;
            const pages = Math.ceil(category.articles.length / DOCUMENT_CONFIG.pageSize);
            for (let i = 1; i <= pages; i += 1) {
                paramsList.push({
                    lang: encodeURIComponent(category.name),
                    page: `${i}`,
                });
            }
        }
    }

    return paramsList;
}

export default async function Page({params}:{params:Promise<PageParams>}) {
    const path = await params;

    if (!isLanguage(path.lang)) {
        return (
            <Redirect
                href={`${categoryPath(DEFAULT_LANGUAGE, decodePathSegment(path.lang))}/page/${path.page}`}
            />
        );
    }

    const page = Number(path.page);
    const config = LANGUAGE_CONFIG[path.lang];
    const categories = await getGategories(path.lang);
    const articles = categories.flatMap(category => category.articles).sort((x, y) => y.state.createdTime.getTime() - x.state.createdTime.getTime());
    const last = Math.ceil(articles.length / DOCUMENT_CONFIG.pageSize);

    if (!Number.isInteger(page) || page < 1 || page > last) notFound();

    return (
        <Frame language={path.lang} categories={categories} articles={articles.slice(0, 30)}>
            <section className="flex items-end justify-between gap-3 px-1">
                <div>
                    <p className="retro-label">[ LATEST LOG ]</p>
                    <h1 className="mt-1 text-2xl font-bold tracking-[0.12em] text-[var(--fg)]">
                        &gt; {config.ui.latest}<span className="blink text-[var(--accent)]">_</span>
                    </h1>
                    <p className="mt-1 text-[10px] tracking-[0.18em] text-[var(--muted)]">PAGE {page} / {last}</p>
                </div>
                <span className="retro-chip shrink-0">{config.ui.articlesCount(articles.length)}</span>
            </section>
            {
                articles.slice((page - 1)*DOCUMENT_CONFIG.pageSize, (page)*DOCUMENT_CONFIG.pageSize).map((article, i) => {
                    return (
                        <ArticleCard key={i} {...article}/>
                    )
                })
            }
            <Pagination
                language={path.lang}
                previous={page > 1 ? `${languagePath(path.lang)}/page/${page-1}` : undefined}
                next={page < last ? `${languagePath(path.lang)}/page/${page+1}` : undefined}
                page={last > 0 ? page : undefined}
                last={last > 0 ? last : undefined}
            />
        </Frame>
    );
}
