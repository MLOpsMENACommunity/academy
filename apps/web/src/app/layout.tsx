import type { ReactNode } from 'react';
import './globals.css';

// <html> lives in app/[locale]/layout.tsx so `lang` and `dir` follow the URL.
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
