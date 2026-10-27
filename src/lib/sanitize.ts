import DOMPurify from 'dompurify';

/**
 * Sanitize HTML to prevent XSS attacks.
 * Strips dangerous tags like <script>, event handlers like onclick, etc.
 * Safe for use with dangerouslySetInnerHTML.
 */
export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    USE_PROFILES: { html: true },
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'hr', 'span', 'div',
      'ul', 'ol', 'li',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins',
      'a', 'img', 'blockquote', 'pre', 'code',
      'sup', 'sub', 'mark', 'small',
    ],
    ALLOWED_ATTR: [
      'href', 'target', 'rel', 'src', 'alt', 'width', 'height',
      'class', 'className', 'style', 'id', 'colspan', 'rowspan',
    ],
    ALLOW_DATA_ATTR: false,
  });
}
