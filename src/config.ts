// 支持的语言
export type Language = 'zh' | 'en';

export const LANGUAGES: Language[] = ['zh', 'en'];
export const DEFAULT_LANGUAGE: Language = 'zh';

export function isLanguage(value: string | undefined): value is Language {
    return LANGUAGES.includes(value as Language);
}

export function normalizeLanguage(value: string | undefined): Language {
    return isLanguage(value) ? value : DEFAULT_LANGUAGE;
}

// 语言相关的界面文案
export interface LanguageUi {
    latest: string;
    latestPage: (page: number) => string;
    latestDescription: (page: number) => string;
    latestEmpty: string;
    categoryTitle: (name: string) => string;
    categoryPageTitle: (name: string, page: number) => string;
    categoryDescription: (name: string, count: number) => string;
    categoryPageDescription: (name: string, page: number, last: number) => string;
    categoryEmpty: string;
    articlesCount: (count: number) => string;
    previousPage: string;
    nextPage: string;
    home: string;
    previousArticle: string;
    nextArticle: string;
    readMore: string;
    breadcrumb: string;
    source: string;
    backToCategory: string;
    related: string;
    references: string;
    originalLink: string;
    disclaimer: string;
    language: string;
    repost: string;
    repostTitle: string;
    copied: string;
}

export interface LanguageConfig {
    code: Language;
    name: string;           // 语言的原生名称
    shortName: string;      // 页面上简短显示
    locale: string;         // Open Graph locale
    htmlLang: string;       // html lang 与 JSON-LD inLanguage
    dateLocale: string;     // 日期格式化使用的 locale
    title: string;
    brand: string;
    slogan: string;
    description: string;
    keywords: string[];
    owner: {
        name: string;
        brief: string;
    };
    ui: LanguageUi;
}

export const LANGUAGE_CONFIG: Record<Language, LanguageConfig> = {
    zh: {
        code: 'zh',
        name: '中文',
        shortName: '中',
        locale: 'zh_CN',
        htmlLang: 'zh-CN',
        dateLocale: 'zh-CN',
        title: '每日文章',
        brand: '码日新 · 每日文章',
        slogan: '书到用时方恨少，事非经过不知难。',
        description: '苟日新，日日新，又日新。每天一篇通俗易懂的编程实战文章，涵盖 Python、Linux、Lua、HTML。',
        keywords: ['码日新', '编程日课', '每日文章', '编程实战', 'Python', 'Linux', 'Lua', 'HTML', 'AI 编程', '技术博客'],
        owner: {
            name: 'AI 助手',
            brief: '使用 AI 辅助创作。',
        },
        ui: {
            latest: '最新文章',
            latestPage: (page) => `最新文章 - 第 ${page} 页`,
            latestDescription: (page) => `码日新最新文章列表第 ${page} 页，持续更新 Python、Linux、Lua、HTML 等编程实战文章。`,
            latestEmpty: '还没有文章，去写一篇吧。',
            categoryTitle: (name) => `${name} 分类`,
            categoryPageTitle: (name, page) => page <= 1 ? `${name} 分类` : `${name} 分类 - 第 ${page} 页`,
            categoryDescription: (name, count) => `码日新「${name}」分类，共 ${count} 篇通俗易懂的 ${name} 实战文章。`,
            categoryPageDescription: (name, page, last) => `码日新「${name}」分类第 ${page} 页，共 ${last} 页，包含 ${name} 相关的编程实战文章。`,
            categoryEmpty: '这个分类下还没有文章。',
            articlesCount: (count) => `${count} 篇`,
            previousPage: '上一页',
            nextPage: '下一页',
            home: '首页',
            previousArticle: '上一篇',
            nextArticle: '下一篇',
            readMore: '查看全文',
            breadcrumb: '面包屑',
            source: '在 GitHub 查看源文件',
            backToCategory: '返回分类',
            related: '相关文章',
            references: '参考文档',
            originalLink: '原文链接',
            disclaimer: '> 本文由 AI 辅助生成并经人工校验，如有疏漏欢迎指正。',
            language: '语言',
            repost: '转载',
            repostTitle: '转载（复制 Markdown）',
            copied: '已复制',
        },
    },

    en: {
        code: 'en',
        name: 'English',
        shortName: 'EN',
        locale: 'en_US',
        htmlLang: 'en',
        dateLocale: 'en-US',
        title: 'Daily Coding Articles',
        brand: 'Code Daily · Daily Articles',
        slogan: 'A little progress every day goes a long way.',
        description: 'One approachable programming article every day, covering Python, Linux, Lua, HTML and more.',
        keywords: ['programming', 'daily articles', 'tutorials', 'Python', 'Linux', 'Lua', 'HTML', 'AI-assisted writing', 'tech blog'],
        owner: {
            name: 'AI Assistant',
            brief: 'Written with AI assistance.',
        },
        ui: {
            latest: 'Latest Articles',
            latestPage: (page) => `Latest Articles - Page ${page}`,
            latestDescription: (page) => `Page ${page} of the latest programming articles, covering practical topics in Python, Linux, Lua, HTML and more.`,
            latestEmpty: 'No articles yet. Time to write one.',
            categoryTitle: (name) => `${name} Category`,
            categoryPageTitle: (name, page) => page <= 1 ? `${name} Category` : `${name} Category - Page ${page}`,
            categoryDescription: (name, count) => `Browse ${count} practical ${name} articles with troubleshooting tips, code examples and hands-on experience.`,
            categoryPageDescription: (name, page, last) => `Page ${page} of ${last} in the ${name} category, featuring practical ${name} articles.`,
            categoryEmpty: 'No articles in this category yet.',
            articlesCount: (count) => `${count} article${count === 1 ? '' : 's'}`,
            previousPage: 'Previous',
            nextPage: 'Next',
            home: 'Home',
            previousArticle: 'Previous',
            nextArticle: 'Next',
            readMore: 'Read more',
            breadcrumb: 'Breadcrumb',
            source: 'View source on GitHub',
            backToCategory: 'Back to category',
            related: 'Related Articles',
            references: 'References',
            originalLink: 'Original link',
            disclaimer: '> This article was generated with AI assistance and reviewed by a human. Corrections are welcome.',
            language: 'Language',
            repost: 'Repost',
            repostTitle: 'Repost (copy Markdown)',
            copied: 'Copied',
        },
    },
};

