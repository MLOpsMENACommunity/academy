import { NotFoundView } from './NotFoundView';

// Its title ("Page not found | MLOps MENA Academy") comes from the page that called notFound():
// Next gives not-found.tsx no params, so it can't know the locale (see notFoundMetadata in lib/seo.ts).
export default function NotFound() {
  return <NotFoundView />;
}
