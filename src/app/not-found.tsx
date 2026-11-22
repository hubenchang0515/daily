import type { Metadata } from "next";
import Card from "@/components/Card";
import LegacyRedirect from "@/components/LegacyRedirect";
import Link from "@/components/Link";
import { LANGUAGES, LANGUAGE_CONFIG } from "@/config";
import { languagePath } from "@/utils/seo";

export const metadata: Metadata = {
    title: "404",
    robots: {
        index: false,
        follow: false,
    },
};

const fallbackStyle = `#not-found-redirect{display:none!important}#not-found-content{display:flex!important}`;

export default function NotFound() {
    return (
        <>
            <div id="not-found-redirect" className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-4 p-6">
                <Card className="p-8 text-center sm:p-12">
                    <p className="retro-label mx-auto w-fit">[ REDIRECT ]</p>
                    <p className="mt-5 text-2xl font-bold tracking-[0.18em] text-[var(--fg)]">
                        &gt; REDIRECTING<span className="blink ml-1 text-[var(--accent)]">_</span>
                    </p>
                    <p className="mt-2 text-[10px] tracking-[0.18em] text-[var(--muted)]">正在跳转 / Redirecting</p>
                </Card>
            </div>

            <main id="not-found-content" className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-4 p-6">
                <Card className="p-8 text-center sm:p-12">
                    <p className="retro-label mx-auto w-fit">[ 404 ]</p>
                    <h1 className="mt-5 text-2xl font-bold tracking-[0.12em] text-[var(--fg)]">
                        页面不存在<span className="blink ml-1 text-[var(--accent)]">_</span>
                    </h1>
                    <p className="mt-2 text-sm tracking-[0.12em] text-[var(--muted)]">Page not found</p>
                    <p className="mx-auto mt-5 max-w-xl text-sm leading-6 text-[var(--muted)]">
                        请选择语言继续访问，或从首页重新开始。
                        <br />
                        Choose a language to continue.
                    </p>

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

            <LegacyRedirect />
            <noscript>
                <style>{fallbackStyle}</style>
            </noscript>
        </>
    );
}
