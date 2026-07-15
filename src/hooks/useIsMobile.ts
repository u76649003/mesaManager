'use client';

import { useState, useEffect } from 'react';

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkIsMobile = () => {
      const isSmallScreen = window.innerWidth < 1024;
      const isCapacitor = typeof window !== 'undefined' && (window as any).Capacitor !== undefined;
      const isMobileOrTabletUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      
      const shouldForceMobile = isSmallScreen || isCapacitor || isMobileOrTabletUA;
      setIsMobile(shouldForceMobile);

      if (shouldForceMobile) {
        document.body.classList.add('force-mobile');
      } else {
        document.body.classList.remove('force-mobile');
      }
    };

    checkIsMobile();
    window.addEventListener('resize', checkIsMobile);
    return () => window.removeEventListener('resize', checkIsMobile);
  }, []);

  return isMobile;
}
