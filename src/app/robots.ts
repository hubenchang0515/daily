import type { MetadataRoute } from 'next'
import { SITE_CONFIG } from '@/config'

export const dynamic = 'force-static'

export default function robots(): MetadataRoute.Robots {
    return {
        rules: {
            userAgent: '*',
            allow: '/',
        },
        sitemap: `${SITE_CONFIG.origin}${SITE_CONFIG.basePath}/sitemap.xml`,
        host: SITE_CONFIG.origin,
    }
}
