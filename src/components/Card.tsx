import React from "react"

export interface CardProps {
    className?: string;
    children?: React.ReactNode;
}

export default function Card(props:CardProps) {
    return (
        <div className={props.className || 'bg-white dark:bg-[#161B22] border border-transparent dark:border-[#30363d] rounded-md p-2'}>
            {props.children}
        </div>
    )
}