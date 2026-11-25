import React from 'react';
import { DiceValue } from '../types/game';

interface RedDiceProps {
  value: DiceValue;
  isRolling: boolean;
  variant?: 'a' | 'b' | 'c';
  size?: 'sm' | 'md' | 'lg';
  showBadge?: boolean;
}

const PIP_POSITIONS: Record<DiceValue, Array<[number, number]>> = {
  1: [[50, 50]],
  2: [
    [29, 30],
    [71, 70],
  ],
  3: [
    [27, 27],
    [50, 50],
    [73, 73],
  ],
  4: [
    [29, 29],
    [71, 29],
    [29, 71],
    [71, 71],
  ],
  5: [
    [27, 27],
    [73, 27],
    [50, 50],
    [27, 73],
    [73, 73],
  ],
  6: [
    [29, 24],
    [71, 24],
    [29, 50],
    [71, 50],
    [29, 76],
    [71, 76],
  ],
};

// Adjacent side-face values (never opposite = 7 - value) for authentic 3D cube depth
const SIDE_FACE_MAP: Record<DiceValue, [DiceValue, DiceValue]> = {
  1: [2, 3],
  2: [6, 4],
  3: [5, 1],
  4: [5, 2],
  5: [3, 6],
  6: [4, 2],
};

const VARIANT_TILT: Record<'a' | 'b' | 'c', string> = {
  a: '-rotate-6',
  b: 'rotate-[10deg]',
  c: '-rotate-[12deg]',
};

export const RedDice: React.FC<RedDiceProps> = ({
  value,
  isRolling,
  variant = 'a',
  size = 'lg',
  showBadge = false,
}) => {
  const pips = PIP_POSITIONS[value];
  const [rightVal, bottomVal] = SIDE_FACE_MAP[value];
  const rightPips = PIP_POSITIONS[rightVal];
  const bottomPips = PIP_POSITIONS[bottomVal];

  const animClass = isRolling
    ? variant === 'a'
      ? 'animate-dice-a'
      : variant === 'b'
        ? 'animate-dice-b'
        : 'animate-dice-c'
    : 'transition-transform duration-300 ease-out';

  const sizeClasses =
    size === 'sm'
      ? 'w-11 h-11'
      : size === 'md'
        ? 'w-16 h-16 sm:w-20 sm:h-20'
        : 'w-[74px] h-[74px] sm:w-[90px] sm:h-[90px] md:w-[98px] md:h-[98px]';

  const pipRadius = value === 1 ? (size === 'sm' ? 7 : 11.5) : size === 'sm' ? 4.5 : 8.2;

  return (
    <div className={`relative select-none ${animClass} ${!isRolling ? VARIANT_TILT[variant] : ''}`}>
      {/* Soft shadow beneath the 3D red die */}
      <div
        className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-[84%] h-3.5 rounded-full bg-black/80 blur-[5px]"
        aria-hidden="true"
      />

      {/* 3D Red Die SVG (isometric bevel showing main top face + right & bottom depth faces) */}
      <div
        className={`relative tx-die-body ${sizeClasses}`}
        role="img"
        aria-label={`Xúc xắc ${value} chấm`}
      >
        <svg viewBox="0 0 120 120" className="w-full h-full drop-shadow-[0_10px_16px_rgba(0,0,0,0.85)]">
          <defs>
            <linearGradient id={`top-face-${variant}-${size}`} x1="12%" y1="8%" x2="88%" y2="92%">
              <stop offset="0%" stopColor="#ff4757" />
              <stop offset="50%" stopColor="#de1226" />
              <stop offset="100%" stopColor="#a80818" />
            </linearGradient>
            <linearGradient id={`right-face-${variant}-${size}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#b80a1c" />
              <stop offset="100%" stopColor="#69030d" />
            </linearGradient>
            <linearGradient id={`bottom-face-${variant}-${size}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#990615" />
              <stop offset="100%" stopColor="#540109" />
            </linearGradient>
            <radialGradient id={`pip-pearl-${variant}-${size}`} cx="38%" cy="32%" r="68%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="72%" stopColor="#f5f5f4" />
              <stop offset="100%" stopColor="#d4d4d8" />
            </radialGradient>
          </defs>

          {/* Bottom 3D depth face */}
          <path
            d="M 16 90 L 88 90 L 106 105 C 103 111 97 114 89 114 L 30 114 C 22 114 16 108 16 99 Z"
            fill={`url(#bottom-face-${variant}-${size})`}
            stroke="#59020b"
            strokeWidth="1.2"
          />

          {/* Right 3D depth face */}
          <path
            d="M 90 15 C 99 16 108 23 109 32 L 109 94 C 109 102 105 107 98 110 L 86 92 L 86 18 Z"
            fill={`url(#right-face-${variant}-${size})`}
            stroke="#59020b"
            strokeWidth="1.2"
          />

          {/* Side pips on bottom face */}
          <g opacity="0.88">
            {bottomPips.map(([cx, cy], idx) => (
              <ellipse
                key={`b-${idx}`}
                cx={24 + cx * 0.68}
                cy={95 + cy * 0.14}
                rx="3.3"
                ry="1.8"
                fill="#f4f4f5"
              />
            ))}
          </g>

          {/* Side pips on right face */}
          <g opacity="0.9">
            {rightPips.map(([cx, cy], idx) => (
              <ellipse
                key={`r-${idx}`}
                cx={92 + cx * 0.13}
                cy={24 + cy * 0.68}
                rx="1.9"
                ry="3.4"
                fill="#f4f4f5"
              />
            ))}
          </g>

          {/* Main beveled rounded top face */}
          <rect
            x="9"
            y="8"
            width="84"
            height="84"
            rx="19"
            ry="19"
            fill={`url(#top-face-${variant}-${size})`}
            stroke="#ff8a95"
            strokeOpacity="0.45"
            strokeWidth="1.8"
          />

          {/* Subtle top specular gloss */}
          <path
            d="M 24 12 L 74 12 C 83 12 88 18 88 26 C 68 24 38 30 14 48 L 14 26 C 14 17 18 12 24 12 Z"
            fill="rgba(255,255,255,0.16)"
          />

          {/* Crisp main-face pips */}
          {pips.map(([cx, cy], idx) => {
            const px = 9 + (cx / 100) * 84;
            const py = 8 + (cy / 100) * 84;
            return (
              <g key={`t-${idx}`}>
                <circle cx={px} cy={py + 1.3} r={pipRadius * 0.9} fill="rgba(70, 0, 10, 0.55)" />
                <circle
                  cx={px}
                  cy={py}
                  r={pipRadius * 0.86}
                  fill={`url(#pip-pearl-${variant}-${size})`}
                />
              </g>
            );
          })}
        </svg>
      </div>

      {/* Clear numeric pip badge when result is revealed */}
      {showBadge && !isRolling && (
        <span className="tx-die-badge absolute -bottom-1.5 -right-1 z-10 flex items-center justify-center w-6 h-6 rounded-full bg-amber-950 border border-amber-400 text-amber-200 font-mono-num text-xs font-bold shadow-md">
          {value}
        </span>
      )}
    </div>
  );
};
