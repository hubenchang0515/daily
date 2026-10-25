import ReactMarkdown, { Components } from 'react-markdown'
import Image from './Image';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus as highlight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import Link from './Link';
import DocLink from './DocLink';

export async function hash(algorithm:string, data:BufferSource) {
    const hashBuffer = await crypto.subtle.digest(algorithm, data);
    const hashArray = Array.from(new Uint8Array(hashBuffer)); // convert buffer to byte array
    const hashHex = hashArray
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""); // convert bytes to hex string
    return hashHex;
}

// 哈希锚点
export async function anchorHash(text:string) {
    return (await hash('SHA-256', new TextEncoder().encode(text))).substring(0, 6);
}

export interface MarkdownProps {
    content:string;
    href:string;
}

function CodeNode(props:{node:rendererNode, stylesheet: { [key: string]: React.CSSProperties }, context:string, rows:number}) {
    if (props.node.type === 'text') {
        if (props.node.value === undefined || props.node.value === "") {                        // 空字符串
            return null
        } else if (/^\s+$/.test(props.node.value.toString())) {                                 // 空白字符串
            return <span>{props.node.value}</span>
        } else if (/^\S+$/.test(props.node.value.toString())) {                                 // 不含空白字符
            return <DocLink text={props.node.value.toString()} lang={props.context}/>
        } else {
            const items = props.node.value.toString().split(/(\s+)/)
            return items.map((item, i) => <CodeNode key={i} {...props} node={{type:'text', value:item}}/>)
        }
        
    } else if (props.node.type === 'element') {
        const style = props.node.properties?.className.reduce((result, name) => {
            result = {...result, ...props.stylesheet[name]};
            return result;
        }, {});
        if (props.node.properties?.className?.includes('linenumber')) {
            style.display = "inline-block";
            style.minWidth = `${props.rows}em`;
            style.paddingRight = "1em";
            style.textAlign = "right";
            style.userSelect = "none";
        }
        return <span className={props.node.properties?.className.join(" ")} style={style}>
        {
            props.node.children?.map((subnode, i) => <CodeNode key={i} {...props} node={subnode} />)
        }
        </span>
    }
}

export default function Markdown(props: MarkdownProps) {
    
    return (
        <article className='markdown-body text-[15px] leading-7 text-[var(--fg)]'>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={MakeComponents(props.href)}
            >
                {props.content}
            </ReactMarkdown>
        </article>
    )
}

