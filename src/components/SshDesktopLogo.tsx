import React from 'react';

interface SshDesktopLogoProps {
  className?: string;
  showText?: boolean;
}

export const SshDesktopLogo: React.FC<SshDesktopLogoProps> = ({ className = 'w-6 h-6', showText = false }) => {
  return (
    <div className={`inline-flex items-center space-x-2 select-none ${className}`}>
      <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full shrink-0 drop-shadow-md"
      >
        <defs>
          <linearGradient id="logoBg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#0B0F19" />
            <stop offset="50%" stopColor="#1E1B4B" />
            <stop offset="100%" stopColor="#0F172A" />
          </linearGradient>
          <linearGradient id="logoBorder" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38BDF8" />
            <stop offset="100%" stopColor="#818CF8" />
          </linearGradient>
          <linearGradient id="logoScreen" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#080C16" />
            <stop offset="100%" stopColor="#030712" />
          </linearGradient>
        </defs>

        {/* Outer Squircle Container */}
        <rect
          x="4"
          y="4"
          width="92"
          height="92"
          rx="22"
          fill="url(#logoBg)"
          stroke="url(#logoBorder)"
          strokeWidth="2.5"
        />

        {/* Monitor Screen Frame */}
        <rect
          x="14"
          y="16"
          width="72"
          height="52"
          rx="6"
          fill="url(#logoScreen)"
          stroke="#334155"
          strokeWidth="1.5"
        />

        {/* Top Mini Traffic Lights */}
        <circle cx="21" cy="23" r="2" fill="#EF4444" />
        <circle cx="27" cy="23" r="2" fill="#F59E0B" />
        <circle cx="33" cy="23" r="2" fill="#10B981" />

        {/* Terminal Prompt Chevron ">" */}
        <path
          d="M22 36 L30 43 L22 50"
          fill="none"
          stroke="#38BDF8"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* "ssh" Text */}
        <text
          x="34"
          y="47"
          fontFamily="'JetBrains Mono', monospace, sans-serif"
          fontSize="12"
          fontWeight="800"
          fill="#F8FAFC"
          letterSpacing="0.5"
        >
          ssh
        </text>

        {/* Blinking Cursor "_" */}
        <line
          x1="58"
          y1="47"
          x2="66"
          y2="47"
          stroke="#34D399"
          strokeWidth="2.5"
          strokeLinecap="round"
        />

        {/* Mini Encryption Key Symbol */}
        <g transform="translate(71, 38)">
          <circle cx="0" cy="0" r="3.5" fill="none" stroke="#38BDF8" strokeWidth="1.2" />
          <path d="M2.5 2.5 L6.5 6.5 M5.5 4.5 L7 6" stroke="#38BDF8" strokeWidth="1.2" strokeLinecap="round" />
        </g>

        {/* Monitor Stand */}
        <path
          d="M45 68 L43 78 L57 78 L55 68 Z"
          fill="#1E293B"
          stroke="#334155"
          strokeWidth="1"
        />
        {/* Stand Base */}
        <rect
          x="34"
          y="77"
          width="32"
          height="4.5"
          rx="2.25"
          fill="#0F172A"
          stroke="#38BDF8"
          strokeWidth="1.2"
        />
      </svg>

      {showText && (
        <span className="font-bold text-sm tracking-tight text-white flex items-center space-x-1">
          <span>SSH Desktop</span>
        </span>
      )}
    </div>
  );
};

export default SshDesktopLogo;
