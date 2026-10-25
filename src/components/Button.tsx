import React from "react";

export interface ButtonProps {
    className?: string;
    children?: React.ReactNode;
    onClock?: ()=>void;
}

export default function Button(props:ButtonProps) {
    return (
        <button onClick={props.onClock} className={props.className ?? 'retro-button cursor-pointer px-3 py-1.5 text-xs'}>
            {
                props.children
            }
        </button>
    )
}