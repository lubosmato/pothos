/* eslint-disable @typescript-eslint/consistent-type-assertions */
import {
  GraphQLFieldConfig,
  GraphQLFieldConfigArgumentMap,
  GraphQLInterfaceType,
  GraphQLObjectType,
} from 'graphql';
// @ts-ignore
import fromEntries from 'object.fromentries';
import { TypeParam, InputFieldMap, FieldNullability } from './types';
import { typeFromParam } from './utils';
import { BuildCache, outputFieldShapeKey, SchemaTypes, RootName, InputField } from '.';
import { BasePlugin, wrapResolver } from './plugins';

export default class Field<T> {
  [outputFieldShapeKey]: T;

  nullable: FieldNullability<TypeParam<SchemaTypes>>;

  args: InputFieldMap;

  type: TypeParam<SchemaTypes>;

  options: GiraphQLSchemaTypes.FieldOptions;

  parentTypename: string;

  kind: 'Object' | 'Interface' | RootName;

  constructor(
    options: GiraphQLSchemaTypes.FieldOptions,
    parentTypename: string,
    kind: 'Object' | 'Interface' | RootName,
  ) {
    this.options = options;
    this.nullable = options.nullable ?? false;
    this.args = options.args ? options.args! : ({} as InputFieldMap);
    this.type = options.type;
    this.parentTypename = parentTypename;
    this.kind = kind;
  }

  protected buildArgs(cache: BuildCache): GraphQLFieldConfigArgumentMap {
    return fromEntries(
      Object.keys(this.args).map((key) => {
        const arg = this.args[key];

        return [key, (arg as InputField<unknown>).build(cache)];
      }),
    ) as GraphQLFieldConfigArgumentMap;
  }

  build(
    type: GraphQLObjectType | GraphQLInterfaceType,
    name: string,
    cache: BuildCache,
    plugin: Required<BasePlugin>,
  ): GraphQLFieldConfig<unknown, object> {
    const baseConfig: GraphQLFieldConfig<unknown, object> = {
      args: this.buildArgs(cache),
      description: this.options.description,
      resolve:
        cache.resolverMock(this.parentTypename, name) ??
        (this.options as { resolve?: (...args: unknown[]) => unknown }).resolve ??
        (() => {
          throw new Error(`Not implemented: No resolver found for ${this.parentTypename}.${name}`);
        }),
      subscribe:
        cache.subscribeMock(this.parentTypename, name) ??
        (this.options as { subscribe?: (...args: unknown[]) => unknown }).subscribe,
      type: typeFromParam(this.type, cache, this.nullable),
      extensions: {
        ...this.options.extensions,
        giraphqlOptions: this.options,
      },
    };

    const config = plugin.updateFieldConfig(type, name, baseConfig, cache);

    wrapResolver(type, name, config, plugin, cache);

    return config;
  }
}
