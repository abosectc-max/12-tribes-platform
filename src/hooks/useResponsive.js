import { useState, useEffect } from 'react'

export function useResponsive() {
  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200)

  useEffect(() => {
    const handleResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return {
    width,
    isMobile: width < 768,
    isTablet: width >= 768 && width < 1024,
    isDesktop: width >= 1024,
    breakpoint: width < 768 ? 'mobile' : width < 1024 ? 'tablet' : 'desktop',
  }
}

// Responsive grid helper
export function responsiveGrid(isMobile, isTablet, desktopCols = '1fr 1fr') {
  if (isMobile) return '1fr'
  if (isTablet) return '1fr 1fr'
  return desktopCols
}

// Responsive padding
export function responsivePadding(isMobile) {
  return isMobile ? '16px' : '32px'
}