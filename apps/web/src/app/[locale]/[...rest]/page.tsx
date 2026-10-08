import { notFound } from 'next/navigation';

/** Unknown paths under /en or /ar render the localized 404 instead of the root one. */
export default function CatchAll() {
  notFound();
}
