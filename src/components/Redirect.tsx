import { SITE_CONFIG } from "@/config";
import Card from "./Card";

export interface RedirectProps {
    href: string;
}

export default function Redirect(props: RedirectProps) {
    const target = `${SITE_CONFIG.basePath}${props.href}`;
    const script = `window.location.replace(${JSON.stringify(target)});`;

    return (
        <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-4 p-6">
            <Card className="p-8 text-center sm:p-12">
                <p className="retro-label mx-auto w-fit">[ REDIRECT ]</p>
                <p className="mt-5 text-2xl font-bold tracking-[0.18em] text-[var(--fg)]">
                    &gt; REDIRECTING<span className="blink ml-1 text-[var(--accent)]">_</span>
                </p>
                <p className="mt-2 text-[10px] tracking-[0.18em] text-[var(--muted)]">正在跳转 / Redirecting</p>
                <noscript>
                    <p className="mt-4 text-sm">
                        <a href={target} className="text-[var(--accent)] underline">继续访问 / Continue</a>
                    </p>
                </noscript>
            </Card>
            <script dangerouslySetInnerHTML={{ __html: script }} />
        </main>
    );
}
