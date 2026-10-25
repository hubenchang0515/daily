import { SITE_CONFIG } from '@/config';
import { categories as getGategories } from '@/utils/document';
import type { MetadataRoute } from 'next'

export const dynamic = 'force-static'

export default async function sitemap():Promise<MetadataRoute.Sitemap> {
    const sites = [];

    // 根路径
    const base = new URL(SITE_CONFIG.basePath, SITE_CONFIG.origin);
    sites.push({
        url: base.toString(),
        lastModified: new Date(),
    });

    const categories = await getGategories();
    for (const category of categories) {
        for (const article of category.articles) {
            sites.push({
                url: new URL(`${SITE_CONFIG.basePath}/${category.name}/${article.name}`, SITE_CONFIG.origin).toString(),
            lastModified: article.state.updatedTime
            });
        }
    }
    return sites;
}