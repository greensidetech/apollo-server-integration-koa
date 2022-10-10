import type { WithRequired } from '@apollo/utils.withrequired';
import type {
  ApolloServer,
  BaseContext,
  ContextFunction,
  HTTPGraphQLRequest,
} from '@apollo/server';
import { parse } from 'url';
import type Koa from 'koa';
// we need the extended `Request` type from `koa-bodyparser`,
// this is similar to an effectful import but for types, since
// the `koa-bodyparser` types "polyfill" the `koa` types
import type * as _ from 'koa-bodyparser';

export interface KoaContextFunctionArgument {
  ctx: Koa.Context;
}

interface KoaMiddlewareOptions<TContext extends BaseContext> {
  context?: ContextFunction<[KoaContextFunctionArgument], TContext>;
}

export function koaMiddleware(
  server: ApolloServer<BaseContext>,
  options?: KoaMiddlewareOptions<BaseContext>,
): Koa.Middleware;
export function koaMiddleware<TContext extends BaseContext>(
  server: ApolloServer<TContext>,
  options: WithRequired<KoaMiddlewareOptions<TContext>, 'context'>,
): Koa.Middleware;
export function koaMiddleware<TContext extends BaseContext>(
  server: ApolloServer<TContext>,
  options?: KoaMiddlewareOptions<TContext>,
): Koa.Middleware {
  server.assertStarted('koaMiddleware()');

  // This `any` is safe because the overload above shows that context can
  // only be left out if you're using BaseContext as your context, and {} is a
  // valid BaseContext.
  const defaultContext: ContextFunction<
    [KoaContextFunctionArgument],
    any
  > = async () => ({});

  const context: ContextFunction<[KoaContextFunctionArgument], TContext> =
    options?.context ?? defaultContext;

  return async (ctx, next) => {
    if (!ctx.request.body) {
      // The json koa-bodyparser *always* sets ctx.request.body to {} if it's unset (even
      // if the Content-Type doesn't match), so if it isn't set, you probably
      // forgot to set up koa-bodyparser.
      ctx.status = 500;
      ctx.body =
        '`ctx.request.body` is not set; this probably means you forgot to set up the ' +
        '`koa-bodyparser` middleware before the Apollo Server middleware.';
      return;
    }

    const headers = new Map<string, string>();
    for (const [key, value] of Object.entries(ctx.headers)) {
      if (value !== undefined) {
        // Node/Koa headers can be an array or a single value. We join
        // multi-valued headers with `, ` just like the Fetch API's `Headers`
        // does. We assume that keys are already lower-cased (as per the Node
        // docs on IncomingMessage.headers) and so we don't bother to lower-case
        // them or combine across multiple keys that would lower-case to the
        // same value.
        headers.set(
          key,
          Array.isArray(value) ? value.join(', ') : (value as string),
        );
      }
    }

    const httpGraphQLRequest: HTTPGraphQLRequest = {
      method: ctx.method.toUpperCase(),
      headers,
      search: parse(ctx.url).search ?? '',
      body: ctx.request.body,
    };

    Object.entries(Object.fromEntries(headers));

    try {
      const { body, headers, status } = await server.executeHTTPGraphQLRequest({
        httpGraphQLRequest,
        context: () => context({ ctx }),
      });

      for (const [key, value] of headers) {
        ctx.set(key, value);
      }

      ctx.status = status || 200;

      if (body.kind === 'complete') {
        ctx.body = body.string;
        return;
      } else if (body.kind === 'chunked') {
        for await (const chunk of body.asyncIterator) {
          ctx.response.res.write(chunk);
        }
        ctx.response.res.end();
      }

      return;
    } catch {
      await next();
    }
  };
}
