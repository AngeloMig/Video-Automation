"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"

export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="bottom-right"
      toastOptions={{
        style: { background: "var(--card)", color: "var(--foreground)", border: "1px solid var(--border)" },
      }}
      {...props}
    />
  )
}
