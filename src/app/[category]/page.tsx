import HomeIcon from "@/assets/icons/HomeIcon";
import ArticleCard from "@/components/ArticleCard";
import Frame from "@/components/Frame";
import Link from "@/components/Link";
import Markdown from "@/components/Markdown";
import { DOCUMENT_CONFIG } from "@/config";
import { categories as getGategories, content } from "@/utils/document";

export interface PageParams {
    category:string;    // 分类： 例如 Python 等
}

// 生成静态页面路径
export async function generateStaticParams() {
    const paramsList:PageParams[] = []
    for (const category of await getGategories()) {
        if (process.env.NODE_ENV === 'development') {
            paramsList.push({
                category: encodeURIComponent(category.name),
            });
        } else {
            paramsList.push({
                category: category.name,
            });
        }
    }
    
    return paramsList;
}

export default async function Page({params}:{params:Promise<PageParams>}) {
    const path = await params;
    const categories = await getGategories();
    const category = categories.find((item) => item.name === decodeURIComponent(path.category));
    const articles = categories.flatMap(category => category.articles).sort((x, y) => y.state.createdTime.getTime() - x.state.createdTime.getTime());
    const last = Math.ceil((category?.articles.length??0) / DOCUMENT_CONFIG.pageSize);

    return (
        <Frame categories={categories} articles={articles.slice(0, 30)}>
            <div className="bg-white dark:bg-[#161B22] rounded-md shadow-md p-2 flex justify-between">
                <Link>上一页</Link>
                <Link href='/'><HomeIcon/></Link>
                <Link href={last > 1 ? `/${path.category}/page/2` : undefined}>下一页</Link>
            </div>
            {
                category?.articles.slice(0, DOCUMENT_CONFIG.pageSize).map((article, i) => {
                    return (
                        <ArticleCard key={i} {...article}/>
                    )
                })
            }
            <div className="bg-white dark:bg-[#161B22] rounded-md shadow-md p-2 flex justify-between">
                <Link>上一页</Link>
                <Link href='/'><HomeIcon/></Link>
                <Link href={last > 1 ? `/${path.category}/page/2` : undefined}>下一页</Link>
            </div>
        </Frame>
    )
}