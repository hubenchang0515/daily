"use client";
import Giscus from '@giscus/react';
import Card from './Card';

export default function Discussion() {
    return (
        <Card>
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
        </Card>
    );
}