import React from "react";

export interface ButtonProps {
    className?: string;
    children?: React.ReactNode;
    onClock?: ()=>void;
}

export default function Button(props:ButtonProps) {
    return (
        <button onClick={props.onClock} className={props.className ?? 'cursor-pointer border border-transparent hover:border-emerald-500'}>
            {
                props.children
            }
        </button>
    )
}