import type { MetadataRoute } from 'next'
import { SITE_CONFIG } from '@/config'

export const dynamic = 'force-static'

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: SITE_CONFIG.title,
        short_name: SITE_CONFIG.brand,
        description: SITE_CONFIG.description,
        start_url: `${SITE_CONFIG.basePath}/`,
        scope: `${SITE_CONFIG.basePath}/`,
        display: 'standalone',
        background_color: '#5c94fc',
        theme_color: '#5c94fc',
        lang: 'zh-CN',
        icons: [
            {
                src: `${SITE_CONFIG.basePath}/favicon.svg`,
                sizes: 'any',
                type: 'image/svg+xml',
            },
        ],
    }
}
