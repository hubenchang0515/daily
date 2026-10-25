import { LINKS, OWNER_CONFIG } from "@/config";
import React from "react";
import Link from "./Link";
import Card from './Card';
import { Article, Category } from "@/utils/document";

export interface FrameProps
{
    categories?: Category[];
    articles?: Article[];
    children?: React.ReactNode;
}

export default function Frame(props:FrameProps)
{
    return (
        <div>
            <main className="w-full max-w-[1600px] m-auto p-2 flex flex-col md:flex-row gap-2">
                <aside className="order-2 md:order-1 md:w-60 xl:w-90">
                    <div className="flex flex-col gap-2">
                        <Card>
                            <p><Link className="block border border-transparent hover:border-emerald-500" href="/"><img src={OWNER_CONFIG.avatar} className="w-40 m-auto my-1"/></Link></p>
                            <p className="text-xl font-bold"><Link href="/">{OWNER_CONFIG.name}</Link></p>
                            <p className="text-gray-400"><Link href={`https://github.com/${OWNER_CONFIG.username}`}>{OWNER_CONFIG.username}</Link></p>
                            <p>{OWNER_CONFIG.brief}</p>
                        </Card>
                        <Card>
                            <div className='grid grid-cols-[repeat(auto-fill,minmax(50px,1fr))] gap-2'>
                                {
                                    LINKS.map((item, i) => {
                                        return (
                                            <Link key={i} href={item.url} title={item.title}>
                                                <img src={item.icon} className="p-1" />
                                            </Link>
                                        )
                                    })
                                }
                            </div>
                        </Card>
                        {
                            props.categories && 
                            <Card>
                                <div className='flex flex-col gap-2'>
                                    {
                                        props.categories?.map((item, i) => {
                                            return (
                                                <Link key={i} href={`/${encodeURIComponent(item.name)}`} title={item.name}>
                                                    <span className="px-1 flex justify-between">
                                                        <span className="truncate">{item.name}</span>
                                                        <span>{item.articles.length}</span>
                                                    </span>
                                                </Link>
                                            )
                                        })
                                    }
                                </div>
                            </Card>
                        }
                    </div>
                </aside>
                <div className="order-1 md:order-2 flex-1 flex flex-col gap-2 overflow-hidden">
                    { props.children }
                </div>
                <aside className="order-3 md:w-60 xl:w-90">
                    <div className="flex flex-col gap-2">
                    {
                        props.articles && 
                        <Card>
                            <div className='flex flex-col gap-2'>
                                {
                                    props.articles?.map((item, i) => {
                                        return (
                                            <Link key={i} title={item.name.replace(/\.md$/, '')} href={`/${encodeURIComponent(item.category)}/${encodeURIComponent(item.name)}`}>
                                                <div className='truncate px-1'>
                                                    {item.name.replace(/\.md$/, '')}
                                                </div>
                                            </Link>
                                        )
                                    })
                                }
                            </div>
                        </Card>
                    }
                    </div>
                </aside>
            </main>
        </div>
    )
}