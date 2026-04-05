import { useState, useEffect, useCallback } from 'react'

export function useResponsive() {
  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200)

  useEffect(() => {
    // Use matchMedia for efficient breakpoint detection (no layout thrashing)
    const mobileQuery = window.matchMedia('(max-width: 767px)')
    const tabletQuery = window.matchMedia('(min-width: 768px) and (max-width: 1023px)')

    // Debounced resize handler for precise width (only needed for non-breakpoint logic)
    let rafId = null
    const handleResize = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => setWidth(window.innerWidth))
    }

    // Listen for breakpoint crossings (fires only at thresholds — zero-cost between)
    const onBreakpointChange = () => handleResize()
    mobileQuery.addEventListener('change', onBreakpointChange)
    tabletQuery.addEventListener('change', onBreakpointChange)

    // Also listen to resize for smooth transitions, but throttled via rAF
    window.addEventListener('resize', handleResize, { passive: true })

    return () => {
      mobileQuery.removeEventListener('change', onBreakpointChange)
      tabletQuery.removeEventListener('change', onBreakpointChange)
      window.removeEventListener('resize', handleResize)
      if (rafId) cancelAnimationFrame(rafId)
    }
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
