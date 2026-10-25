export interface GamepadIconProps {
    className?: string;
}

export default function GamepadIcon(props: GamepadIconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.6}
            stroke="currentColor"
            aria-hidden="true"
            className={props.className ?? 'size-6'}
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6.7 5h10.6a4 4 0 0 1 3.98 3.59c.08.67.68 5.71.68 7.26a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4c0-1.55.6-6.59.68-7.26A4 4 0 0 1 6.7 5Z"
            />
            <path strokeLinecap="round" d="M8 9.8v3.4M6.3 11.5h3.4" />
            <path strokeLinecap="round" d="M11.4 12.2h1.2M13.2 12.2h1.2" />
            <circle cx="16.2" cy="10.5" r=".75" />
            <circle cx="18.2" cy="12.8" r=".75" />
        </svg>
    )
}
