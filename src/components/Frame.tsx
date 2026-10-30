import GitHubIcon from "@/assets/icons/GitHubIcon";
import { LINKS, OWNER_CONFIG, SITE_CONFIG } from "@/config";
import React from "react";
import Link from "./Link";
import Card from './Card';
import ThemeToggle from "./ThemeToggle";
import AdCarousel from "./AdCarousel";
import { Article, Category } from "@/utils/document";

export interface FrameProps
{
    categories?: Category[];
    articles?: Article[];
    children?: React.ReactNode;
}

function formatDate(date: Date): string {
    return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date);
}

export default function Frame(props:FrameProps)
{
    return (
        <div className="min-h-screen">
            <header className="mx-auto w-full max-w-[1500px] px-3 pt-3 sm:px-4 sm:pt-4">
                <div className="retro-panel flex items-center justify-between gap-3 px-4 py-3">
                    <Link href="/" className="group flex min-w-0 items-center gap-3">
                        <img
                            src="/favicon.svg"
                            alt=""
                            width={40}
                            height={40}
                            className="h-10 w-10 shrink-0 transition-transform duration-150 group-hover:-translate-y-0.5"
                        />
                        <span className="min-w-0">
                            <span className="block truncate text-lg font-bold tracking-[0.18em] text-[var(--fg)]">
                                {SITE_CONFIG.title}
                                <span className="blink ml-1 text-[var(--accent)]">_</span>
                            </span>
                            <span className="block truncate text-[11px] tracking-[0.16em] text-[var(--muted)]">{SITE_CONFIG.slogan}</span>
                        </span>
                    </Link>
                    <div className="flex shrink-0 items-center gap-3">
                        <ThemeToggle/>
                        <Link
                            href={SITE_CONFIG.repo}
                            className="retro-button inline-flex items-center gap-2 px-3 py-1.5 text-[11px] tracking-[0.16em]"
                        >
                            <span className="[&_svg]:h-4 [&_svg]:w-4"><GitHubIcon/></span>
                            <span className="hidden sm:inline">GITHUB</span>
                        </Link>
                    </div>
                </div>
            </header>
            <main className="mx-auto flex w-full max-w-[1500px] flex-col gap-3 p-3 sm:gap-4 sm:p-4 md:flex-row">
                <aside className="order-2 flex flex-col gap-3 md:order-1 md:w-64 md:shrink-0 xl:w-72">
                    <div className="flex flex-col gap-3">
                        <Card className="p-5 text-center">
                            <p className="retro-label mb-3">[ OPERATOR ]</p>
                            <Link href="/" className="group mx-auto block w-fit">
                                <span className="block border-2 border-[var(--border)] bg-[var(--panel-2)] p-1 shadow-[4px_4px_0_var(--shadow)] transition-transform duration-150 group-hover:-translate-y-0.5">
                                    <img src={OWNER_CONFIG.avatar} alt={OWNER_CONFIG.name} width={112} height={112} className="h-28 w-28 object-cover" />
                                </span>
                            </Link>
                            <h2 className="mt-4 text-xl font-bold tracking-[0.12em] text-[var(--fg)]"><Link href="/">{OWNER_CONFIG.name}</Link></h2>
                            <p className="mt-1 text-xs tracking-[0.12em] text-[var(--muted)]">@{OWNER_CONFIG.username}</p>
                            <p className="mt-3 border-t border-dashed border-[var(--border)] pt-3 text-sm leading-6 text-[var(--muted)]">{OWNER_CONFIG.brief}</p>
                        </Card>
                        <Card className="p-4">
                            <p className="retro-label mb-3">[ LINKS ]</p>
                            <div className='grid grid-cols-4 gap-2'>
                                {
                                    LINKS.map((item, i) => {
                                        return (
                                            <Link
                                                key={i}
                                                href={item.url}
                                                title={item.title}
                                                className="retro-button flex items-center justify-center p-2"
                                            >
                                                <img src={item.icon} alt={item.title} width={32} height={32} className="h-8 w-8" />
                                            </Link>
                                        )
                                    })
                                }
                            </div>
                        </Card>
                        {
                            props.categories && 
                            <Card className="p-4">
                                <p className="retro-label mb-3">[ CATEGORIES ]</p>
                                <div className='flex flex-col gap-1'>
                                    {
                                        props.categories?.map((item, i) => {
                                            return (
                                                <Link
                                                    key={i}
                                                    href={`/${encodeURIComponent(item.name)}`}
                                                    title={item.name}
                                                    className="retro-link flex items-center justify-between gap-2 px-2 py-1.5 text-sm"
                                                >
                                                    <span className="truncate"><span className="text-[var(--accent)]">#</span> {item.name}</span>
                                                    <span className="border border-[var(--border)] bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] text-[var(--accent)]">{item.articles.length}</span>
                                                </Link>
                                            )
                                        })
                                    }
                                </div>
                            </Card>
                        }
                    </div>
                </aside>
                <div className="order-1 flex min-w-0 flex-1 flex-col gap-3 md:order-2 sm:gap-4">
                    { props.children }
                </div>
                <aside className="order-3 flex flex-col gap-3 md:w-64 md:shrink-0 xl:w-72">
                    <div className="flex flex-col gap-3">
                    <AdCarousel/>
                    {
                        props.articles && 
                        <Card className="p-4">
                            <p className="retro-label mb-3">[ RECENT ]</p>
                            <div className='flex flex-col gap-1'>
                                {
                                    props.articles?.map((item, i) => {
                                        return (
                                            <Link key={i} title={item.name.replace(/\.md$/, '')} href={`/${encodeURIComponent(item.category)}/${encodeURIComponent(item.name)}`} className="retro-link group flex items-start gap-2 px-2 py-1.5">
                                                <span className="mt-1 text-[10px] text-[var(--accent)]">&gt;</span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-sm text-[var(--fg)] transition-colors group-hover:text-[var(--accent)]">
                                                        {item.name.replace(/\.md$/, '')}
                                                    </span>
                                                    <span className="mt-0.5 flex items-center gap-1 text-[10px] tracking-[0.08em] text-[var(--muted)]">
                                                        <span className="truncate">{item.category}</span>
                                                        <span>·</span>
                                                        <span>{formatDate(item.state.createdTime)}</span>
                                                    </span>
                                                </span>
                                            </Link>
                                        )
                                    })
                                }
                            </div>
                        </Card>
                    }
                    </div>
                </aside>
            </main>
            <footer className="mx-auto w-full max-w-[1500px] px-4 pb-6 pt-1 text-center text-[10px] tracking-[0.18em] text-[var(--muted)]">
                © {new Date().getFullYear()} {OWNER_CONFIG.name} · {SITE_CONFIG.brand}
                <span className="blink ml-1 text-[var(--accent)]">_</span>
            </footer>
        </div>
    )
}
