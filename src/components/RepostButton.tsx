"use client";

import ShareIcon from "@/assets/icons/ShareIcon";
import { useEffect, useRef, useState } from "react";

export interface RepostButtonProps {
    content: string;
}

async function copyText(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
}

export default function RepostButton(props: RepostButtonProps) {
    const [copied, setCopied] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

    useEffect(() => () => clearTimeout(timer.current), []);

    const handleClick = async () => {
        try {
            await copyText(props.content);
            setCopied(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('复制失败:', err);
        }
    };

    return (
        <button
            type="button"
            onClick={handleClick}
            title="转载（复制 Markdown）"
            className="retro-button inline-flex cursor-pointer items-center gap-1.5 px-2 py-1 text-[10px] tracking-[0.12em]"
        >
            <span className="[&_svg]:h-4 [&_svg]:w-4"><ShareIcon/></span>
            <span aria-live="polite">{copied ? '已复制' : '转载'}</span>
        </button>
    );
}
