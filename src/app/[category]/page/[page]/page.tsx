import HomeIcon from "@/assets/icons/HomeIcon";
import ArticleCard from "@/components/ArticleCard";
import Frame from "@/components/Frame";
import Link from "@/components/Link";
import { DOCUMENT_CONFIG } from "@/config";
import { categories as getGategories } from "@/utils/document";

export interface PageParams {
    category:string;    // 分类： 例如 Python 等
    page:string;        // 页码
}

// 生成静态页面路径
export async function generateStaticParams() {
    const paramsList:PageParams[] = []
    const categories = await getGategories();
    for (const category of categories) {
        for (let i = 1; i <= Math.ceil(category.articles.length / DOCUMENT_CONFIG.pageSize); i += 1) {
            if (process.env.NODE_ENV === 'development') {
                paramsList.push({
                    category: encodeURIComponent(category.name),
                    page: `${i}`,
                });
            } else {
                paramsList.push({
                    category: category.name,
                    page: `${i}`,
                });
            }
            
        }
    }
    
    
    return paramsList;
}

export default async function Page({params}:{params:Promise<PageParams>}) {
    const categories = await getGategories();
    const articles = categories.flatMap(category => category.articles).sort((x, y) => y.state.createdTime.getTime() - x.state.createdTime.getTime());
    const path = await params;
    const category = categories.find((item) => item.name === decodeURIComponent(path.category));
    const page = Number(path.page);
    const last = Math.ceil((category?.articles.length??0) / DOCUMENT_CONFIG.pageSize);

    return (
        <Frame categories={categories} articles={articles.slice(0, 30)}>
            <div className="bg-white dark:bg-[#161B22] rounded-md shadow-md p-2 flex justify-between">
                <Link href={page > 1 ? `/${path.category}/page/${page-1}` : undefined}>上一页</Link>
                <Link href='/'><HomeIcon/></Link>
                <Link href={page < last ? `/${path.category}/page/${page+1}` : undefined}>下一页</Link>
            </div>
            {
                category?.articles.slice((page - 1)*DOCUMENT_CONFIG.pageSize, (page)*DOCUMENT_CONFIG.pageSize).map((article, i) => {
                    return (
                        <ArticleCard key={i} {...article}/>
                    )
                })
            }
            <div className="bg-white dark:bg-[#161B22] rounded-md shadow-md p-2 flex justify-between">
                <Link href={page > 1 ? `/${path.category}/page/${page-1}` : undefined}>上一页</Link>
                <Link href='/'><HomeIcon/></Link>
                <Link href={page < last ? `/${path.category}/page/${page+1}` : undefined}>下一页</Link>
            </div>
        </Frame>
    );
}
