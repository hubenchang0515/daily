import { DOCUMENT_CONFIG } from "@/config";
import path from "path";
import fs from 'fs/promises';
import probe from 'probe-image-size'

export interface ImageInfo {
    width: number;
    height: number;
    src: string;
}

export async function imageInfo(filepath:string, absolute?:boolean): Promise<ImageInfo> {
    const file = absolute ? filepath : path.join(process.cwd(), DOCUMENT_CONFIG.root, filepath);
    const fp = await fs.open(file);
    const info = await probe(fp.createReadStream());
    const base64 = (await fs.readFile(file)).toString('base64');
    return {
        width: info.width,
        height: info.height,
        src: `data:${info.mime};base64,${base64}`
    }
}