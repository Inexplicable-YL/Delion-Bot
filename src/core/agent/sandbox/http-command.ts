import { fetchPublicWebPage } from '../../capabilities/public-web-fetch';
import { approveNonPublicRead } from './approve-tool';
import { maxCommandOutputBytes } from './command-output';

const curlOptions = {
  s: 'silent',
  S: 'show-error',
  L: 'location',
  f: 'fail',
  I: 'head',
  i: 'include',
  G: 'get',
  g: 'globoff',
  q: 'disable',
  X: 'request',
  H: 'header',
  D: 'dump-header',
  A: 'user-agent',
  e: 'referer',
  r: 'range',
  o: 'output',
  O: 'remote-name',
  w: 'write-out',
  m: 'max-time',
  d: 'data',
} as const;
const wgetOptions = {
  q: 'quiet',
  S: 'server-response',
  O: 'output-document',
  T: 'timeout',
  U: 'user-agent',
} as const;
const httpieOptions = {
  F: 'follow',
  h: 'headers',
  b: 'body',
  o: 'output',
  d: 'download',
  p: 'print',
} as const;
const optionNames = new Set([
  'request',
  'header',
  'dump-header',
  'user-agent',
  'referer',
  'range',
  'output',
  'output-document',
  'write-out',
  'url',
  'max-time',
  'connect-timeout',
  'timeout',
  'max-redirs',
  'max-redirect',
  'data',
  'data-ascii',
  'data-binary',
  'data-raw',
  'data-urlencode',
  'url-query',
  'json',
  'print',
]);
const queryName = /^[a-zA-Z0-9_.~%+\-[\]]+$/;
const reportField =
  /%\{(http_code|response_code|url_effective|content_type|num_redirects|size_download|redirect_url)\}|%%|\\[nrt]/g;
const safeHeaders =
  /^(?:accept(?:-language|-charset)?|user-agent|referer|range|if-(?:none-match|modified-since|match|unmodified-since|range)|cache-control|pragma|origin|content-type|x-requested-with|x-github-api-version)$/i;

const encodeQuery = (value: string) =>
  new URLSearchParams([['q', value]])
    .toString()
    .slice(2)
    .replaceAll('%7E', '~')
    .replaceAll('*', '%2A');

function queryField(value: string, rawPrefix = false) {
  if (rawPrefix && value.startsWith('+')) return value.slice(1);
  const at = value.indexOf('=');
  if (at === -1) return value.includes('@') ? null : encodeQuery(value);
  const name = value.slice(0, at);
  return !name || queryName.test(name)
    ? (name && name + '=') + encodeQuery(value.slice(at + 1))
    : null;
}

function httpURL(value: string) {
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    return url.username || url.password ? null : url;
  } catch {
    return null;
  }
}

