import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ArticleCard from "@/components/ArticleCard";
import Card from "@/components/Card";
import Frame from "@/components/Frame";
import Pagination from "@/components/Pagination";
import { DOCUMENT_CONFIG, isLanguage, LANGUAGES, LANGUAGE_CONFIG } from "@/config";
import { categories as getGategories } from "@/utils/document";
import { absoluteUrl, categoryPath, decodePathSegment } from "@/utils/seo";

export interface PageParams {
    lang:string;        // 语言：zh / en
    category:string;    // 分类： 例如 Python 等
    page:string;        // 页码
}

export async function generateMetadata({params}:{params:Promise<PageParams>}): Promise<Metadata> {
    const path = await params;
    if (!isLanguage(path.lang)) return {};
    const name = decodePathSegment(path.category);
    const page = Number(path.page);
    const config = LANGUAGE_CONFIG[path.lang];
    const categories = await getGategories(path.lang);
    const category = categories.find(item => item.name === name);
    const last = Math.max(1, Math.ceil((category?.articles.length ?? 0) / DOCUMENT_CONFIG.pageSize));
    const title = config.ui.categoryPageTitle(name, page);
    const description = config.ui.categoryPageDescription(name, page, last);
    const url = page <= 1
        ? absoluteUrl(categoryPath(path.lang, name))
        : absoluteUrl(`${categoryPath(path.lang, name)}/page/${page}`);

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
    for (const lang of LANGUAGES) {
        const categories = await getGategories(lang);
        for (const category of categories) {
            for (let i = 1; i <= Math.ceil(category.articles.length / DOCUMENT_CONFIG.pageSize); i += 1) {
                if (process.env.NODE_ENV === 'development') {
                    paramsList.push({
                        lang,
                        category: encodeURIComponent(category.name),
                        page: `${i}`,
                    });
                } else {
                    paramsList.push({
                        lang,
                        category: category.name,
                        page: `${i}`,
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

    const config = LANGUAGE_CONFIG[path.lang];
    const categories = await getGategories(path.lang);
    const articles = categories.flatMap(category => category.articles).sort((x, y) => y.state.createdTime.getTime() - x.state.createdTime.getTime());
    const category = categories.find((item) => item.name === decodePathSegment(path.category));
    const page = Number(path.page);
    const last = Math.ceil((category?.articles.length??0) / DOCUMENT_CONFIG.pageSize);
    const name = category?.name ?? decodePathSegment(path.category);

    if (!Number.isInteger(page) || page < 1 || page > last) notFound();

    return (
        <Frame language={path.lang} categories={categories} articles={articles.slice(0, 30)}>
            <section className="flex items-end justify-between gap-3 px-1">
                <div>
                    <p className="retro-label">[ CATEGORY ]</p>
                    <h1 className="mt-1 text-2xl font-bold tracking-[0.12em] text-[var(--fg)]">
                        <span className="text-[var(--accent)]">#</span> {name}<span className="blink text-[var(--accent)]">_</span>
                    </h1>
                    <p className="mt-1 text-[10px] tracking-[0.18em] text-[var(--muted)]">PAGE {page} / {last}</p>
                </div>
                <span className="retro-chip shrink-0">{config.ui.articlesCount(category?.articles.length ?? 0)}</span>
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
                    {config.ui.categoryEmpty}
                </Card>
            }
            <Pagination
                language={path.lang}
                previous={page > 1 ? `${categoryPath(path.lang, name)}/page/${page-1}` : undefined}
                next={page < last ? `${categoryPath(path.lang, name)}/page/${page+1}` : undefined}
                page={last > 0 ? page : undefined}
                last={last > 0 ? last : undefined}
            />
        </Frame>
    );
}
