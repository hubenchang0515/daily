import React from "react"

export interface CardProps {
    className?: string;
    children?: React.ReactNode;
}

export default function Card(props:CardProps) {
    return (
        <div className={`retro-panel ${props.className ?? 'p-4'}`}>
            {props.children}
        </div>
    )
}
