"use client";

import { useEffect } from "react";
import { SITE_CONFIG } from "@/config";

export default function LegacyRedirect() {
    useEffect(() => {
        try {
            const basePath = SITE_CONFIG.basePath;
            let pathname = window.location.pathname;
            if (basePath && pathname.startsWith(basePath)) {
                pathname = pathname.slice(basePath.length) || "/";
            }

            const first = (pathname.split("/").filter(Boolean)[0] ?? "").toLowerCase();
            if (first && first !== "zh" && first !== "en") {
                window.location.replace(`${basePath}/zh${pathname}${window.location.search}${window.location.hash}`);
                return;
            }
        } catch {}

        document.documentElement.dataset.notFoundReady = "true";
    }, []);

    return null;
}
