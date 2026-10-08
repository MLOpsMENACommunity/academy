import Link from 'next/link';

/** Only reached for paths outside /en and /ar (middleware normally prefixes them). */
export default function GlobalNotFound() {
  return (
    <html lang="en" dir="ltr">
      <body className="grid min-h-screen place-items-center p-6 text-center">
        <div>
          <h1 className="text-2xl font-bold">Page not found</h1>
          <p className="mt-2">
            <Link href="/en" className="text-primary underline">
              Go to the homepage
            </Link>
          </p>
        </div>
      </body>
    </html>
  );
}
