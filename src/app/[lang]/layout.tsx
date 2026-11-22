import type { Metadata } from "next";
import { LANGUAGES, LANGUAGE_CONFIG, normalizeLanguage, OWNER_CONFIG } from "@/config";
import { absoluteUrl, languagePath } from "@/utils/seo";

export interface LanguageParams {
    lang: string;
}

export async function generateMetadata({ params }: { params: Promise<LanguageParams> }): Promise<Metadata> {
    const { lang } = await params;
    const language = normalizeLanguage(lang);
    const config = LANGUAGE_CONFIG[language];
    const url = absoluteUrl(languagePath(language));

    return {
        title: {
            absolute: config.title,
            template: `%s | ${config.brand}`,
        },
        description: config.description,
        keywords: config.keywords,
        applicationName: config.brand,
        authors: [{ name: config.owner.name, url: OWNER_CONFIG.url }],
        creator: config.owner.name,
        publisher: config.owner.name,
        alternates: {
            canonical: url,
            languages: Object.fromEntries(
                LANGUAGES.map((code) => [LANGUAGE_CONFIG[code].htmlLang, absoluteUrl(languagePath(code))]),
            ),
        },
        openGraph: {
            type: "website",
            locale: config.locale,
            url,
            siteName: config.brand,
            title: config.title,
            description: config.description,
        },
        twitter: {
            card: "summary",
            title: config.title,
            description: config.description,
        },
    };
}

export default async function LanguageLayout({
    children,
    params,
}: Readonly<{
    children: React.ReactNode;
    params: Promise<LanguageParams>;
}>) {
    const { lang } = await params;
    const config = LANGUAGE_CONFIG[normalizeLanguage(lang)];
    const langScript = `document.documentElement.lang=${JSON.stringify(config.htmlLang)};`;

    return (
        <>
            <script dangerouslySetInnerHTML={{ __html: langScript }} />
            <div lang={config.htmlLang} className="contents">
                {children}
            </div>
        </>
    );
}
