"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useCallback } from "react";

const MIN_VISIBLE = 300;     // 命中缓存秒开时，也保证提示可见约 300ms
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
    const shownAt = useRef(0);
    const hideTimer = useRef<number | undefined>(undefined);

    const clearHideTimer = useCallback(() => {
        window.clearTimeout(hideTimer.current);
    }, []);

    const hide = useCallback(() => {
        clearHideTimer();
        shownAt.current = 0;
        setVisible(false);
    }, [clearHideTimer]);

    useEffect(() => {
        // 路由已变化；未展示满 MIN_VISIBLE 时延后隐藏，避免秒开时一闪而过
        clearHideTimer();
        if (shownAt.current === 0) return;

        const remaining = MIN_VISIBLE - (performance.now() - shownAt.current);
        if (remaining > 0) {
            hideTimer.current = window.setTimeout(hide, remaining);
        } else {
            hide();
        }
    }, [pathname, clearHideTimer, hide]);

    useEffect(() => {
        const onClick = (event: MouseEvent) => {
            const target = event.target;
            if (!(target instanceof Element)) return;

            const anchor = target.closest("a[href]");
            if (!(anchor instanceof HTMLAnchorElement)) return;
            if (!isInternalNavigation(anchor, event)) return;

            clearHideTimer();
            shownAt.current = performance.now();
            setVisible(true);
            hideTimer.current = window.setTimeout(hide, SAFETY_TIMEOUT);
        };

        document.addEventListener("click", onClick, true);
        window.addEventListener("popstate", hide);

        return () => {
            document.removeEventListener("click", onClick, true);
            window.removeEventListener("popstate", hide);
            clearHideTimer();
        };
    }, [clearHideTimer, hide]);

    if (!visible) return null;

    return (
        <div className="nav-hint" role="status" aria-live="polite">
            <span className="blink" aria-hidden="true">▶</span>
            <span>正在跳转…</span>
        </div>
    );
}
