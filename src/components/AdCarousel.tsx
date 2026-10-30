"use client";

import { ADS } from "@/config";
import { useEffect, useState, type TransitionEvent } from "react";
import Card from "./Card";

const ROTATE_INTERVAL = 10000;

export default function AdCarousel() {
    const [position, setPosition] = useState(0);
    const [paused, setPaused] = useState(false);
    const [jumping, setJumping] = useState(false);

    const count = ADS.length;
    const hasMultiple = count > 1;
    const displayIndex = count > 0 ? position % count : 0;
    const slides = hasMultiple ? [...ADS, ADS[0]] : ADS;

    useEffect(() => {
        if (!hasMultiple || paused || jumping) {
            return;
        }

        const timer = window.setTimeout(() => {
            setPosition((position + 1) % (count + 1));
        }, ROTATE_INTERVAL);

        return () => window.clearTimeout(timer);
    }, [count, hasMultiple, paused, position, jumping]);

    // 滚到末尾的克隆页后，无动画地跳回真正的第一页
    useEffect(() => {
        if (!jumping) {
            return;
        }

        let frame = window.requestAnimationFrame(() => {
            frame = window.requestAnimationFrame(() => setJumping(false));
        });

        return () => window.cancelAnimationFrame(frame);
    }, [jumping]);

    if (count === 0) {
        return null;
    }

    function goTo(target: number) {
        if (jumping || target === displayIndex) {
            return;
        }

        // 从最后一个回到第一个时，继续向前滚动到克隆页
        setPosition(target === 0 && position === count - 1 ? count : target);
    }

    function handleTransitionEnd(event: TransitionEvent<HTMLDivElement>) {
        if (event.target !== event.currentTarget || event.propertyName !== "transform") {
            return;
        }

        if (position === count) {
            setJumping(true);
            setPosition(0);
        }
    }

    return (
        <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
                <p className="retro-label">[ AD ]</p>
                {
                    hasMultiple &&
                    <span className="text-[10px] tracking-[0.12em] text-[var(--muted)]">{displayIndex + 1}/{count}</span>
                }
            </div>
            <div
                className="overflow-hidden border-2 border-[var(--border)] bg-[var(--panel-2)] shadow-[4px_4px_0_var(--shadow)]"
                onMouseEnter={() => setPaused(true)}
                onMouseLeave={() => setPaused(false)}
                onFocus={() => setPaused(true)}
                onBlur={() => setPaused(false)}
            >
                <div
                    className="flex"
                    style={{
                        transform: `translateX(-${position * 100}%)`,
                        transition: jumping ? "none" : "transform 600ms ease-in-out",
                    }}
                    onTransitionEnd={handleTransitionEnd}
                >
                    {
                        slides.map((ad, i) => (
                            <a
                                key={i}
                                href={ad.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="group block w-full shrink-0"
                                title="广告"
                                tabIndex={i === position ? 0 : -1}
                                aria-hidden={i !== position}
                            >
                                <img
                                    src={ad.image}
                                    alt="广告"
                                    width={240}
                                    height={400}
                                    className="block w-full"
                                />
                            </a>
                        ))
                    }
                </div>
            </div>
            {
                hasMultiple &&
                <div className="mt-3 flex items-center justify-center gap-2">
                    {
                        ADS.map((_, i) => (
                            <button
                                key={i}
                                type="button"
                                onClick={() => goTo(i)}
                                className={`h-2 w-2 cursor-pointer border border-[var(--border)] transition-colors ${i === displayIndex ? "bg-[var(--accent)]" : "bg-[var(--panel-2)] hover:bg-[var(--accent-soft)]"}`}
                                aria-label={`查看第 ${i + 1} 个广告`}
                                aria-current={i === displayIndex ? "true" : undefined}
                            />
                        ))
                    }
                </div>
            }
        </Card>
    )
}
