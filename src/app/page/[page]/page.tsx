import HomeIcon from "@/assets/icons/HomeIcon";
import ArticleCard from "@/components/ArticleCard";
import Frame from "@/components/Frame";
import Link from "@/components/Link";
import { DOCUMENT_CONFIG } from "@/config";
import { categories as getGategories } from "@/utils/document";

export interface PageParams {
    page:string;    // 页码
}

// 生成静态页面路径
export async function generateStaticParams() {
    const paramsList:PageParams[] = []
    const categories = await getGategories();
    const articles = categories.flatMap(category => category.articles).sort((x, y) => y.state.createdTime.getTime() - x.state.createdTime.getTime());
    for (let i = 1; i <= Math.ceil(articles.length / DOCUMENT_CONFIG.pageSize); i += 1) {
        paramsList.push({
            page: `${i}`,
        });
    }
    
    return paramsList;
}

export default async function Page({params}:{params:Promise<PageParams>}) {
    const categories = await getGategories();
    const articles = categories.flatMap(category => category.articles).sort((x, y) => y.state.createdTime.getTime() - x.state.createdTime.getTime());
    const path = await params;
    const page = Number(path.page);
    const last = Math.ceil(articles.length / DOCUMENT_CONFIG.pageSize);

    return (
        <Frame categories={categories} articles={articles.slice(0, 30)}>
            <div className="bg-white dark:bg-[#161B22] rounded-md shadow-md p-2 flex justify-between">
                <Link href={page > 1 ? `/page/${page-1}` : undefined}>上一页</Link>
                <Link href='/'><HomeIcon/></Link>
                <Link href={page < last ? `/page/${page+1}` : undefined}>下一页</Link>
            </div>
            {
                articles.slice((page - 1)*DOCUMENT_CONFIG.pageSize, (page)*DOCUMENT_CONFIG.pageSize).map((article, i) => {
                    return (
                        <ArticleCard key={i} {...article}/>
                    )
                })
            }
            <div className="bg-white dark:bg-[#161B22] rounded-md shadow-md p-2 flex justify-between">
                <Link href={page > 1 ? `/page/${page-1}` : undefined}>上一页</Link>
                <Link href='/'><HomeIcon/></Link>
                <Link href={page < last ? `/page/${page+1}` : undefined}>下一页</Link>
            </div>
        </Frame>
    );
}
