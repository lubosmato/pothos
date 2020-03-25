import {
  defaultFieldResolver,
  GraphQLOutputType,
  GraphQLNonNull,
  GraphQLList,
  GraphQLScalarType,
  GraphQLEnumType,
  GraphQLFieldConfig,
  GraphQLResolveInfo,
} from 'graphql';
import { BasePlugin, BuildCache, Field } from '..';
import { TypeParam } from '../types';

export class ResolveValueWrapper {
  value: unknown;

  data: Partial<GiraphQLSchemaTypes.ResolverPluginData> = {};

  constructor(value: unknown) {
    this.value = value;
  }

  unwrap() {
    return this.value;
  }

  static wrap(value: unknown) {
    if (value instanceof ResolveValueWrapper) {
      return value;
    }

    return new ResolveValueWrapper(value);
  }
}

export function isScalar(type: GraphQLOutputType): boolean {
  if (type instanceof GraphQLNonNull) {
    return isScalar(type.ofType);
  }

  if (type instanceof GraphQLList) {
    return isScalar(type.ofType);
  }

  return type instanceof GraphQLScalarType || type instanceof GraphQLEnumType;
}

export function isList(type: GraphQLOutputType): boolean {
  if (type instanceof GraphQLNonNull) {
    return isList(type.ofType);
  }

  return type instanceof GraphQLList;
}

export function assertArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError('List resolvers must return arrays');
  }

  return true;
}

export function wrapResolver(
  name: string,
  field: Field<{}, any, TypeParam<any>>,
  config: GraphQLFieldConfig<unknown, object>,
  plugin: Required<BasePlugin>,
  cache: BuildCache,
) {
  const originalResolver = config.resolve || defaultFieldResolver;
  const originalSubscribe = config.subscribe;
  const partialFieldData: Partial<GiraphQLSchemaTypes.FieldWrapData> = {
    resolve: originalResolver,
  };

  const isListResolver = isList(config.type);
  const isScalarResolver = isScalar(config.type);

  // assume that onFieldWrap plugins added required props, if plugins fail to do this,
  // they are breaking the plugin contract.
  const fieldData = partialFieldData as GiraphQLSchemaTypes.FieldWrapData;

  const wrappedResolver = async (
    originalParent: unknown,
    args: {},
    context: object,
    info: GraphQLResolveInfo,
  ) => {
    const parent = ResolveValueWrapper.wrap(originalParent);

    const resolveHooks = await plugin.beforeResolve(parent, fieldData, args, context, info);

    const result = await fieldData.resolve(parent.value, args, context, info);

    await resolveHooks?.onResolve?.(result);

    if (result === null || result === undefined || isScalarResolver) {
      return result;
    }

    if (isListResolver && assertArray(result)) {
      const wrappedResults: unknown[] = [];

      for (const item of result) {
        wrappedResults.push(
          Promise.resolve(item).then(async resolved => {
            const wrapped = ResolveValueWrapper.wrap(resolved);

            wrapped.data.parentFieldData = fieldData;

            await resolveHooks?.onWrap?.(wrapped);

            return wrapped;
          }),
        );
      }

      return wrappedResults;
    }

    const wrapped = ResolveValueWrapper.wrap(result);

    wrapped.data.parentFieldData = fieldData;

    await resolveHooks?.onWrap?.(wrapped);

    return wrapped;
  };

  if (originalSubscribe) {
    const wrappedSubscribe = async (
      originalParent: unknown,
      args: {},
      context: object,
      info: GraphQLResolveInfo,
    ) => {
      const parent = ResolveValueWrapper.wrap(originalParent);

      const subscribeHook = await plugin.beforeSubscribe(parent, fieldData, args, context, info);

      const result: AsyncIterable<unknown> = await originalSubscribe(
        parent.value,
        args,
        context,
        info,
      );

      await subscribeHook?.onSubscribe?.(result);

      if (!result) {
        return result;
      }

      return {
        [Symbol.asyncIterator]: () => {
          if (typeof result[Symbol.asyncIterator] !== 'function') {
            return result;
          }

          const iter = result[Symbol.asyncIterator]();

          return {
            next: async () => {
              const { done, value } = await iter.next();

              const wrapped = ResolveValueWrapper.wrap(value);

              await subscribeHook?.onWrap?.(wrapped);

              return { value: wrapped, done };
            },
            return: iter.return?.bind(iter),
            throw: iter.throw?.bind(iter),
          };
        },
      };
    };

    config.subscribe = wrappedSubscribe; // eslint-disable-line no-param-reassign
  }

  wrappedResolver.unwrap = () => originalResolver;

  config.resolve = wrappedResolver; // eslint-disable-line no-param-reassign

  plugin.onFieldWrap(name, field, config, partialFieldData, cache);
}