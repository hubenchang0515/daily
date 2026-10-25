"use client";

import NextLink from "next/link";
import { SITE_CONFIG } from '@/config';
import React from "react";

export interface LinkProps {
    className?: string;
    href?: string;
    title?: string;
    children?: React.ReactNode;
}

export default function Link(props:LinkProps) {

    if (!props.href) {
        return <NextLink className={props.className ?? "cursor-default text-transparent"} prefetch={false} {...props} href="" onClick={(ev)=>ev.preventDefault()}/>
    }

    if (props.href.toString().startsWith("http") && !props.href.toString().startsWith(SITE_CONFIG.origin + SITE_CONFIG.basePath)) {
        return <NextLink className={props.className ?? "border border-transparent hover:border-emerald-500"} prefetch={false} target="_blank" rel="noopener" href={props.href} {...props} />
    }
    
    return (
        <NextLink className={props.className ?? "border border-transparent hover:border-emerald-500"} prefetch={false} href={props.href} {...props}/>
    )
}