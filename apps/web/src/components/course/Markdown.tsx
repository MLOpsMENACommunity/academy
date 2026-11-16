import ReactMarkdown from 'react-markdown';

/**
 * Course descriptions are admin-authored markdown. Raw HTML is not rendered. `untrusted` is for
 * what students write (Q&A): links are marked nofollow/ugc and images are shown as links, so a
 * post can't load anything from another site when someone opens it.
 */
export function Markdown({ children, untrusted = false }: { children: string; untrusted?: boolean }) {
  return (
    <div className="prose-academy">
      <ReactMarkdown
        skipHtml
        components={{
          a: ({ href, children: c }) => (
            <a href={href} rel={untrusted ? 'nofollow ugc noopener noreferrer' : 'noopener noreferrer'} target={href?.startsWith('http') ? '_blank' : undefined}>
              {c}
            </a>
          ),
          ...(untrusted
            ? {
                img: ({ src, alt }) =>
                  typeof src === 'string' && src ? (
                    <a href={src} rel="nofollow ugc noopener noreferrer" target="_blank">
                      {alt || src}
                    </a>
                  ) : null,
              }
            : {}),
          h1: ({ children: c }) => <h3>{c}</h3>,
          h2: ({ children: c }) => <h3>{c}</h3>,
          // Code and folder trees read left to right, even on Arabic pages. Wide
          // blocks scroll sideways, so they take focus for keyboard scrolling.
          pre: ({ children: c }) => (
            <pre dir="ltr" tabIndex={0}>
              {c}
            </pre>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
