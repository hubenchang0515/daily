// 正文链接样式：悬停时下划线由点状变为实线
export const ARTICLE_LINK_CLASS = 'text-[var(--accent-2)] underline decoration-dotted underline-offset-4 hover:text-[var(--accent)] hover:decoration-solid';

// 代码块内链接：不设置颜色，沿用 Prism 语法高亮的颜色（等价于 color: unset）
export const CODE_LINK_CLASS = 'underline decoration-dotted underline-offset-4 hover:decoration-solid';
