"use client";

type Theme = "light" | "dark";

function applyTheme(theme: Theme) {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
}

export default function ThemeToggle() {
    function toggleTheme() {
        const isDark = document.documentElement.dataset.theme === "dark";
        applyTheme(isDark ? "light" : "dark");
    }

    return (
        <button
            type="button"
            onClick={toggleTheme}
            className="retro-button inline-flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[11px] tracking-[0.16em]"
            aria-label="切换浅色 / 深色主题"
            title="切换浅色 / 深色主题"
        >
            <span className="h-2 w-2 bg-[var(--accent)] shadow-[0_0_8px_var(--accent)]" />
            <span className="hidden sm:inline">
                <span className="theme-light-only">LIGHT</span>
                <span className="theme-dark-only">DARK</span>
            </span>
        </button>
    )
}
