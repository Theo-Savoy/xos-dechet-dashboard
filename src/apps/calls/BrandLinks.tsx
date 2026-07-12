/** Liens marque vers Salesforce / LinkedIn — lisibles, accessibles, compacts. */

type LinkProps = {
  href: string;
  className?: string;
};

function SalesforceCloud({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M18.3 10.1c-.3-2.3-2.3-4-4.7-4-1.5 0-2.9.7-3.8 1.8-.7-.5-1.6-.8-2.5-.8-2.3 0-4.2 1.8-4.4 4.1C1.4 11.1.5 12.6.5 14.3c0 2.3 1.9 4.2 4.2 4.2h13.1c2.1 0 3.7-1.7 3.7-3.7 0-1.9-1.4-3.4-3.2-3.7Z"
      />
    </svg>
  );
}

function LinkedInMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M4.98 3.5C4.98 4.88 3.88 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM.5 8.5h4V23h-4V8.5zm7.5 0h3.8v2h.05c.53-1 1.84-2.05 3.79-2.05 4.05 0 4.8 2.67 4.8 6.14V23h-4v-6.6c0-1.57-.03-3.6-2.2-3.6-2.2 0-2.54 1.72-2.54 3.49V23h-4V8.5z"
      />
    </svg>
  );
}

export function SalesforceRecordLink({ href, className = "" }: LinkProps) {
  return (
    <a
      href={href}
      className={`calls-brand-link calls-brand-link--sf ${className}`.trim()}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Ouvrir dans Salesforce"
      title="Ouvrir dans Salesforce"
    >
      <SalesforceCloud />
    </a>
  );
}

export function LinkedInRecordLink({ href, className = "" }: LinkProps) {
  return (
    <a
      href={href}
      className={`calls-brand-link calls-brand-link--li ${className}`.trim()}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Ouvrir sur LinkedIn"
      title="Ouvrir sur LinkedIn"
    >
      <LinkedInMark />
    </a>
  );
}
