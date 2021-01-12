import ts from "typescript";

import { Factory } from "../../CodeGenerator";
import { UnsetTypeError } from "../../Exception";
import { UnSupportError, UnknownError } from "../../Exception";
import * as Logger from "../../Logger";
import * as Reference from "./components/Reference";
import * as Guard from "./Guard";
import { OpenApi } from "./types";
import { ObjectSchemaWithAdditionalProperties } from "./types";

export interface Context {
  setReferenceHandler: (reference: Reference.Type<OpenApi.Schema | OpenApi.JSONSchemaDefinition>) => void;
  getReferenceName: (currentPoint: string, referencePath: string) => string;
}

export type Convert = (
  entryPoint: string,
  currentPoint: string,
  factory: Factory.Type,
  schema: OpenApi.Schema | OpenApi.Reference | OpenApi.JSONSchemaDefinition,
  setReference: Context,
  option?: Option,
) => ts.TypeNode;

export interface Option {
  parent?: any;
}

export const generateMultiTypeNode = (
  entryPoint: string,
  currentPoint: string,
  factory: Factory.Type,
  schemas: OpenApi.JSONSchema[],
  setReference: Context,
  convert: Convert,
  multiType: "oneOf" | "allOf" | "anyOf",
): ts.TypeNode => {
  const typeNodes = schemas.map(schema => convert(entryPoint, currentPoint, factory, schema, setReference));
  if (multiType === "oneOf") {
    return factory.UnionTypeNode.create({
      typeNodes,
    });
  }
  if (multiType === "allOf") {
    return factory.IntersectionTypeNode.create({
      typeNodes,
    });
  }
  // TODO Feature Development: Calculate intersection types
  return factory.TypeNode.create({ type: "never" });
};

const nullable = (factory: Factory.Type, typeNode: ts.TypeNode, nullable: boolean): ts.TypeNode => {
  if (nullable) {
    return factory.UnionTypeNode.create({
      typeNodes: [
        typeNode,
        factory.TypeNode.create({
          type: "null",
        }),
      ],
    });
  }
  return typeNode;
};