const MakeComponents = (href:string):Components => {
    return {
        async h1(props) { 
            return (
                <h1 className='my-6 border-b-2 border-dashed border-[var(--border)] pb-4 text-center text-3xl font-bold tracking-[0.08em] text-[var(--accent)]'>
                    <Link 
                        href={href} className='transition-opacity hover:opacity-80'
                    >
                    {props.children}
                    </Link>
                </h1>
            )
        },

        async h2(props) { 
            const anchor = await anchorHash(props.children?.toString()??'');
            return (
                <h2 id={anchor} className='my-5 scroll-mt-20 border-s-4 border-[var(--accent-2)] ps-3 text-2xl font-bold text-[var(--accent)]'>
                    <Link 
                        href={href + `#` + anchor}
                        className='transition-opacity hover:opacity-80'
                    >
                        {props.children}
                    </Link>
                </h2>
            )
        },

        async h3(props) { 
            const anchor = await anchorHash(props.children?.toString()??'');
            return (
                <h3 id={anchor} className='my-4 scroll-mt-20 text-xl font-bold text-[var(--accent-2)]'>
                    <Link 
                        href={href + `#` + anchor}
                        className='transition-opacity hover:opacity-80'
                    >
                        {props.children}
                    </Link>
                </h3>
            )
        },

        async h4(props) { 
            const anchor = await anchorHash(props.children?.toString()??'');
            return (
                <h4 id={anchor} className='my-3 text-lg font-bold text-[var(--fg)]'>
                    <Link 
                        href={href + `#` + anchor}
                        className='transition-opacity hover:opacity-80'
                    >
                        {props.children}
                    </Link>
                </h4>
            )
        },

        async h5(props) { 
            const anchor = await anchorHash(props.children?.toString()??'');
            return (
                <h5 id={anchor} className='my-2 text-base font-bold text-[var(--muted)]'>
                    <Link 
                        href={href + `#` + anchor}
                        className='transition-opacity hover:opacity-80'
                    >
                        {props.children}
                    </Link>
                </h5>
            )
        },

        async h6(props) { 
            const anchor = await anchorHash(props.children?.toString()??'');
            return (
                <h6 id={anchor} className='my-2 text-sm font-bold text-[var(--muted)]'>
                    <Link 
                        href={href + `#` + anchor}
                        className='transition-opacity hover:opacity-80'
                    >
                        {props.children}
                    </Link>
                </h6>
            )
        },

        async p(props) { 
            return (
                <p className='my-3 leading-7'>{props.children}</p>
            )
        },

        async blockquote(props) {
            return (
                <blockquote className='my-4 border border-[var(--border)] border-s-4 border-s-[var(--accent-2)] bg-[var(--panel-2)] px-3 py-1 text-[var(--muted)]'>
                    {props.children}
                </blockquote>
            )
        },

        async table(props) {
            return (
                <table className='my-4 mx-auto max-w-full border-2 border-[var(--border)] bg-[var(--panel)]'>
                    { props.children }
                </table>
            )
        },

        async thead(props) {
            return <thead>{ props.children }</thead>
        },

        async tbody(props) {
            return <tbody>{ props.children }</tbody>
        },

        async tr(props) {
            return <tr>{ props.children }</tr>
        },

        async th(props) {
            const align = props.node?.properties.align as "center" | "right" | "left" | "justify" | "char" | undefined
            return <th align={align} className='border border-[var(--border)] bg-[var(--panel-2)] p-2 font-bold'>{ props.children }</th>
        },

        async td(props) {
            const align = props.node?.properties.align as "center" | "right" | "left" | "justify" | "char" | undefined
            return <td align={align} className='border border-[var(--border)] p-2'>{ props.children }</td>
        },

        async ol(props) {
            return <ol className='my-3 ml-8 list-decimal space-y-1 marker:text-[var(--accent)]'>{ props.children} </ol>
        },

        async ul(props) {
            return <ul className='my-3 ml-8 list-disc space-y-1 marker:text-[var(--accent)]'>{ props.children} </ul>
        },

        async li(props) {
            return <li>{props.children}</li>
        },

        img({ src, alt }) {
            return <Image src={src as string} alt={alt} style={{display:'block', margin:'auto', maxWidth:'80%', height:'auto',}}/>
        },

        pre({children}) {
            return <div>{children}</div>
        },

        a({href, title, children}) {
            return <Link href={href} title={title} className='text-[var(--accent-2)] underline decoration-dotted underline-offset-4 hover:text-[var(--accent)]'>{children}</Link>
        },

        code({className, children}) {
            const match = /language-(\w+)/.exec(className || '');

            if (match) {
                const lang = match[1].toLocaleLowerCase();
                return (
                    <SyntaxHighlighter
                        showLineNumbers
                        style={highlight}
                        className={className} 
                        language={lang === 'shell' ? 'shell-session' : lang}
                        renderer={({ rows, stylesheet }) => {
                            return (
                                <code className={className} style={{whiteSpace:'pre'}}>
                                {
                                    rows.map((row) => {
                                        return row.children?.map((node, i) => <CodeNode key={i} node={node} stylesheet={stylesheet} context={match[1]} rows={rows.length.toString().length}/>)
                                    })
                                }
                                </code>
                            )
                        }}
                    >
                        {String(children).replace(/\n$/, '')}
                    </SyntaxHighlighter>
                )
            } else if(children?.toString().includes('\n')) {
                return (
                    <SyntaxHighlighter
                        showLineNumbers
                        style={highlight}
                        className={className}
                    >
                        {String(children).replace(/\n$/, '')}
                    </SyntaxHighlighter>
                )
            } else {
                return (
                    <code className="border border-[var(--border)] bg-[var(--panel-2)] px-1 text-[var(--accent-2)]">
                        {children}
                    </code>
                )
            }
        }
    }
}