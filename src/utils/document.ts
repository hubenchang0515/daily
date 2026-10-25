import path from "path";
import fs from 'fs/promises';
import { DOCUMENT_CONFIG } from "@/config";
import { execFile } from "child_process";

export interface State {
    createdTime: Date;
    updatedTime: Date;
}

export interface Article {
    name: string;
    category: string;
    state: State;
}

export interface Category {
    name: string;
    articles: Article[];
}

// 获取文档状态（创建与更新时间）
export async function state(category:string, article:string): Promise<State> {
    const dir = path.join(process.cwd(), DOCUMENT_CONFIG.root);
    const file = path.join(process.cwd(), DOCUMENT_CONFIG.root, "document", category, article);

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
export async function articles(category:string): Promise<Article[]> {
    const dir = path.join(process.cwd(), DOCUMENT_CONFIG.root, 'document', category);
    const files = (await fs.readdir(dir, { withFileTypes: true }));
    const results = await Promise.all(files.filter(file=>!file.isDirectory()).map(async (file) => ({name:file.name, category:category, state: await state(category, file.name)})));
    return results.sort((x, y) => y.state.createdTime.getTime() - x.state.createdTime.getTime());
}

// 获取分类列表
export async function categories(): Promise<Category[]> {
    const dir = path.join(process.cwd(), DOCUMENT_CONFIG.root, 'document');
    const files = (await fs.readdir(dir, { withFileTypes: true }));
    const results =  await Promise.all(files.filter(file=>file.isDirectory()).map(async (file) => ({name:file.name, articles: await articles(file.name)})));
    return results.sort((x, y) => y.articles.length - x.articles.length);
}

// 获取文档内容
export async function content(category:string, article:string) {
    try {
        const file = path.join(process.cwd(), DOCUMENT_CONFIG.root, 'document', category, article);
        const text = await fs.readFile(file, 'utf-8');
        return text;
    } catch (err) {
        throw err;
    }
}
