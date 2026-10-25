import HomeIcon from "@/assets/icons/HomeIcon";
import ListIcon from "@/assets/icons/ListIcon";
import ShareIcon from "@/assets/icons/ShareIcon";
import Button from "@/components/Button";
import Card from "@/components/Card";
import Discussion from "@/components/Discussion";
import Frame from "@/components/Frame";
import Link from "@/components/Link";
import Markdown from "@/components/Markdown";
import { SITE_CONFIG } from "@/config";
import { categories as getGategories, content } from "@/utils/document";

export interface PageParams {
    category:string;    // 分类： 例如 Python 等
    article:string;     // 文章： xxx.md
}

// 生成静态页面路径
export async function generateStaticParams() {
    const paramsList:PageParams[] = []
    for (const category of await getGategories()) {
        for (const article of category.articles) {
            if (process.env.NODE_ENV === 'development') {
                paramsList.push({
                    category: encodeURIComponent(category.name),
                    article: encodeURIComponent(article.name),
                });
            } else {
                paramsList.push({
                    category: category.name,
                    article: article.name,
                });
            }
        }
    }
    
    return paramsList;
}

export default async function Page({params}:{params:Promise<PageParams>}) {
    const path = await params;
    const text = await content(decodeURIComponent(path.category), decodeURIComponent(path.article));
    const categories = await getGategories();
    const articles = categories.flatMap(category => category.articles).sort((x, y) => y.state.createdTime.getTime() - x.state.createdTime.getTime());
    const href = `${SITE_CONFIG.origin}${SITE_CONFIG.basePath}/${path.category}/${path.article}`;

    return (
        <Frame categories={categories} articles={articles.slice(0,30)}>
            <Card>
                <div className="flex justify-between">
                    <Link href='/'><HomeIcon/></Link>
                    <Link href={`/${decodeURIComponent(path.category)}`}><ListIcon/></Link>
                </div>
                <Markdown content={text} href={href}/>
            </Card>
            <Discussion/>
        </Frame>
    )
}