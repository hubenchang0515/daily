import HomeIcon from "@/assets/icons/HomeIcon";
import ArticleCard from "@/components/ArticleCard";
import Frame from "@/components/Frame";
import Link from "@/components/Link";
import { DOCUMENT_CONFIG } from "@/config";
import { categories as getGategories } from "@/utils/document";

export default async function Home() {
    const categories = await getGategories();
    const articles = categories.flatMap(category => category.articles).sort((x, y) => y.state.createdTime.getTime() - x.state.createdTime.getTime());
    const last = Math.ceil(articles.length / DOCUMENT_CONFIG.pageSize);

    return (
        <Frame categories={categories} articles={articles.slice(0,30)}>
            {
                articles.slice(0, DOCUMENT_CONFIG.pageSize).map((article, i) => {
                    return (
                        <ArticleCard key={i} {...article}/>
                    )
                })
            }
            <div className="bg-white dark:bg-[#161B22] rounded-md shadow-md p-2 flex justify-between">
                <Link>上一页</Link>
                <Link href='/'><HomeIcon/></Link>
                <Link href={last > 1? `/page/2` : undefined}>下一页</Link>
            </div>
            
        </Frame>
    );
}
