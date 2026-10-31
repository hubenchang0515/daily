"use client";
import Giscus from '@giscus/react';
import { useEffect, useState } from 'react';
import Card from './Card';

type Theme = 'light' | 'dark';

function currentTheme(): Theme {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export default function Discussion() {
    const [theme, setTheme] = useState<Theme>('light');

    useEffect(() => {
        const root = document.documentElement;
        const sync = () => setTheme(currentTheme());

        sync();
        const observer = new MutationObserver(sync);
        observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
        return () => observer.disconnect();
    }, []);

    return (
        <Card className="p-0">
            <div className="flex items-center gap-2 border-b-2 border-[var(--border)] bg-[var(--panel-2)] px-4 py-2">
                <span className="h-2 w-2 bg-[var(--accent)] shadow-[0_0_6px_var(--accent)]" />
                <h2 className="text-[10px] font-semibold tracking-[0.2em] text-[var(--muted)]">[ COMMENTS ]</h2>
            </div>
            <div className="p-4">
                <Giscus
                    id="comments"
                    repo="hubenchang0515/comments"
                    repoId="R_kgDOQCfF2Q"
                    category="Announcements"
                    categoryId="DIC_kwDOQCfF2c4CwpFg"
                    mapping="url"
                    term="Welcome to @giscus/react component!"
                    reactionsEnabled="1"
                    emitMetadata="0"
                    inputPosition="top"
                    theme={theme === 'dark' ? 'gruvbox_dark' : 'gruvbox_light'}
                    lang='zh-CN'
                    loading="lazy"
                    strict="1"
                />
            </div>
        </Card>
    );
}