const DEFAULT_LANGUAGE_CONFIG = LANGUAGE_CONFIG[DEFAULT_LANGUAGE];

// 站点信息（默认使用中文，语言相关页面请按语言读取 LANGUAGE_CONFIG）
export const SITE_CONFIG = {
    origin: 'https://daily.xplanc.org', // 配置为你的域名，例如 https://hubenchang0515.github.io
    basePath: '',                       // 配置为基础路径，例如 /daily
    repo: 'https://github.com/hubenchang0515/daily',
    defaultLanguage: DEFAULT_LANGUAGE,
    title: DEFAULT_LANGUAGE_CONFIG.title,
    brand: DEFAULT_LANGUAGE_CONFIG.brand,
    slogan: DEFAULT_LANGUAGE_CONFIG.slogan,
    description: DEFAULT_LANGUAGE_CONFIG.description,
    keywords: DEFAULT_LANGUAGE_CONFIG.keywords,
    locale: DEFAULT_LANGUAGE_CONFIG.locale,
}

// 站长信息
export const OWNER_CONFIG = {
    name: DEFAULT_LANGUAGE_CONFIG.owner.name,
    avatar: SITE_CONFIG.basePath + "/avatar.png",
    username: "hubenchang0515",
    brief: DEFAULT_LANGUAGE_CONFIG.owner.brief,
    url: 'https://xplanc.org/',
    email: 'hubenchang0515@gmail.com'
}

// 文档路径
export const DOCUMENT_CONFIG = {
    root: 'daily-document',
    pageSize: 10,
}

// 外链
export const LINKS = [
    {
        icon: "https://hubenchang0515.github.io/icons/launcher.svg",
        title: "我的主页",
        url: "https://hubenchang0515.github.io/",
    },

    {
        icon: "https://primers.xplanc.org/favicon.svg",
        title: "Primers 编程伙伴",
        url: "https://primers.xplanc.org/",
    },

    {
        icon: "https://shift.js.org/favicon.svg",
        title: "Shift 在线编程",
        url: "https://shift.js.org/",
    },

    {
        icon: "https://idea.xplanc.org/favicon.svg",
        title: "想法",
        url: "https://idea.xplanc.org/",
    },

    {
        icon: "https://hubenchang0515.github.io/moe-tools/favicon.svg",
        title: "萌萌工具箱",
        url: "https://hubenchang0515.github.io/moe-tools/",
    },

    {
        icon: "https://xplanc.org/QtTheme/icon.svg",
        title: "QtTheme 在线主题",
        url: "https://hubenchang0515.github.io/QtTheme/",
    },

    {
        icon: "https://meme.xplanc.org/icon.png",
        title: "萌萌表情包",
        url: "https://meme.xplanc.org/",
    },

    {
        icon: "https://pdf-shelf.pages.dev/pdf.png",
        title: "编程书籍分享",
        url: "https://pdf-shelf.pages.dev/",
    },
]

// 广告
export const ADS = [
    {
        image: SITE_CONFIG.basePath + "/ads/tx_240_400.png",
        url: "https://curl.qcloud.com/XQ2YFLc8",
    },
    {
        image: SITE_CONFIG.basePath + "/ads/ali_240_400.png",
        url: "https://www.aliyun.com/minisite/goods?userCode=gtmsv57a",
    }
]
