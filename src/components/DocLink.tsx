import { getPrimerLink } from "@/utils/primers";

export interface DocLinkProps {
    text: string;
    lang: string | string[];
}

export default function DocLink(props:DocLinkProps) {
    const href = getPrimerLink(props.text, props.lang);

    if (href) {
        return <a href={href} style={{color:'unset', textDecoration:'underline'}} target="_blank">{props.text}</a>
    } else {
        return <span>{props.text}</span>
    }
}
