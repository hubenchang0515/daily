import { EN_CONFIG } from './config-en';
import { ZH_CONFIG } from './config-zh';

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
    ad: string;
    adSlide: (index: number) => string;
}

// 友链
export interface LinkItem {
    icon: string;
    title: string;
    url: string;
}

// 广告，image 为站点根路径下的图片，渲染时拼接 SITE_CONFIG.basePath
export interface AdItem {
    image: string;
    url: string;
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
    links: LinkItem[];
    ads: AdItem[];
    ui: LanguageUi;
}

export const LANGUAGE_CONFIG: Record<Language, LanguageConfig> = {
    zh: ZH_CONFIG,
    en: EN_CONFIG,
};

const DEFAULT_LANGUAGE_CONFIG = LANGUAGE_CONFIG[DEFAULT_LANGUAGE];

// 站点信息（默认使用中文，语言相关页面请按语言读取 LANGUAGE_CONFIG）
export const SITE_CONFIG = {
    origin: 'https://daily.xplanc.org', // 配置为你的域名，例如 https://hubenchang0515.github.io
    basePath: '',                       // 配置为基础路径，例如 /daily
    repo: 'https://github.com/hubenchang0515/daily',
    googleAnalyticsId: 'G-7X0K330YFR',
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