export const convert: Convert = (
  entryPoint: string,
  currentPoint: string,
  factory: Factory.Type,
  schema: OpenApi.Schema | OpenApi.Reference | OpenApi.JSONSchemaDefinition,
  context: Context,
  option?: Option,
): ts.TypeNode => {
  if (typeof schema === "boolean") {
    // https://swagger.io/docs/specification/data-models/dictionaries/#free-form
    return factory.TypeNode.create({
      type: "object",
      value: [],
    });
  }
  if (Guard.isReference(schema)) {
    const reference = Reference.generate<OpenApi.Schema | OpenApi.JSONSchemaDefinition>(entryPoint, currentPoint, schema);
    if (reference.type === "local") {
      // Type Aliasを作成 (or すでにある場合は作成しない)
      context.setReferenceHandler(reference);
      return factory.TypeReferenceNode.create({ name: context.getReferenceName(currentPoint, reference.path) });
    }
    // サポートしているディレクトリに対して存在する場合
    if (reference.componentName) {
      // Type AliasもしくはInterfaceを作成
      context.setReferenceHandler(reference);
      // Aliasを貼る
      return factory.TypeReferenceNode.create({ name: context.getReferenceName(currentPoint, reference.path) });
    }
    // サポートしていないディレクトリに存在する場合、直接Interface、もしくはTypeAliasを作成
    return convert(entryPoint, reference.referencePoint, factory, reference.data, context, { parent: schema });
  }

  if (Guard.isOneOfSchema(schema)) {
    return generateMultiTypeNode(entryPoint, currentPoint, factory, schema.oneOf, context, convert, "oneOf");
  }
  if (Guard.isAllOfSchema(schema)) {
    return generateMultiTypeNode(entryPoint, currentPoint, factory, schema.allOf, context, convert, "allOf");
  }
  if (Guard.isAnyOfSchema(schema)) {
    return generateMultiTypeNode(entryPoint, currentPoint, factory, schema.anyOf, context, convert, "anyOf");
  }

  // schema.type
  if (!schema.type) {
    if (option && option.parent) {
      Logger.info("Parent Schema:");
      Logger.info(JSON.stringify(option.parent));
    }
    Logger.showFilePosition(entryPoint, currentPoint);
    throw new UnsetTypeError("Please set 'type' or '$ref' property \n" + JSON.stringify(schema));
  }
  switch (schema.type) {
    case "boolean": {
      const typeNode = factory.TypeNode.create({
        type: "boolean",
      });
      return nullable(factory, typeNode, !!schema.nullable);
    }
    case "null": {
      return factory.TypeNode.create({
        type: schema.type,
      });
    }
    case "integer":
    case "number": {
      const items = schema.enum;
      let typeNode: ts.TypeNode;
      if (items && Guard.isNumberArray(items)) {
        typeNode = factory.TypeNode.create({
          type: schema.type,
          enum: items,
        });
      } else {
        typeNode = factory.TypeNode.create({
          type: schema.type,
        });
      }
      return nullable(factory, typeNode, !!schema.nullable);
    }
    case "string": {
      const items = schema.enum;
      let typeNode: ts.TypeNode;
      if (items && Guard.isStringArray(items)) {
        typeNode = factory.TypeNode.create({
          type: schema.type,
          enum: items,
        });
      } else {
        typeNode = factory.TypeNode.create({
          type: schema.type,
        });
      }
      return nullable(factory, typeNode, !!schema.nullable);
    }
    case "array": {
      if (Array.isArray(schema.items) || typeof schema.items === "boolean") {
        throw new UnSupportError(`schema.items = ${JSON.stringify(schema.items)}`);
      }
      const typeNode = factory.TypeNode.create({
        type: schema.type,
        value: schema.items
          ? convert(entryPoint, currentPoint, factory, schema.items, context, { parent: schema })
          : factory.TypeNode.create({
              type: "undefined",
            }),
      });
      return nullable(factory, typeNode, !!schema.nullable);
    }
    case "object": {
      if (!schema.properties) {
        return factory.TypeNode.create({
          type: "object",
          value: [],
        });
      }
      let typeNode: ts.TypeNode;
      const required: string[] = schema.required || [];
      // https://swagger.io/docs/specification/data-models/dictionaries/#free-form
      if (schema.additionalProperties === true) {
        typeNode = factory.TypeNode.create({
          type: schema.type,
          value: [],
        });
      } else {
        const value: ts.PropertySignature[] = Object.entries(schema.properties).map(([name, jsonSchema]) => {
          return factory.PropertySignature.create({
            name,
            type: convert(entryPoint, currentPoint, factory, jsonSchema, context, { parent: schema.properties }),
            optional: !required.includes(name),
            comment: typeof jsonSchema !== "boolean" ? jsonSchema.description : undefined,
          });
        });
        if (schema.additionalProperties) {
          const additionalProperties = factory.IndexSignatureDeclaration.create({
            name: "key",
            type: convert(entryPoint, currentPoint, factory, schema.additionalProperties, context, { parent: schema.properties }),
          });
          return factory.TypeNode.create({
            type: schema.type,
            value: [...value, additionalProperties],
          });
        }
        typeNode = factory.TypeNode.create({
          type: schema.type,
          value,
        });
      }
      return nullable(factory, typeNode, !!schema.nullable);
    }
    default:
      throw new UnknownError("what is this? \n" + JSON.stringify(schema, null, 2));
  }
};

export const convertAdditionalProperties = (
  entryPoint: string,
  currentPoint: string,
  factory: Factory.Type,
  schema: ObjectSchemaWithAdditionalProperties,
  setReference: Context,
): ts.IndexSignatureDeclaration => {
  // // https://swagger.io/docs/specification/data-models/dictionaries/#free-form
  if (schema.additionalProperties === true) {
    factory.TypeNode.create({
      type: schema.type,
      value: [],
    });
  }
  const additionalProperties = factory.IndexSignatureDeclaration.create({
    name: "key",
    type: convert(entryPoint, currentPoint, factory, schema.additionalProperties, setReference, { parent: schema.properties }),
  });
  return additionalProperties;
};