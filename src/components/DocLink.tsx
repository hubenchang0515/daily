import { getPrimerSitemap } from "@/utils/primers";

export interface DocLinkProps {
    text: string;
    lang: string;
}

export default function DocLink(props:DocLinkProps) {
    const sitemap = getPrimerSitemap();
    const links = sitemap[props.lang]?.links;
    const key = props.text.replace(/^\W+|\W+$/g, '');
    const href = links && Object.hasOwn(links, key) ? links[key] : undefined;
    
    if (href) {
        return <a href={href} style={{color:'unset', textDecoration:'underline'}} target="_blank">{props.text}</a>
    } else {
        return <span>{props.text}</span>
    }
}
