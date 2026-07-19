'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { ReactNode } from 'react';

interface GarageDoorLayerProps {
  isOpen: boolean;
  doorImage: string;
  onOpenComplete: () => void;
  children: ReactNode;
}

export default function GarageDoorLayer({
  isOpen,
  doorImage,
  onOpenComplete,
  children,
}: GarageDoorLayerProps) {
  return (
    <>
      <AnimatePresence>
        {!isOpen && (
          <motion.div
            className="fixed inset-0 z-10 w-full h-full overflow-hidden"
            style={{
              backgroundImage: `
                linear-gradient(rgba(0, 0, 0, 0.3), rgba(0, 0, 0, 0.3)),
                url('${doorImage}')
              `,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
            initial={{ y: 0 }}
            exit={{ y: '-100%' }}
            transition={{
              duration: 1.5,
              ease: 'easeIn',
            }}
          >
            <motion.div
              className="absolute inset-0 flex flex-col items-center justify-center"
              initial={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              {children}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {isOpen && (
        <div className="relative z-0 min-h-screen w-full">
          {children}
        </div>
      )}
    </>
  );
}
