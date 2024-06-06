import './global-types';
import './field-builder';
import './input-field-builder';
import './schema-builder';
import { GraphQLFieldResolver, GraphQLResolveInfo } from 'graphql';
import SchemaBuilder, {
  BasePlugin,
  createInputValueMapper,
  mapInputFields,
  PothosOutputFieldConfig,
  SchemaTypes,
} from '@pothos/core';
import { internalDecodeGlobalID } from './utils/internal';

export * from './node-ref';
export * from './types';
export * from './utils';

const pluginName = 'relay';

export default pluginName;

export class PothosRelayPlugin<Types extends SchemaTypes> extends BasePlugin<Types> {
  override wrapResolve(
    resolver: GraphQLFieldResolver<unknown, Types['Context'], object>,
    fieldConfig: PothosOutputFieldConfig<Types>,
  ): GraphQLFieldResolver<unknown, Types['Context'], object> {
    const argMappings = mapInputFields(fieldConfig.args, this.buildCache, (inputField) => {
      if (inputField.extensions?.isRelayGlobalID) {
        return (inputField.extensions?.relayGlobalIDFor ??
          inputField.extensions?.relayGlobalIDAlwaysParse ??
          false) as { typename: string; parseId: (id: string, ctx: object) => unknown }[] | boolean;
      }

      return null;
    });

    if (!argMappings) {
      return resolver;
    }

    const argMapper = createInputValueMapper(
      argMappings,
      (globalID, mappings, ctx: Types['Context'], info: GraphQLResolveInfo) =>
        internalDecodeGlobalID(this.builder, String(globalID), ctx, info, mappings.value ?? false),
    );

    return (parent, args, context, info) =>
      resolver(parent, argMapper(args, undefined, context, info), context, info);
  }

  override wrapSubscribe(
    subscribe: GraphQLFieldResolver<unknown, Types['Context'], object> | undefined,
    fieldConfig: PothosOutputFieldConfig<Types>,
  ): GraphQLFieldResolver<unknown, Types['Context'], object> | undefined {
    const argMappings = mapInputFields(fieldConfig.args, this.buildCache, (inputField) => {
      if (inputField.extensions?.isRelayGlobalID) {
        return (inputField.extensions?.relayGlobalIDFor ?? true) as
          | { typename: string; parseId: (id: string, ctx: object) => unknown }[]
          | true;
      }

      return null;
    });

    if (!argMappings || !subscribe) {
      return subscribe;
    }

    const argMapper = createInputValueMapper(
      argMappings,
      (globalID, mappings, ctx: Types['Context'], info: GraphQLResolveInfo) =>
        internalDecodeGlobalID(
          this.builder,
          String(globalID),
          ctx,
          info,
          Array.isArray(mappings.value) ? mappings.value : false,
        ),
    );

    return (parent, args, context, info) =>
      subscribe(parent, argMapper(args, undefined, context, info), context, info);
  }
}

SchemaBuilder.registerPlugin(pluginName, PothosRelayPlugin, {
  v3: (options) => ({
    relayOptions: undefined,
    relay: {
      ...(options.relayOptions as {}),
      clientMutationId: options.relayOptions?.clientMutationId ?? 'required',
      cursorType: options.relayOptions?.cursorType ?? 'ID',
      edgeCursorType:
        options.relayOptions?.edgeCursorType ?? options.relayOptions?.cursorType ?? 'String',
      pageInfoCursorType:
        options.relayOptions?.pageInfoCursorType ?? options.relayOptions?.cursorType ?? 'String',
      edgesFieldOptions: {
        ...options.relayOptions.edgesFieldOptions,
        nullable: options.relayOptions.edgesFieldOptions?.nullable ?? { list: false, items: true },
      },
      brandLoadedObjects: options.relayOptions.brandLoadedObjects ?? false,
    },
  }),
});
