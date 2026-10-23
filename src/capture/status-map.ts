/**
 * F8: the EXACT closed set of status codes Querio+ labels. No "etc." — anything not
 * in this map renders as the numeric status with an empty label. status === 0
 * (request failed with no response) renders '(failed)'.
 */
export const STATUS_TEXT: Readonly<Record<number, string>> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

/** Map a status code to a display label. 0 -> '(failed)', unmapped -> '' (empty label). */
export function statusLabel(status: number): string {
  if (status === 0) return '(failed)';
  return STATUS_TEXT[status] ?? '';
}
