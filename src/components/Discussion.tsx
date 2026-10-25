"use client";
import Giscus from '@giscus/react';
import Card from './Card';

export default function Discussion() {
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
                    theme='preferred_color_scheme'
                    lang='zh-CN'
                    loading="lazy"
                    strict="1"
                />
            </div>
        </Card>
    );
}