export function parseHttpCommand(program: string, args: string[], windows: boolean) {
  if (windows && /^(?:invoke-webrequest|invoke-restmethod|iwr|irm)$/.test(program)) {
    const aliases: Record<string, string> = {
      '-uri': '--url',
      '-method': '--request',
      '-outfile': '--output',
      '-timeoutsec': '--max-time',
      '-maximumredirection': '--max-redirs',
      '-useragent': '--user-agent',
    };
    const options = ['--location', '--fail'];
    for (let i = 0; i < args.length; i++) {
      const original = args[i]!;
      const name = original.toLowerCase();
      if (name === '-usebasicparsing') continue;
      if (name === '-skiphttperrorcheck') {
        const fail = options.indexOf('--fail');
        if (fail !== -1) options.splice(fail, 1);
      } else if (Object.hasOwn(aliases, name)) {
        const value = args[++i];
        if (!value || (name === '-method' && !/^(?:get|head)$/i.test(value))) return null;
        options.push(aliases[name]!, name === '-method' ? value.toUpperCase() : value);
      } else if (/^https?:\/\//i.test(original)) {
        options.push(original);
      } else return null;
    }
    program = 'curl';
    args = options;
  }
  const curl = program === 'curl';
  const wget = program === 'wget';
  const httpie = /^(?:http|https|httpie)$/.test(program);
  if (!curl && !wget && !httpie) return null;
  const short: Readonly<Record<string, string>> = curl
    ? curlOptions
    : wget
      ? wgetOptions
      : httpieOptions;
  const switches = curl
    ? [
        'silent',
        'show-error',
        'location',
        'fail',
        'fail-with-body',
        'head',
        'include',
        'get',
        'globoff',
        'disable',
        'compressed',
        'remote-name',
        'no-progress-meter',
      ]
    : wget
      ? ['quiet', 'server-response', 'spider', 'no-config', 'no-verbose', 'no-hsts', 'no-cookies']
      : ['follow', 'headers', 'body', 'check-status', 'ignore-stdin', 'download'];
  const options: [string, string][] = [];
  const operands: string[] = [];
  let flags = true;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (flags && arg === '--') flags = false;
    else if (!flags || !arg.startsWith('-') || arg === '-') operands.push(arg);
    else if (arg.startsWith('--')) {
      const equals = arg.indexOf('=');
      const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
      if (optionNames.has(name)) {
        const value = equals === -1 ? args[++i] : arg.slice(equals + 1);
        if (value === undefined) return null;
        options.push([name, value]);
      } else if (equals === -1 && switches.includes(name)) options.push([name, '']);
      else return null;
    } else {
      for (let index = 1; index < arg.length; index++) {
        const key = arg[index]!;
        const name = Object.hasOwn(short, key) ? short[key]! : '';
        if (optionNames.has(name)) {
          const value = arg.slice(index + 1) || args[++i];
          if (value === undefined) return null;
          options.push([name, value]);
          break;
        }
        if (!switches.includes(name)) return null;
        options.push([name, '']);
      }
    }
  }
  if (httpie && /^[A-Z]+$/.test(operands[0] ?? '')) options.unshift(['request', operands.shift()!]);
  const headers = new Headers();
  const query: string[] = [];
  const data: string[] = [];
  let destination = curl || httpie ? '-' : undefined;
  let remoteName = false;
  let method: string | undefined;
  let head = false;
  let follow = wget;
  let fail = wget ? 'fail' : '';
  let include = false;
  let print: 'h' | 'b' | 'hb' = 'b';
  let get = false;
  let report = '';
  let json = false;
  let timeout = 30_000;
  let redirects = 5;
  let rawURL: string | undefined;
  for (const [name, value] of options) {
    if (switches.includes(name)) {
      if (name === 'head' || name === 'spider') head = true;
      else if (name === 'headers') print = 'h';
      else if (name === 'body') print = 'b';
      else if (name === 'follow' || name === 'location') follow = true;
      else if (name === 'include' || name === 'server-response') include = true;
      else if (name === 'get') get = true;
      else if (name === 'remote-name') remoteName = true;
      else if (name === 'fail' || name === 'fail-with-body' || name === 'check-status') fail = name;
      continue;
    }
    if ((name === 'output' && !wget) || (name === 'output-document' && wget)) {
      if (!value) return null;
      destination = value;
    } else if (name === 'url' && curl && !rawURL) rawURL = value;
    else if (name === 'dump-header' && curl && value === '-') include = true;
    else if (name === 'request' && !wget && (!method || method === value)) method = value;
    else if (name === 'write-out' && curl && value && !value.startsWith('@')) {
      if (value.replace(reportField, '').includes('%')) return null;
      report = value;
    } else if (name === 'print' && httpie && (value === 'h' || value === 'b' || value === 'hb'))
      print = value;
    else if (
      (curl && ['max-time', 'connect-timeout'].includes(name)) ||
      (!curl && name === 'timeout')
    ) {
      if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
      if (Number(value) > 0) timeout = Math.min(timeout, Number(value) * 1000);
    } else if ((curl && name === 'max-redirs') || (wget && name === 'max-redirect')) {
      if (!/^\d+$/.test(value)) return null;
      redirects = Math.min(5, Number(value));
    } else if (curl && (name.startsWith('data') || name === 'url-query' || name === 'json')) {
      const field =
        name === 'data-urlencode' || name === 'url-query'
          ? queryField(value, name === 'url-query')
          : name === 'data-raw' || !value.startsWith('@')
            ? value
            : null;
      if (field === null) return null;
      json ||= name === 'json';
      (name === 'url-query' ? query : data).push(field);
    } else if (
      name === 'header' ||
      (name === 'user-agent' && !httpie) ||
      (curl && (name === 'referer' || name === 'range'))
    ) {
      const field = name === 'header' ? /^([\w-]+):[ \t]*(.*)$/.exec(value) : null;
      const key = name === 'header' ? field?.[1] : name;
      const content = field ? field[2]! : name === 'range' ? 'bytes=' + value : value;
      if (!key || !safeHeaders.test(key) || /[^\t\x20-\x7e]/.test(content)) return null;
      if (key.toLowerCase() === 'referer' && /;auto$/i.test(content)) return null;
      headers.set(key, content);
    } else return null;
  }
  if (!rawURL) rawURL = operands.shift();
  if (!rawURL) return null;
  const url = httpURL(rawURL);
  if (!url || /[{}[\]]/.test(url.pathname + url.search)) return null;
  if (httpie) {
    for (const item of operands.splice(0)) {
      const field = /^([\w-]+)(==|:)(.*)$/.exec(item);
      if (!field) return null;
      const [, key, separator, value] = field;
      if (separator === '==') query.push(encodeQuery(key!) + '=' + encodeQuery(value!));
      else if (safeHeaders.test(key!) && !/[^\t\x20-\x7e]/.test(value!)) headers.set(key!, value!);
      else return null;
    }
  }
  if (operands.length || (method && !/^(?:GET|HEAD|POST|PUT|PATCH)$/.test(method))) return null;
  if (head && method === 'GET') return null;
  head ||= method === 'HEAD';
  if (wget && head) destination ??= '-';
  if (remoteName) {
    const file = url.pathname.split('/').at(-1);
    if (destination !== '-' || !file) return null;
    destination = file;
  }
  if (
    !destination ||
    (httpie && options.some(([name]) => name === 'download') && destination === '-')
  )
    return null;
  if (get && data.length) {
    if (query.length) return null;
    query.push(...data);
  }
  if (query.length) url.search += (url.search ? '&' : '?') + query.join('&');
  const discard = windows ? /^nul:?$/i.test(destination) : destination === '/dev/null';
  const path = discard || destination === '-' ? undefined : destination;
  const verb = method ?? (head ? 'HEAD' : data.length && !get ? 'POST' : 'GET');
  const writes = verb !== 'GET' && verb !== 'HEAD';
  if (
    (writes && (!curl || head || get || follow || path)) ||
    (!writes && data.length && !get) ||
    (json && options.some(([name]) => name.startsWith('data')))
  )
    return null;
  if (writes && data.length && !headers.has('content-type'))
    headers.set('content-type', json ? 'application/json' : 'application/x-www-form-urlencoded');
  if (json && !headers.has('accept')) headers.set('accept', 'application/json');
  const showHeaders = (!discard || wget) && (include || (httpie && print.includes('h')) || head);
  const showBody = !head && (!httpie || print.includes('b'));
  if (path && ((!wget && showHeaders) || !showBody)) return null;
  return {
    url,
    method: verb,
    write: writes ? { body: data.length ? data.join(json ? '' : '&') : undefined } : undefined,
    follow,
    fail,
    headers,
    path,
    discard,
    showHeaders,
    showBody,
    report,
    timeout,
    redirects,
  };
}

