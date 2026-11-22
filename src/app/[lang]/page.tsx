import ArticleCard from "@/components/ArticleCard";
import Card from "@/components/Card";
import Frame from "@/components/Frame";
import Pagination from "@/components/Pagination";
import Redirect from "@/components/Redirect";
import { DEFAULT_LANGUAGE, DOCUMENT_CONFIG, isLanguage, LANGUAGES, LANGUAGE_CONFIG } from "@/config";
import { categories as getGategories } from "@/utils/document";
import { categoryPath, languagePath } from "@/utils/seo";

export interface PageParams {
    lang: string;
}

// 生成静态页面路径
export async function generateStaticParams() {
    const paramsList: PageParams[] = LANGUAGES.map((lang) => ({ lang }));

    for (const category of await getGategories(DEFAULT_LANGUAGE)) {
        if (isLanguage(category.name)) continue;
        paramsList.push({
            lang: process.env.NODE_ENV === 'development'
                ? encodeURIComponent(category.name)
                : category.name,
        });
    }

    return paramsList;
}

export default async function Home({ params }: { params: Promise<PageParams> }) {
    const { lang } = await params;

    if (!isLanguage(lang)) {
        return <Redirect href={categoryPath(DEFAULT_LANGUAGE, decodeURIComponent(lang))} />;
    }

    const config = LANGUAGE_CONFIG[lang];
    const categories = await getGategories(lang);
    const articles = categories.flatMap(category => category.articles).sort((x, y) => y.state.createdTime.getTime() - x.state.createdTime.getTime());
    const last = Math.ceil(articles.length / DOCUMENT_CONFIG.pageSize);

    return (
        <Frame language={lang} categories={categories} articles={articles.slice(0,30)}>
            <section className="flex items-end justify-between gap-3 px-1">
                <div>
                    <p className="retro-label">[ LATEST LOG ]</p>
                    <h1 className="mt-1 text-2xl font-bold tracking-[0.12em] text-[var(--fg)]">
                        &gt; {config.ui.latest}<span className="blink text-[var(--accent)]">_</span>
                    </h1>
                </div>
                <span className="retro-chip shrink-0">{config.ui.articlesCount(articles.length)}</span>
            </section>
            <p className="px-1 text-sm leading-6 text-[var(--muted)]">
                {config.description}
            </p>
            {
                articles.length === 0 &&
                <Card className="p-8 text-center text-sm text-[var(--muted)]">
                    {config.ui.latestEmpty}
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
                language={lang}
                next={last > 1 ? `${languagePath(lang)}/page/2` : undefined}
                page={last > 1 ? 1 : undefined}
                last={last > 1 ? last : undefined}
            />
        </Frame>
    );
}
