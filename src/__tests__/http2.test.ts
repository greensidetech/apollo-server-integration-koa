import Koa from 'koa';
import http2 from 'http2';
import { ApolloServer } from '@apollo/server';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import cors from '@koa/cors';
import bodyParser from 'koa-bodyparser';
import { koaMiddleware } from '..';
import { urlForHttpServer } from '../utils';

describe('http2', () => {
  it('works', async () => {
    const app = new Koa();
    // disable logs to console.error
    app.silent = true;

    // For browser-based implementations, you need to provide a key and cert and
    // use http2.createSecureServer. This is because browsers will only use
    // http2 with SSL.
    const http2Server = http2.createServer(app.callback());
    const server = new ApolloServer({
      typeDefs: `#graphql
        type Query {
          hello: String!
        }  
      `,
      resolvers: {
        Query: {
          hello: () => 'hello world!',
        },
      },
      plugins: [
        ApolloServerPluginDrainHttpServer({
          // @ts-expect-error drain server plugin currently only accepts an http.Server
          httpServer: http2Server,
        }),
      ],
    });

    await server.start();
    app.use(cors());
    app.use(bodyParser());
    app.use(koaMiddleware(server));
    await new Promise<void>((resolve) => {
      http2Server.listen({ port: 0 }, resolve);
    });
    const url = urlForHttpServer(http2Server);

    const client = http2.connect(url);
    client.on('error', (err) => console.error(err));

    const body = JSON.stringify({ query: '{hello}' });
    const contentLength = Buffer.byteLength(body);
    const req = client.request({
      ':method': 'POST',
      ':path': '/',
      'content-type': 'application/json',
      'content-length': contentLength,
    });
    req.write(body);

    req.setEncoding('utf8');
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });

    let r: () => void;
    const p = new Promise<void>((resolve) => (r = resolve));
    req.on('end', () => {
      client.close(r);
    });

    req.end();
    await p;
    expect(data).toMatchInlineSnapshot(`
      "{"data":{"hello":"hello world!"}}
      "
    `);

    client.destroy();
    await server.stop();
  });
});
