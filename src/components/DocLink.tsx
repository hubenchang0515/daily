import { Language } from "@/config";
import { getPrimerLink, primerKey } from "@/utils/primers";
import { CODE_LINK_CLASS } from "./linkStyles";

export interface DocLinkProps {
    text: string;
    lang: string | string[];
    language?: Language;    // 文章语言，决定使用哪一组 Primers 链接
    allow?: Set<string>;    // 当前代码块内允许转换的文档
    used?: Set<string>;     // 当前代码块内已经转换过的文档
}

export default function DocLink(props:DocLinkProps) {
    const href = getPrimerLink(props.text, props.lang, props.language);
    const key = href ? primerKey(href) : undefined;
    const enabled = Boolean(href) && key !== undefined
        && (!props.allow || props.allow.has(key))
        && (!props.used || !props.used.has(key));

    if (href && key !== undefined && enabled) {
        props.used?.add(key);
        return <a href={href} className={CODE_LINK_CLASS} style={{ color: 'unset' }} target="_blank" rel="noreferrer">{props.text}</a>
    } else {
        return <span>{props.text}</span>
    }
}
