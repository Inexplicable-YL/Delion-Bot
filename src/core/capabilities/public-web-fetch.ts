import { lookup } from 'node:dns/promises';
import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { Readable } from 'node:stream';

const special = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const)
  special.addSubnet(address, prefix);
special.addSubnet('2001::', 23, 'ipv6');
special.addSubnet('2001:db8::', 32, 'ipv6');
special.addSubnet('2002::', 16, 'ipv6');
special.addSubnet('3fff::', 20, 'ipv6');
const globalIPv6 = new BlockList();
globalIPv6.addSubnet('2000::', 3, 'ipv6');

export async function fetchPublicWebPage(
  url: URL,
  options: RequestInit,
  approve: (url: URL) => Promise<void>,
): Promise<Response> {
  const { body } = options;
  if (body != null && typeof body !== 'string') throw new TypeError('Invalid HTTP request body');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const family = isIP(hostname);
  const addresses = family
    ? [{ address: hostname, family }]
    : await lookup(hostname, { all: true });
  options.signal?.throwIfAborted();
  if (
    url.username ||
    url.password ||
    !addresses.length ||
    addresses.some(({ address, family }) =>
      family === 4
        ? special.check(address)
        : !globalIPv6.check(address, 'ipv6') || special.check(address, 'ipv6'),
    )
  ) {
    await approve(url);
    options.signal?.throwIfAborted();
    return fetch(url, options);
  }
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const requestOptions: RequestOptions & { autoSelectFamily: true } = {
      agent: false,
      method: options.method,
      autoSelectFamily: true,
      headers: {
        ...Object.fromEntries(new Headers(options.headers)),
        'accept-encoding': 'identity',
        ...(body != null && { 'content-length': Buffer.byteLength(body).toString() }),
      },
      signal: options.signal ?? undefined,
      lookup(_hostname, opts, callback) {
        const { address, family } = addresses[0]!;
        if (opts.all) callback(null, addresses);
        else callback(null, address, family);
      },
    };
    const outgoing = request(url, requestOptions, (incoming) => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers))
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      const status = incoming.statusCode ?? 500;
      const noBody =
        options.method === 'HEAD' || status === 204 || status === 205 || status === 304;
      if (noBody) incoming.resume();
      resolve(
        new Response(
          noBody
            ? null
            : (Readable.toWeb(incoming, {
                strategy: { highWaterMark: 1, size: () => 1 },
              }) as ReadableStream<Uint8Array>),
          {
            status,
            headers,
          },
        ),
      );
    });
    outgoing.once('error', reject);
    outgoing.end(body ?? undefined);
  });
}
