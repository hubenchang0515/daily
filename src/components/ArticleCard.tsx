import { content, type Article as ArticleProps} from '@/utils/document'
import Markdown from './Markdown';
import Link from './Link';
import Card from './Card';

export default async function ArticleCard(props:ArticleProps) {
    const text = await content(props.category, props.name);
    return (
        <Card className="bg-white dark:bg-[#161B22] dark:border dark:border-[#30363d] rounded-md shadow-md">
            <div className='p-2 '>
                <Markdown 
                    content={text.split('\n').slice(0, 10).join('\n')}
                    href={`/${encodeURIComponent(props.category)}/${encodeURIComponent(props.name)}`} 
                />
            </div>
            <Link 
                href={`/${encodeURIComponent(props.category)}/${encodeURIComponent(props.name)}`} 
                className='flex justify-center items-center border-t border-[rgba(0,0,0,0.1)] dark:border-[#30363d] rounded-bl-md rounded-br-md hover:bg-emerald-500'
            >
                查看全文
            </Link>
        </Card>
    )
}