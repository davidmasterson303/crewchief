'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface GarageDoorAnimationProps {
  isOpen: boolean;
  onAnimationComplete: () => void;
  redirectPath?: string;
}

export default function GarageDoorAnimation({ isOpen, onAnimationComplete, redirectPath }: GarageDoorAnimationProps) {
  const router = useRouter();
  const [shouldRender, setShouldRender] = useState(isOpen);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      const timer = setTimeout(() => {
        onAnimationComplete();
        if (redirectPath) {
          router.push(redirectPath);
        }
      }, 1200);

      return () => clearTimeout(timer);
    } else {
      setShouldRender(false);
    }
  }, [isOpen, onAnimationComplete, redirectPath, router]);

  if (!shouldRender) return null;

  return (
    <>
      <style>{`
        @keyframes garage-door-open {
          0% {
            transform: translateY(0);
            opacity: 1;
          }
          100% {
            transform: translateY(-100%);
            opacity: 1;
          }
        }

        .garage-door {
          animation: garage-door-open 1.5s cubic-bezier(0.45, 0.05, 0.55, 0.95) forwards;
          background-image:
            linear-gradient(90deg, rgba(0,0,0,0.3) 0px, transparent 1px, transparent 99px, rgba(0,0,0,0.3) 100px),
            repeating-linear-gradient(
              0deg,
              #3d3d3d 0px,
              #4a4a4a 2px,
              #3d3d3d 4px,
              #2d2d2d 18px,
              #252525 36px,
              #2d2d2d 38px,
              #3d3d3d 40px
            ),
            linear-gradient(180deg, #2a2a2a 0%, #1f1f1f 50%, #2a2a2a 100%);
          background-size: 100px 100%, 100% 40px, 100% 100%;
          background-position: center;
          box-shadow:
            inset 0 4px 20px rgba(0, 0, 0, 0.6),
            inset 0 -4px 20px rgba(0, 0, 0, 0.4),
            0 10px 50px rgba(0, 0, 0, 0.8);
          position: relative;
        }

        .garage-door::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: repeating-linear-gradient(
            90deg,
            rgba(255, 255, 255, 0.03) 0px,
            rgba(255, 255, 255, 0.03) 1px,
            transparent 1px,
            transparent 100px
          );
          pointer-events: none;
        }

        .garage-door::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 60px;
          background: linear-gradient(to top, rgba(0, 0, 0, 0.5), transparent);
          pointer-events: none;
        }
      `}</style>
      <div className="garage-door fixed inset-0 z-[9999] flex items-end justify-center overflow-hidden" />
    </>
  );
}
