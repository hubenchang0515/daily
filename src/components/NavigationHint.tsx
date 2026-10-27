"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useCallback } from "react";

const SHOW_DELAY = 150;      // 跳转太快时不闪烁，延迟一小会儿再显示
const SAFETY_TIMEOUT = 5000; // 跳转失败或超时后的兜底隐藏时间

function isInternalNavigation(anchor: HTMLAnchorElement, event: MouseEvent): boolean {
    if (event.button !== 0) return false;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    if (anchor.target && anchor.target !== "_self") return false;
    if (anchor.hasAttribute("download")) return false;
    if (anchor.getAttribute("href")?.startsWith("#")) return false;

    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin) return false;

    // 同页锚点、空链接（href=""）都不算页面跳转
    return url.pathname !== window.location.pathname || url.search !== window.location.search;
}

export default function NavigationHint() {
    const pathname = usePathname();
    const [visible, setVisible] = useState(false);
    const showTimer = useRef<number | undefined>(undefined);
    const hideTimer = useRef<number | undefined>(undefined);

    const clearTimers = useCallback(() => {
        window.clearTimeout(showTimer.current);
        window.clearTimeout(hideTimer.current);
    }, []);

    useEffect(() => {
        // 路由变化即视为跳转完成
        clearTimers();
        setVisible(false);
    }, [pathname, clearTimers]);

    useEffect(() => {
        const hide = () => {
            clearTimers();
            setVisible(false);
        };

        const onClick = (event: MouseEvent) => {
            const target = event.target;
            if (!(target instanceof Element)) return;

            const anchor = target.closest("a[href]");
            if (!(anchor instanceof HTMLAnchorElement)) return;
            if (!isInternalNavigation(anchor, event)) return;

            clearTimers();
            showTimer.current = window.setTimeout(() => setVisible(true), SHOW_DELAY);
            hideTimer.current = window.setTimeout(() => setVisible(false), SAFETY_TIMEOUT);
        };

        document.addEventListener("click", onClick, true);
        window.addEventListener("popstate", hide);

        return () => {
            document.removeEventListener("click", onClick, true);
            window.removeEventListener("popstate", hide);
            clearTimers();
        };
    }, [clearTimers]);

    if (!visible) return null;

    return (
        <div className="nav-hint" role="status" aria-live="polite">
            <span className="blink" aria-hidden="true">▶</span>
            <span>正在跳转…</span>
        </div>
    );
}