export type HttpCommand = NonNullable<ReturnType<typeof parseHttpCommand>>;

export async function runHttpCommand(
  command: HttpCommand,
  session: string,
  signal: AbortSignal,
  save?: (bytes: Buffer, signal: AbortSignal) => Promise<void>,
) {
  const {
    method,
    write,
    follow,
    fail,
    headers,
    showHeaders,
    showBody,
    discard,
    report,
    redirects,
  } = command;
  const cancellation = AbortSignal.any([signal, AbortSignal.timeout(Math.ceil(command.timeout))]);
  const responseHeaders: string[] = [];
  let url = command.url;
  for (let hops = 0; ; hops++) {
    const response = await fetchPublicWebPage(
      url,
      {
        method,
        redirect: 'manual',
        credentials: 'omit',
        headers,
        signal: cancellation,
        body: write?.body,
      },
      (target) => {
        if (write) throw new Error('Scoped HTTP writes support public addresses only.');
        return approveNonPublicRead(session, target, cancellation);
      },
    );
    if (showHeaders)
      responseHeaders.push(
        'HTTP ' + response.status,
        ...[...response.headers].map(([name, value]) => name + ': ' + value),
        '',
        '',
      );
    const location = [301, 302, 303, 307, 308].includes(response.status)
      ? response.headers.get('location')
      : null;
    if (follow && location) {
      await response.body?.cancel();
      if (hops >= redirects) throw new Error('Too many redirects.');
      const next = httpURL(new URL(location, url).href);
      if (!next) throw new Error('Only credential-free HTTP or HTTPS addresses are supported.');
      url = next;
      continue;
    }
    const failed = Boolean(
      fail && (response.status >= 400 || (fail === 'check-status' && !response.ok)),
    );
    const limit = save || discard ? 5 * 1024 * 1024 : maxCommandOutputBytes;
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    let truncated = false;
    if (showBody && response.body && (!failed || fail === 'fail-with-body')) {
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!discard) chunks.push(value.subarray(0, limit - bytes));
          bytes += value.byteLength;
          if (bytes > limit) {
            truncated = true;
            break;
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    } else await response.body?.cancel();
    if (save) {
      if (!response.ok || truncated)
        return {
          exitCode: 1,
          output: '',
          error: truncated ? 'The file exceeds 5 MiB.' : 'HTTP ' + response.status,
        };
      await save(Buffer.concat(chunks), cancellation);
    }
    const fields = {
      http_code: response.status,
      response_code: response.status,
      url_effective: url.href,
      content_type: response.headers.get('content-type') ?? '',
      num_redirects: hops,
      size_download: Math.min(bytes, limit),
      redirect_url: location ? new URL(location, url).href : '',
    };
    const diagnostics = report.replace(
      reportField,
      (match, field: keyof typeof fields | undefined) =>
        field
          ? String(fields[field])
          : { '%%': '%', '\\n': '\n', '\\r': '\r', '\\t': '\t' }[match]!,
    );
    return {
      exitCode: failed ? 22 : truncated && !discard ? null : 0,
      output:
        responseHeaders.join('\r\n') +
        (save || discard ? '' : Buffer.concat(chunks).toString('utf8')) +
        diagnostics,
      ...(failed
        ? { error: 'HTTP ' + response.status }
        : truncated && !discard
          ? { error: 'The HTTP response exceeded the capture limit.' }
          : {}),
      ...(truncated && !discard && { output_truncated: true }),
    };
  }
}
