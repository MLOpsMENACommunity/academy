import ReactMarkdown from 'react-markdown';

/** Course descriptions are admin-authored markdown. Raw HTML is not rendered. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-academy">
      <ReactMarkdown
        skipHtml
        components={{
          a: ({ href, children: c }) => (
            <a href={href} rel="noopener noreferrer" target={href?.startsWith('http') ? '_blank' : undefined}>
              {c}
            </a>
          ),
          h1: ({ children: c }) => <h3>{c}</h3>,
          h2: ({ children: c }) => <h3>{c}</h3>,
          // Code and folder trees read left to right, even on Arabic pages.
          pre: ({ children: c }) => <pre dir="ltr">{c}</pre>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
