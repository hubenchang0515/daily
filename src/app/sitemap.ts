import type { MetadataRoute } from 'next'
import { DOCUMENT_CONFIG } from '@/config';
import { categories as getCategories, type Category } from '@/utils/document';
import { absoluteUrl, articlePath, categoryPath } from '@/utils/seo';

export const dynamic = 'force-static'

function latestUpdate(category: Category): Date {
    return category.articles.reduce(
        (latest, article) => article.state.updatedTime > latest ? article.state.updatedTime : latest,
        new Date(0)
    );
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const categories = await getCategories();
    const articles = categories.flatMap(category => category.articles);
    const latest = articles.reduce(
        (date, article) => article.state.updatedTime > date ? article.state.updatedTime : date,
        new Date(0)
    );
    const lastModified = latest.getTime() > 0 ? latest : new Date();
    const sites: MetadataRoute.Sitemap = [
        {
            url: absoluteUrl('/'),
            lastModified,
            changeFrequency: 'daily',
            priority: 1,
        },
    ];

    // 首页分页
    const pages = Math.ceil(articles.length / DOCUMENT_CONFIG.pageSize);
    for (let page = 2; page <= pages; page += 1) {
        sites.push({
            url: absoluteUrl(`/page/${page}`),
            lastModified,
            changeFrequency: 'daily',
            priority: 0.5,
        });
    }

    for (const category of categories) {
        const categoryLatest = latestUpdate(category);
        const categoryLastModified = categoryLatest.getTime() > 0 ? categoryLatest : lastModified;
        const categoryPages = Math.ceil(category.articles.length / DOCUMENT_CONFIG.pageSize);

        sites.push({
            url: absoluteUrl(categoryPath(category.name)),
            lastModified: categoryLastModified,
            changeFrequency: 'weekly',
            priority: 0.8,
        });

        for (let page = 2; page <= categoryPages; page += 1) {
            sites.push({
                url: absoluteUrl(`${categoryPath(category.name)}/page/${page}`),
                lastModified: categoryLastModified,
                changeFrequency: 'weekly',
                priority: 0.5,
            });
        }

        for (const article of category.articles) {
            sites.push({
                url: absoluteUrl(articlePath(category.name, article.name)),
                lastModified: article.state.updatedTime,
                changeFrequency: 'monthly',
                priority: 0.6,
            });
        }
    }

    return sites;
}
