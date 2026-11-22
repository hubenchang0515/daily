import path from "path";
import fs from 'fs/promises';
import { DOCUMENT_CONFIG, Language } from "@/config";
import { execFile } from "child_process";

export interface State {
    createdTime: Date;
    updatedTime: Date;
}

export interface Article {
    name: string;
    category: string;
    language: Language;
    state: State;
}

export interface Category {
    name: string;
    articles: Article[];
}

function documentDir(language: Language, category?: string): string {
    return path.join(process.cwd(), DOCUMENT_CONFIG.root, "document", language, ...(category ? [category] : []));
}

// 获取文档状态（创建与更新时间）
export async function state(language: Language, category:string, article:string): Promise<State> {
    const dir = path.join(process.cwd(), DOCUMENT_CONFIG.root);
    const file = path.join(documentDir(language, category), article);

    return new Promise((resolve) => {
        execFile('git', ['-C', dir, 'log', '--format="%ai"', file], (err, stdout) => {
            if (err || stdout.trim().length === 0) {
                if (err) {
                    // console.error(err);
                }

                resolve({
                    createdTime: new Date(),
                    updatedTime: new Date(),
                });
            } else {
                const lines = stdout.split("\n").filter(Boolean);
                resolve({
                    createdTime: new Date(lines[lines.length - 1]),
                    updatedTime: new Date(lines[0]),
                });
            }
        })
    })
}

// 获取文章列表
export async function articles(language: Language, category:string): Promise<Article[]> {
    const dir = documentDir(language, category);
    let files;
    try {
        files = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw err;
    }

    const results = await Promise.all(files.filter(file=>!file.isDirectory()).map(async (file) => ({
        name:file.name,
        category:category,
        language,
        state: await state(language, category, file.name),
    })));
    return results.sort((x, y) => y.state.createdTime.getTime() - x.state.createdTime.getTime());
}

// 获取分类列表
export async function categories(language: Language): Promise<Category[]> {
    const dir = documentDir(language);
    let files;
    try {
        files = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw err;
    }

    const results = await Promise.all(files.filter(file=>file.isDirectory()).map(async (file) => ({
        name:file.name,
        articles: await articles(language, file.name),
    })));
    return results
        .filter((category) => category.articles.length > 0)
        .sort((x, y) => y.articles.length - x.articles.length);
}

// 获取文档内容
export async function content(language: Language, category:string, article:string) {
    try {
        const file = path.join(documentDir(language, category), article);
        const text = await fs.readFile(file, 'utf-8');
        return text;
    } catch (err) {
        throw err;
    }
}
