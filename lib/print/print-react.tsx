'use client'

import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { openPrint } from '@/lib/print/print-service'

/** Prints already-built React documents (one A4 page each). Returns false when there is none. */
export function printReactDocuments(nodes: React.ReactNode[], title?: string): boolean {
  if (nodes.length === 0) return false
  openPrint(
    (target) => {
      const root = createRoot(target)
      flushSync(() =>
        root.render(
          <div className="print-multi-document-container">
            {nodes.map((node, i) => (
              <div key={i} className="print-document-wrapper">
                {node}
              </div>
            ))}
          </div>
        )
      )
      return () => root.unmount()
    },
    { orientation: 'portrait', margin: '0', title }
  )
  return true
}
