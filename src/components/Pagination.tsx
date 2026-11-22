import HomeIcon from "@/assets/icons/HomeIcon";
import { DEFAULT_LANGUAGE, LANGUAGE_CONFIG, Language } from "@/config";
import { languagePath } from "@/utils/seo";
import Link from "./Link";

export interface PaginationProps {
    language?: Language;
    previous?: string;
    next?: string;
    page?: number;
    last?: number;
}

export default function Pagination(props: PaginationProps) {
    const language = props.language ?? DEFAULT_LANGUAGE;
    const config = LANGUAGE_CONFIG[language];
    const item = 'inline-flex items-center gap-1 px-3 py-1.5 text-xs tracking-[0.14em]';
    const disabled = 'cursor-not-allowed border border-dashed border-[var(--border)] px-3 py-1.5 text-xs tracking-[0.14em] text-[var(--muted)] opacity-50';

    return (
        <nav
            aria-label={config.ui.previousPage + ' / ' + config.ui.nextPage}
            className="retro-panel flex items-center justify-between gap-2 px-3 py-2"
        >
            {
                props.previous
                    ? <Link href={props.previous} className={`${item} retro-button`}>[ ← {config.ui.previousPage} ]</Link>
                    : <span className={disabled}>[ ← {config.ui.previousPage} ]</span>
            }
            <div className="flex items-center gap-2">
                <Link href={languagePath(language)} title={config.ui.home} className={`${item} retro-button`}>
                    <span className="[&_svg]:h-4 [&_svg]:w-4"><HomeIcon/></span>
                </Link>
                {
                    props.page && props.last
                        ? <span className="text-[10px] tracking-[0.18em] text-[var(--muted)]">PAGE {props.page} / {props.last}</span>
                        : null
                }
            </div>
            {
                props.next
                    ? <Link href={props.next} className={`${item} retro-button`}>[ {config.ui.nextPage} → ]</Link>
                    : <span className={disabled}>[ {config.ui.nextPage} → ]</span>
            }
        </nav>
    );
}
