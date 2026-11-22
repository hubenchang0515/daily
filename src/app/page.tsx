import type { Metadata } from "next";
import Card from "@/components/Card";
import Link from "@/components/Link";
import { LANGUAGES, LANGUAGE_CONFIG, SITE_CONFIG } from "@/config";
import { absoluteUrl, languagePath } from "@/utils/seo";

export const metadata: Metadata = {
    title: { absolute: SITE_CONFIG.title },
    description: SITE_CONFIG.description,
    alternates: {
        canonical: absoluteUrl("/"),
        languages: Object.fromEntries(
            LANGUAGES.map((code) => [LANGUAGE_CONFIG[code].htmlLang, absoluteUrl(languagePath(code))]),
        ),
    },
    openGraph: {
        type: "website",
        locale: SITE_CONFIG.locale,
        url: absoluteUrl("/"),
        siteName: SITE_CONFIG.brand,
        title: SITE_CONFIG.title,
        description: SITE_CONFIG.description,
    },
};

export default function Home() {
    return (
        <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-4 p-6">
            <Card className="p-8 text-center sm:p-12">
                <p className="retro-label mx-auto w-fit">[ LANGUAGE ]</p>
                <h1 className="mt-5 text-3xl font-bold tracking-[0.18em] text-[var(--fg)]">
                    {SITE_CONFIG.title}
                    <span className="blink ml-1 text-[var(--accent)]">_</span>
                </h1>
                <p className="mt-2 text-sm tracking-[0.16em] text-[var(--muted)]">{SITE_CONFIG.slogan}</p>
                <p className="mx-auto mt-5 max-w-xl text-sm leading-6 text-[var(--muted)]">{SITE_CONFIG.description}</p>

                <div className="mt-8 grid gap-3 text-left sm:grid-cols-2">
                    {
                        LANGUAGES.map((code) => {
                            const config = LANGUAGE_CONFIG[code];
                            return (
                                <Link
                                    key={code}
                                    href={languagePath(code)}
                                    title={config.name}
                                    className="retro-button flex items-center gap-3 px-4 py-3"
                                >
                                    <span className="border border-[var(--border)] bg-[var(--accent-soft)] px-2 py-1 text-[11px] font-bold tracking-[0.12em] text-[var(--accent)]">
                                        {config.shortName}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-sm font-bold tracking-[0.12em] text-[var(--fg)]">{config.name}</span>
                                        <span className="mt-0.5 block truncate text-[11px] text-[var(--muted)]">{config.title}</span>
                                    </span>
                                    <span className="text-[var(--accent)]">→</span>
                                </Link>
                            );
                        })
                    }
                </div>
            </Card>
        </main>
    );
}
