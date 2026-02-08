/**
 * Schema Extractor
 *
 * Extracts JSON schemas from TypeScript method signatures and JSDoc comments
 * Also extracts constructor parameters for config injection
 * Supports Templates (@Template) and Static resources (@Static)
 *
 * Now uses TypeScript's compiler API for robust type parsing
 */

import * as fs from 'fs/promises';
import * as ts from 'typescript';
import { ExtractedSchema, ConstructorParam, TemplateInfo, StaticInfo, OutputFormat, YieldInfo, MCPDependency, PhotonDependency, CLIDependency, ResolvedInjection, PhotonAssets, UIAsset, PromptAsset, ResourceAsset, ConfigSchema, ConfigParam } from './types.js';

export interface ExtractedMetadata {
  tools: ExtractedSchema[];
  templates: TemplateInfo[];
  statics: StaticInfo[];
  /** Configuration schema from configure() method */
  configSchema?: ConfigSchema;
}

/**
 * Extract schemas from a Photon MCP class file
 */
export class SchemaExtractor {
  /**
   * Extract method schemas from source code file
   */
  async extractFromFile(filePath: string): Promise<ExtractedSchema[]> {
    try {
      const source = await fs.readFile(filePath, 'utf-8');
      return this.extractFromSource(source);
    } catch (error: any) {
      console.error(`Failed to extract schemas from ${filePath}: ${error.message}`);
      return [];
    }
  }

  /**
   * Extract all metadata (tools, templates, statics) from source code
   */
  extractAllFromSource(source: string): ExtractedMetadata {
    const tools: ExtractedSchema[] = [];
    const templates: TemplateInfo[] = [];
    const statics: StaticInfo[] = [];

    // Configuration schema tracking
    let configSchema: ConfigSchema = {
      hasConfigureMethod: false,
      hasGetConfigMethod: false,
      params: [],
    };

    try {
      // If source doesn't contain a class declaration, wrap it in one
      let sourceToParse = source;
      if (!source.includes('class ')) {
        sourceToParse = `export default class Temp {\n${source}\n}`;
      }

      // Parse source file into AST
      const sourceFile = ts.createSourceFile(
        'temp.ts',
        sourceToParse,
        ts.ScriptTarget.Latest,
        true
      );

      // Helper to process a method declaration
      const processMethod = (member: ts.MethodDeclaration) => {
        const methodName = member.name.getText(sourceFile);

        // Skip private methods (prefixed with _)
        if (methodName.startsWith('_')) {
          return;
        }

        // Handle configuration convention methods specially
        if (methodName === 'configure') {
          configSchema.hasConfigureMethod = true;
          const jsdoc = this.getJSDocComment(member, sourceFile);
          configSchema.description = this.extractDescription(jsdoc);

          // Extract configure() parameters as config schema
          const paramsType = this.getFirstParameterType(member, sourceFile);
          if (paramsType) {
            const { properties, required } = this.buildSchemaFromType(paramsType, sourceFile);
            const paramDocs = this.extractParamDocs(jsdoc);

            configSchema.params = Object.keys(properties).map(name => ({
              name,
              type: properties[name].type || 'string',
              description: paramDocs.get(name) || properties[name].description,
              required: required.includes(name),
              defaultValue: properties[name].default,
            }));
          }
          return; // Don't add configure() as a tool
        }

        if (methodName === 'getConfig') {
          configSchema.hasGetConfigMethod = true;
          return; // Don't add getConfig() as a tool
        }

        const jsdoc = this.getJSDocComment(member, sourceFile);

        // Check if this is an async generator method (has asterisk token)
        const isGenerator = member.asteriskToken !== undefined;

        // Extract parameter type information
        // Extract parameter type (may be undefined for no-arg methods)
        const paramsType = this.getFirstParameterType(member, sourceFile);

        // Build schema from TypeScript type (empty for no-arg methods)
        const { properties, required } = paramsType
          ? this.buildSchemaFromType(paramsType, sourceFile)
          : { properties: {}, required: [] };

        // Extract descriptions from JSDoc
        const paramDocs = this.extractParamDocs(jsdoc);
        const paramConstraints = this.extractParamConstraints(jsdoc);

        // Merge descriptions and constraints into properties
        Object.keys(properties).forEach(key => {
          if (paramDocs.has(key)) {
            properties[key].description = paramDocs.get(key);
          }

          // Apply TypeScript-extracted metadata (before JSDoc, so JSDoc can override)
          if (properties[key]._tsReadOnly) {
            properties[key].readOnly = true;
            delete properties[key]._tsReadOnly; // Clean up internal marker
          }

          // Apply JSDoc constraints (takes precedence over TypeScript)
          if (paramConstraints.has(key)) {
            const constraints = paramConstraints.get(key)!;
            this.applyConstraints(properties[key], constraints);
          }
        });

        const description = this.extractDescription(jsdoc);
        const inputSchema = {
          type: 'object' as const,
          properties,
          ...(required.length > 0 ? { required } : {}),
        };

        // Check if this is a Template
        if (this.hasTemplateTag(jsdoc)) {
          templates.push({
            name: methodName,
            description,
            inputSchema,
          });
        }
        // Check if this is a Static resource
        else if (this.hasStaticTag(jsdoc)) {
          const uri = this.extractStaticURI(jsdoc) || `static://${methodName}`;
          const mimeType = this.extractMimeType(jsdoc);

          statics.push({
            name: methodName,
            uri,
            description,
            mimeType,
            inputSchema,
          });
        }
        // Otherwise, it's a regular tool
        else {
          const outputFormat = this.extractFormat(jsdoc);
          const layoutHints = this.extractLayoutHints(jsdoc);
          const buttonLabel = this.extractButtonLabel(jsdoc);
          const icon = this.extractIcon(jsdoc);
          const yields = isGenerator ? this.extractYieldsFromJSDoc(jsdoc) : undefined;
          const isStateful = this.hasStatefulTag(jsdoc);
          const autorun = this.hasAutorunTag(jsdoc);
          const isAsync = this.hasAsyncTag(jsdoc);

          // Daemon features
          const webhook = this.extractWebhook(jsdoc, methodName);
          const scheduled = this.extractScheduled(jsdoc, methodName);
          const locked = this.extractLocked(jsdoc, methodName);

          // Check for static keyword on the method
          const isStaticMethod = member.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword) || false;

          tools.push({
            name: methodName,
            description,
            inputSchema,
            ...(outputFormat ? { outputFormat } : {}),
            ...(layoutHints ? { layoutHints } : {}),
            ...(buttonLabel ? { buttonLabel } : {}),
            ...(icon ? { icon } : {}),
            ...(isGenerator ? { isGenerator: true } : {}),
            ...(yields && yields.length > 0 ? { yields } : {}),
            ...(isStateful ? { isStateful: true } : {}),
            ...(autorun ? { autorun: true } : {}),
            ...(isAsync ? { isAsync: true } : {}),
            ...(isStaticMethod ? { isStatic: true } : {}),
            // Daemon features
            ...(webhook !== undefined ? { webhook } : {}),
            ...(scheduled ? { scheduled } : {}),
            ...(locked !== undefined ? { locked } : {}),
          });
        }
      };

      // Visit all nodes in the AST
      const visit = (node: ts.Node) => {
        // Look for class declarations
        if (ts.isClassDeclaration(node)) {
          node.members.forEach((member) => {
            // Look for async methods (including async generators with *)
            if (ts.isMethodDeclaration(member) &&
                member.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)) {
              processMethod(member);
            }
          });
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    } catch (error: any) {
      console.error('Failed to parse TypeScript source:', error.message);
    }

    // Only include configSchema if there's a configure() method
    const result: ExtractedMetadata = { tools, templates, statics };
    if (configSchema.hasConfigureMethod) {
      result.configSchema = configSchema;
    }
    return result;
  }

  /**
   * Extract schemas from source code string (backward compatibility)
   */
  extractFromSource(source: string): ExtractedSchema[] {
    return this.extractAllFromSource(source).tools;
  }

  /**
   * Get JSDoc comment for a node
   */
  private getJSDocComment(node: ts.Node, sourceFile: ts.SourceFile): string {
    // Use TypeScript's JSDoc extraction
    const jsDocs = (node as any).jsDoc;
    if (jsDocs && jsDocs.length > 0) {
      const jsDoc = jsDocs[0];
      const comment = jsDoc.comment;

      // Get full JSDoc text including tags
      const fullText = sourceFile.getFullText();
      const start = jsDoc.pos;
      const end = jsDoc.end;
      const jsDocText = fullText.substring(start, end);

      // Extract content between /** and */
      const match = jsDocText.match(/\/\*\*([\s\S]*?)\*\//);
      return match ? match[1] : '';
    }

    return '';
  }

  /**
   * Get the first parameter's type node
   */
  private getFirstParameterType(method: ts.MethodDeclaration, sourceFile: ts.SourceFile): ts.TypeNode | undefined {
    if (method.parameters.length === 0) {
      return undefined;
    }

    const firstParam = method.parameters[0];
    return firstParam.type;
  }

  /**
   * Build JSON schema from TypeScript type node
   * Extracts: type, optional, readonly
   */
  private buildSchemaFromType(typeNode: ts.TypeNode, sourceFile: ts.SourceFile): { properties: Record<string, any>, required: string[] } {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    // Handle union types (e.g., { ip: string } | string)
    // Extract properties from the first object type member
    if (ts.isUnionTypeNode(typeNode)) {
      for (const memberType of typeNode.types) {
        if (ts.isTypeLiteralNode(memberType)) {
          // Found an object type in the union, extract its properties
          return this.buildSchemaFromType(memberType, sourceFile);
        }
      }
      // No object type found in union, return empty
      return { properties, required };
    }

    // Handle type literal (object type)
    if (ts.isTypeLiteralNode(typeNode)) {
      typeNode.members.forEach((member) => {
        if (ts.isPropertySignature(member) && member.name) {
          const propName = member.name.getText(sourceFile);
          const isOptional = member.questionToken !== undefined;
          const isReadonly = member.modifiers?.some(m => m.kind === ts.SyntaxKind.ReadonlyKeyword) || false;

          if (!isOptional) {
            required.push(propName);
          }

          if (member.type) {
            properties[propName] = this.typeNodeToSchema(member.type, sourceFile);
          } else {
            properties[propName] = { type: 'object' };
          }

          // Add readonly from TypeScript (JSDoc can override)
          if (isReadonly) {
            properties[propName]._tsReadOnly = true;
          }
        }
      });
    }

    return { properties, required };
  }

  /**
   * Convert TypeScript type node to JSON schema
   */
  private typeNodeToSchema(typeNode: ts.TypeNode, sourceFile: ts.SourceFile): any {
    const schema: any = {};

    // Handle union types
    if (ts.isUnionTypeNode(typeNode)) {
      // Check if this is a union of literals that can be converted to enum
      const enumValues = this.extractEnumFromUnion(typeNode, sourceFile);
      if (enumValues) {
        return enumValues;
      }

      // Otherwise use anyOf
      schema.anyOf = typeNode.types.map(t => this.typeNodeToSchema(t, sourceFile));
      return schema;
    }

    // Handle intersection types
    if (ts.isIntersectionTypeNode(typeNode)) {
      schema.allOf = typeNode.types.map(t => this.typeNodeToSchema(t, sourceFile));
      return schema;
    }

    // Handle array types
    if (ts.isArrayTypeNode(typeNode)) {
      schema.type = 'array';
      schema.items = this.typeNodeToSchema(typeNode.elementType, sourceFile);
      return schema;
    }

    // Handle type reference (e.g., Array<string>, DiagramType)
    if (ts.isTypeReferenceNode(typeNode)) {
      const typeName = typeNode.typeName.getText(sourceFile);

      if (typeName === 'Array' && typeNode.typeArguments && typeNode.typeArguments.length > 0) {
        schema.type = 'array';
        schema.items = this.typeNodeToSchema(typeNode.typeArguments[0], sourceFile);
        return schema;
      }

      // Try to resolve type alias
      const resolvedType = this.resolveTypeAlias(typeName, sourceFile);
      if (resolvedType) {
        return this.typeNodeToSchema(resolvedType, sourceFile);
      }

      // For unresolved type references, default to object
      schema.type = 'object';
      return schema;
    }

    // Handle literal types
    if (ts.isLiteralTypeNode(typeNode)) {
      const literal = typeNode.literal;
      if (ts.isStringLiteral(literal)) {
        schema.type = 'string';
        schema.enum = [literal.text];
        return schema;
      }
      if (ts.isNumericLiteral(literal)) {
        schema.type = 'number';
        schema.enum = [parseFloat(literal.text)];
        return schema;
      }
      if (literal.kind === ts.SyntaxKind.TrueKeyword || literal.kind === ts.SyntaxKind.FalseKeyword) {
        schema.type = 'boolean';
        return schema;
      }
    }

    // Handle tuple types
    if (ts.isTupleTypeNode(typeNode)) {
      schema.type = 'array';
      schema.items = typeNode.elements.map(e => this.typeNodeToSchema(e, sourceFile));
      return schema;
    }

    // Handle type literal (nested object)
    if (ts.isTypeLiteralNode(typeNode)) {
      schema.type = 'object';
      const { properties, required } = this.buildSchemaFromType(typeNode, sourceFile);
      schema.properties = properties;
      if (required.length > 0) {
        schema.required = required;
      }
      return schema;
    }

    // Handle keyword types (string, number, boolean, etc.)
    const typeText = typeNode.getText(sourceFile);
    switch (typeText) {
      case 'string':
        schema.type = 'string';
        break;
      case 'number':
        schema.type = 'number';
        break;
      case 'boolean':
        schema.type = 'boolean';
        break;
      case 'any':
      case 'unknown':
        // No type restriction
        break;
      default:
        // Default to object for complex types
        schema.type = 'object';
    }

    return schema;
  }

  /**
   * Resolve a type alias to its underlying type node
   * Searches the source file for type alias declarations
   */
  private resolveTypeAlias(typeName: string, sourceFile: ts.SourceFile): ts.TypeNode | null {
    let resolved: ts.TypeNode | null = null;

    const visit = (node: ts.Node) => {
      if (resolved) return; // Already found

      if (ts.isTypeAliasDeclaration(node) && node.name.text === typeName) {
        resolved = node.type;
        return;
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return resolved;
  }

  /**
   * Extract enum values from a union of literal types
   * Returns a proper enum schema if all types are literals of the same kind
   * Returns an optimized anyOf schema for mixed unions (e.g., number | '+1' | '-1')
   * Returns null if the union should use standard anyOf processing
   */
  private extractEnumFromUnion(unionNode: ts.UnionTypeNode, sourceFile: ts.SourceFile): any | null {
    const stringLiterals: string[] = [];
    const numberLiterals: number[] = [];
    const booleanLiterals: boolean[] = [];
    const nonLiteralTypes: ts.TypeNode[] = [];

    // Categorize union members
    for (const typeNode of unionNode.types) {
      if (ts.isLiteralTypeNode(typeNode)) {
        const literal = typeNode.literal;

        if (ts.isStringLiteral(literal)) {
          stringLiterals.push(literal.text);
        } else if (ts.isNumericLiteral(literal)) {
          numberLiterals.push(parseFloat(literal.text));
        } else if (literal.kind === ts.SyntaxKind.TrueKeyword) {
          booleanLiterals.push(true);
        } else if (literal.kind === ts.SyntaxKind.FalseKeyword) {
          booleanLiterals.push(false);
        }
      } else {
        nonLiteralTypes.push(typeNode);
      }
    }

    // Case 1: All same-type literals - return simple enum
    if (nonLiteralTypes.length === 0) {
      if (stringLiterals.length > 0 && numberLiterals.length === 0 && booleanLiterals.length === 0) {
        return {
          type: 'string',
          enum: stringLiterals,
        };
      }

      if (numberLiterals.length > 0 && stringLiterals.length === 0 && booleanLiterals.length === 0) {
        return {
          type: 'number',
          enum: numberLiterals,
        };
      }

      if (booleanLiterals.length > 0 && stringLiterals.length === 0 && numberLiterals.length === 0) {
        return {
          type: 'boolean',
          enum: booleanLiterals,
        };
      }
    }

    // Case 2: Mixed union with literals - create optimized anyOf
    // Example: number | '+1' | '-1' → anyOf: [{ type: number }, { type: string, enum: ['+1', '-1'] }]
    if (nonLiteralTypes.length > 0 && (stringLiterals.length > 0 || numberLiterals.length > 0 || booleanLiterals.length > 0)) {
      const anyOf: any[] = [];

      // Add non-literal types
      for (const typeNode of nonLiteralTypes) {
        anyOf.push(this.typeNodeToSchema(typeNode, sourceFile));
      }

      // Add grouped string literals
      if (stringLiterals.length > 0) {
        anyOf.push({
          type: 'string',
          enum: stringLiterals,
        });
      }

      // Add grouped number literals
      if (numberLiterals.length > 0) {
        anyOf.push({
          type: 'number',
          enum: numberLiterals,
        });
      }

      // Add grouped boolean literals
      if (booleanLiterals.length > 0) {
        anyOf.push({
          type: 'boolean',
          enum: booleanLiterals,
        });
      }

      return { anyOf };
    }

    // Case 3: Complex union or mixed literal types - let standard anyOf handle it
    return null;
  }

  /**
   * Check if a type is a primitive (string, number, boolean)
   * Primitives are injected from environment variables
   */
  private isPrimitiveType(type: string): boolean {
    const normalizedType = type.trim().toLowerCase();
    return ['string', 'number', 'boolean'].includes(normalizedType);
  }

  /**
   * Extract constructor parameters for config injection
   */
  extractConstructorParams(source: string): ConstructorParam[] {
    const params: ConstructorParam[] = [];

    try {
      const sourceFile = ts.createSourceFile(
        'temp.ts',
        source,
        ts.ScriptTarget.Latest,
        true
      );

      const visit = (node: ts.Node) => {
        if (ts.isClassDeclaration(node)) {
          node.members.forEach((member) => {
            if (ts.isConstructorDeclaration(member)) {
              member.parameters.forEach((param) => {
                if (param.name && ts.isIdentifier(param.name)) {
                  const name = param.name.getText(sourceFile);
                  const type = param.type ? param.type.getText(sourceFile) : 'any';
                  const isOptional = param.questionToken !== undefined || param.initializer !== undefined;
                  const hasDefault = param.initializer !== undefined;

                  let defaultValue: any = undefined;
                  if (param.initializer) {
                    defaultValue = this.extractDefaultValue(param.initializer, sourceFile);
                  }

                  params.push({
                    name,
                    type,
                    isOptional,
                    hasDefault,
                    defaultValue,
                    isPrimitive: this.isPrimitiveType(type),
                  });
                }
              });
            }
          });
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    } catch (error: any) {
      console.error('Failed to extract constructor params:', error.message);
    }

    return params;
  }

  /**
   * Extract default value from initializer
   */
  private extractDefaultValue(initializer: ts.Expression, sourceFile: ts.SourceFile): any {
    // String literals
    if (ts.isStringLiteral(initializer)) {
      return initializer.text;
    }

    // Numeric literals
    if (ts.isNumericLiteral(initializer)) {
      return parseFloat(initializer.text);
    }

    // Boolean literals
    if (initializer.kind === ts.SyntaxKind.TrueKeyword) {
      return true;
    }
    if (initializer.kind === ts.SyntaxKind.FalseKeyword) {
      return false;
    }

    // For complex expressions (function calls, etc.), return as string
    return initializer.getText(sourceFile);
  }

  /**
   * Extract main description from JSDoc comment
   */
  private extractDescription(jsdocContent: string): string {
    // Split by @param to get only the description part (also stop at other @tags)
    const beforeTags = jsdocContent.split(/@(?:param|example|returns?|throws?|see|since|deprecated|version|author|license|ui|icon|format|stateful|autorun|async|webhook|cron|scheduled|locked|Template|Static|mcp|photon|cli|tags|dependencies|csp|visibility)\b/)[0];

    // Remove leading * from each line and trim
    const lines = beforeTags
      .split('\n')
      .map((line) => line.trim().replace(/^\*\s?/, ''))
      .filter((line) => line !== ''); // Keep non-empty lines

    // Take lines up to the first markdown heading (## sections are extended docs)
    const descLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('#')) break;
      descLines.push(line);
    }

    // Join all description lines into a single string
    const description = descLines.join(' ');

    // Clean up multiple spaces
    return description.replace(/\s+/g, ' ').trim() || 'No description';
  }

  /**
   * Extract parameter descriptions from JSDoc @param tags
   * Also removes constraint tags from descriptions
   */
  /**
   * Remove {@example ...} tags that may contain nested braces/brackets (JSON)
   */
  private removeExampleTags(text: string): string {
    let result = text;
    let searchStart = 0;

    while (true) {
      const exampleStart = result.indexOf('{@example ', searchStart);
      if (exampleStart === -1) break;

      const contentStart = exampleStart + '{@example '.length;
      let braceDepth = 0;
      let bracketDepth = 0;
      let i = contentStart;
      let inString = false;

      while (i < result.length) {
        const ch = result[i];
        const prevCh = i > 0 ? result[i - 1] : '';

        if (ch === '"' && prevCh !== '\\') {
          inString = !inString;
        } else if (!inString) {
          if (ch === '{') braceDepth++;
          else if (ch === '[') bracketDepth++;
          else if (ch === ']') bracketDepth--;
          else if (ch === '}') {
            if (braceDepth === 0 && bracketDepth === 0) {
              // Found the closing brace of the {@example} tag
              result = result.substring(0, exampleStart) + result.substring(i + 1);
              break;
            }
            braceDepth--;
          }
        }
        i++;
      }

      // Safety: if we didn't find closing brace, move past this tag
      if (i >= result.length) {
        searchStart = exampleStart + 1;
      }
    }

    return result;
  }

  private extractParamDocs(jsdocContent: string): Map<string, string> {
    const paramDocs = new Map<string, string>();
    const paramRegex = /@param\s+(\w+)\s+(.+)/g;

    let match;
    while ((match = paramRegex.exec(jsdocContent)) !== null) {
      const [, paramName, description] = match;
      // Remove {@example} tags first (handles nested braces/brackets)
      let cleanDesc = this.removeExampleTags(description);
      // Remove other constraint tags from description
      cleanDesc = cleanDesc
        .replace(/\{@min\s+[^}]+\}/g, '')
        .replace(/\{@max\s+[^}]+\}/g, '')
        .replace(/\{@pattern\s+[^}]+\}/g, '')
        .replace(/\{@format\s+[^}]+\}/g, '')
        .replace(/\{@choice\s+[^}]+\}/g, '')
        .replace(/\{@field\s+[^}]+\}/g, '')
        .replace(/\{@default\s+[^}]+\}/g, '')
        .replace(/\{@unique(?:Items)?\s*\}/g, '')
        .replace(/\{@multipleOf\s+[^}]+\}/g, '')
        .replace(/\{@deprecated(?:\s+[^}]+)?\}/g, '')
        .replace(/\{@readOnly\s*\}/g, '')
        .replace(/\{@writeOnly\s*\}/g, '')
        .replace(/\{@label\s+[^}]+\}/g, '')
        .replace(/\{@placeholder\s+[^}]+\}/g, '')
        .replace(/\{@hint\s+[^}]+\}/g, '')
        .replace(/\{@hidden\s*\}/g, '')
        .replace(/\{@accept\s+[^}]+\}/g, '')
        .replace(/\s+/g, ' ')  // Collapse multiple spaces
        .trim();
      paramDocs.set(paramName, cleanDesc);
    }

    return paramDocs;
  }

  /**
   * Extract parameter constraints from JSDoc @param tags
   * Supports inline tags: {@min}, {@max}, {@pattern}, {@format}, {@default}, {@unique},
   * {@example}, {@multipleOf}, {@deprecated}, {@readOnly}, {@writeOnly}, {@accept}
   */
  private extractParamConstraints(jsdocContent: string): Map<string, any> {
    const constraints = new Map<string, any>();
    const paramRegex = /@param\s+(\w+)\s+(.+)/g;

    let match;
    while ((match = paramRegex.exec(jsdocContent)) !== null) {
      const [, paramName, description] = match;
      const paramConstraints: any = {};

      // Extract {@min value} - works for numbers, strings, arrays
      const minMatch = description.match(/\{@min\s+(-?\d+(?:\.\d+)?)\}/);
      if (minMatch) {
        paramConstraints.min = parseFloat(minMatch[1]);
      }

      // Extract {@max value} - works for numbers, strings, arrays
      const maxMatch = description.match(/\{@max\s+(-?\d+(?:\.\d+)?)\}/);
      if (maxMatch) {
        paramConstraints.max = parseFloat(maxMatch[1]);
      }

      // Extract {@pattern regex} - use lookahead to match until tag-closing }
      const patternMatch = description.match(/\{@pattern\s+(.+?)\}(?=\s|$|{@)/);
      if (patternMatch) {
        paramConstraints.pattern = patternMatch[1].trim();
      }

      // Extract {@format formatName} - use lookahead to match until tag-closing }
      const formatMatch = description.match(/\{@format\s+(.+?)\}(?=\s|$|{@)/);
      if (formatMatch) {
        paramConstraints.format = formatMatch[1].trim();
      }

      // Extract {@choice value1,value2,...} - converts to enum in schema
      const choiceMatch = description.match(/\{@choice\s+([^}]+)\}/);
      if (choiceMatch) {
        const choices = choiceMatch[1].split(',').map((c: string) => c.trim());
        paramConstraints.enum = choices;
      }

      // Extract {@field type} - hints for UI form rendering
      const fieldMatch = description.match(/\{@field\s+([a-z]+)\}/);
      if (fieldMatch) {
        paramConstraints.field = fieldMatch[1].trim();
      }

      // Extract {@default value} - use lookahead to match until tag-closing }
      const defaultMatch = description.match(/\{@default\s+(.+?)\}(?=\s|$|{@)/);
      if (defaultMatch) {
        const defaultValue = defaultMatch[1].trim();
        // Try to parse as JSON for numbers, booleans, objects, arrays
        try {
          paramConstraints.default = JSON.parse(defaultValue);
        } catch {
          // If not valid JSON, use as string
          paramConstraints.default = defaultValue;
        }
      }

      // Extract {@unique} or {@uniqueItems} - for arrays
      if (description.match(/\{@unique(?:Items)?\s*\}/)) {
        paramConstraints.unique = true;
      }

      // Extract {@example value} - supports multiple examples, use lookahead
      const exampleMatches = description.matchAll(/\{@example\s+(.+?)\}(?=\s|$|{@)/g);
      const examples: any[] = [];
      for (const exampleMatch of exampleMatches) {
        const exampleValue = exampleMatch[1].trim();
        // Try to parse as JSON
        try {
          examples.push(JSON.parse(exampleValue));
        } catch {
          // If not valid JSON, use as string
          examples.push(exampleValue);
        }
      }
      if (examples.length > 0) {
        paramConstraints.examples = examples;
      }

      // Extract {@multipleOf value} - for numbers
      const multipleOfMatch = description.match(/\{@multipleOf\s+(-?\d+(?:\.\d+)?)\}/);
      if (multipleOfMatch) {
        paramConstraints.multipleOf = parseFloat(multipleOfMatch[1]);
      }

      // Extract {@deprecated message} - use lookahead to match until tag-closing }
      const deprecatedMatch = description.match(/\{@deprecated(?:\s+(.+?))?\}(?=\s|$|{@)/);
      if (deprecatedMatch) {
        paramConstraints.deprecated = deprecatedMatch[1]?.trim() || true;
      }

      // Extract {@readOnly} and {@writeOnly} - track which comes last
      // They are mutually exclusive, so last one wins
      const readOnlyMatch = description.match(/\{@readOnly\s*\}/);
      const writeOnlyMatch = description.match(/\{@writeOnly\s*\}/);

      if (readOnlyMatch || writeOnlyMatch) {
        // Find positions to determine which comes last
        const readOnlyPos = readOnlyMatch ? description.indexOf(readOnlyMatch[0]) : -1;
        const writeOnlyPos = writeOnlyMatch ? description.indexOf(writeOnlyMatch[0]) : -1;

        if (readOnlyPos > writeOnlyPos) {
          paramConstraints.readOnly = true;
          paramConstraints.writeOnly = false; // Explicitly clear the other
        } else if (writeOnlyPos > readOnlyPos) {
          paramConstraints.writeOnly = true;
          paramConstraints.readOnly = false; // Explicitly clear the other
        }
      }

      // Extract {@label displayName} - custom label for form fields
      const labelMatch = description.match(/\{@label\s+([^}]+)\}/);
      if (labelMatch) {
        paramConstraints.label = labelMatch[1].trim();
      }

      // Extract {@placeholder text} - placeholder text for input fields
      const placeholderMatch = description.match(/\{@placeholder\s+([^}]+)\}/);
      if (placeholderMatch) {
        paramConstraints.placeholder = placeholderMatch[1].trim();
      }

      // Extract {@hint text} - help text shown below/beside the field
      const hintMatch = description.match(/\{@hint\s+([^}]+)\}/);
      if (hintMatch) {
        paramConstraints.hint = hintMatch[1].trim();
      }

      // Extract {@hidden} - hide field from UI forms (for programmatic use only)
      if (description.match(/\{@hidden\s*\}/)) {
        paramConstraints.hidden = true;
      }

      // Extract {@accept pattern} - file type filter for file picker (e.g., "*.ts,*.js" or ".ts,.js")
      const acceptMatch = description.match(/\{@accept\s+([^}]+)\}/);
      if (acceptMatch) {
        paramConstraints.accept = acceptMatch[1].trim();
      }

      if (Object.keys(paramConstraints).length > 0) {
        constraints.set(paramName, paramConstraints);
      }
    }

    return constraints;
  }

  /**
   * Apply constraints to a schema property based on type
   * Handles: min/max (contextual), pattern, format, default, unique,
   * examples, multipleOf, deprecated, readOnly, writeOnly
   * Works with both simple types and anyOf schemas
   */
  private applyConstraints(schema: any, constraints: any) {
    // Helper to apply constraints to a single schema based on type
    const applyToSchema = (s: any) => {
      if (s.enum) {
        // Skip enum types for most constraints (but still apply deprecated, examples, etc.)
        if (constraints.examples !== undefined) {
          s.examples = constraints.examples;
        }
        if (constraints.deprecated !== undefined) {
          s.deprecated = constraints.deprecated === true ? true : constraints.deprecated;
        }
        return;
      }

      // Apply min/max based on type
      if (s.type === 'number') {
        if (constraints.min !== undefined) {
          s.minimum = constraints.min;
        }
        if (constraints.max !== undefined) {
          s.maximum = constraints.max;
        }
        if (constraints.multipleOf !== undefined) {
          s.multipleOf = constraints.multipleOf;
        }
      } else if (s.type === 'string') {
        if (constraints.min !== undefined) {
          s.minLength = constraints.min;
        }
        if (constraints.max !== undefined) {
          s.maxLength = constraints.max;
        }
        if (constraints.pattern !== undefined) {
          s.pattern = constraints.pattern;
        }
        if (constraints.format !== undefined) {
          s.format = constraints.format;
        }
      } else if (s.type === 'array') {
        if (constraints.min !== undefined) {
          s.minItems = constraints.min;
        }
        if (constraints.max !== undefined) {
          s.maxItems = constraints.max;
        }
        if (constraints.unique === true) {
          s.uniqueItems = true;
        }
      }

      // Apply type-agnostic constraints
      if (constraints.default !== undefined) {
        s.default = constraints.default;
      }
      if (constraints.examples !== undefined) {
        s.examples = constraints.examples;
      }
      if (constraints.deprecated !== undefined) {
        s.deprecated = constraints.deprecated === true ? true : constraints.deprecated;
      }
      // Apply enum from @choice tag (overrides TypeScript-derived enum if present)
      if (constraints.enum !== undefined && !s.enum) {
        s.enum = constraints.enum;
      }
      // Apply field hint for UI rendering
      if (constraints.field !== undefined) {
        s.field = constraints.field;
      }
      // Apply custom label for form fields
      if (constraints.label !== undefined) {
        s.title = constraints.label;  // JSON Schema uses 'title' for display label
      }
      // Apply placeholder for input fields
      if (constraints.placeholder !== undefined) {
        s.placeholder = constraints.placeholder;
      }
      // Apply hint text for form fields
      if (constraints.hint !== undefined) {
        s.hint = constraints.hint;
      }

      // readOnly and writeOnly are mutually exclusive
      // JSDoc takes precedence over TypeScript
      if (constraints.readOnly === true) {
        s.readOnly = true;
        delete s.writeOnly; // Clear writeOnly if readOnly is set
      }
      if (constraints.writeOnly === true) {
        s.writeOnly = true;
        delete s.readOnly; // Clear readOnly if writeOnly is set
      }

      // Apply hidden flag for UI forms
      if (constraints.hidden === true) {
        s.hidden = true;
      }
      // Apply accept pattern for file picker filtering
      if (constraints.accept !== undefined) {
        s.accept = constraints.accept;
      }
    };

    // Apply to anyOf schemas or direct schema
    if (schema.anyOf) {
      schema.anyOf.forEach(applyToSchema);

      // For deprecated/examples that apply to the whole property (not individual types)
      // Apply them at the top level too
      if (constraints.deprecated !== undefined) {
        schema.deprecated = constraints.deprecated === true ? true : constraints.deprecated;
      }
      if (constraints.examples !== undefined) {
        schema.examples = constraints.examples;
      }
    } else {
      applyToSchema(schema);
    }
  }

  /**
   * Check if JSDoc contains @Template tag
   */
  private hasTemplateTag(jsdocContent: string): boolean {
    return /@Template/i.test(jsdocContent);
  }

  /**
   * Check if JSDoc contains @Static tag
   */
  private hasStaticTag(jsdocContent: string): boolean {
    return /@Static/i.test(jsdocContent);
  }

  /**
   * Check if JSDoc contains @stateful tag
   * Indicates this method is a stateful workflow that supports checkpoint/resume
   */
  private hasStatefulTag(jsdocContent: string): boolean {
    return /@stateful/i.test(jsdocContent);
  }

  /**
   * Check if JSDoc contains @autorun tag
   * Indicates this method should auto-execute when selected (idempotent, no required params)
   */
  private hasAutorunTag(jsdocContent: string): boolean {
    return /@autorun/i.test(jsdocContent);
  }

  /**
   * Check if JSDoc contains @async tag
   * Indicates this method runs in background — returns execution ID immediately
   */
  private hasAsyncTag(jsdocContent: string): boolean {
    return /@async\b/i.test(jsdocContent);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // DAEMON FEATURE EXTRACTION
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Extract webhook configuration from @webhook tag or handle* prefix
   * - @webhook → use method name as path
   * - @webhook stripe → custom path "stripe"
   * - handle* prefix → auto-detected as webhook
   */
  private extractWebhook(jsdocContent: string, methodName: string): boolean | string | undefined {
    // Check for @webhook tag with optional path
    // Path must start with a word character (to exclude JSDoc asterisks and closing)
    const webhookMatch = jsdocContent.match(/@webhook(?:\s+(\w[\w\-\/]*))?/i);
    if (webhookMatch) {
      const path = webhookMatch[1]?.trim();
      // Return custom path if specified, otherwise true for bare @webhook
      return path || true;
    }

    // Check for handle* prefix (convention)
    if (methodName.startsWith('handle')) {
      return true;
    }

    return undefined;
  }

  /**
   * Extract scheduled cron expression from @scheduled, @cron tag, or scheduled* prefix
   * - @scheduled 0 0 * * * → cron expression
   * - @cron 0 0 * * * → cron expression
   * - scheduled* prefix requires @cron tag for the expression
   */
  private extractScheduled(jsdocContent: string, methodName: string): string | undefined {
    // Check for @scheduled with cron expression
    const scheduledMatch = jsdocContent.match(/@scheduled\s+([*\d,\-\/]+(?:\s+[*\d,\-\/]+){4})/i);
    if (scheduledMatch) {
      return scheduledMatch[1].trim();
    }

    // Check for @cron tag
    const cronMatch = jsdocContent.match(/@cron\s+([*\d,\-\/]+(?:\s+[*\d,\-\/]+){4})/i);
    if (cronMatch) {
      return cronMatch[1].trim();
    }

    // scheduled* prefix without explicit cron - method exists but needs @cron
    if (methodName.startsWith('scheduled') && !cronMatch && !scheduledMatch) {
      // Could log warning: scheduled* method missing @cron tag
      return undefined;
    }

    return undefined;
  }

  /**
   * Extract lock configuration from @locked tag
   * - @locked → use method name as lock
   * - @locked board:write → custom lock name
   */
  private extractLocked(jsdocContent: string, methodName: string): boolean | string | undefined {
    // Lock name must start with a word character (to exclude JSDoc asterisks and closing)
    const lockedMatch = jsdocContent.match(/@locked(?:\s+(\w[\w\-:]*))?/i);
    if (lockedMatch) {
      const lockName = lockedMatch[1]?.trim();
      // Return custom lock name if specified, otherwise true for bare @locked
      return lockName || true;
    }

    return undefined;
  }

  /**
   * Extract URI pattern from @Static tag
   * Example: @Static github://repos/{owner}/{repo}/readme
   */
  private extractStaticURI(jsdocContent: string): string | null {
    const match = jsdocContent.match(/@Static\s+([\w:\/\{\}\-_.]+)/i);
    return match ? match[1].trim() : null;
  }

  /**
   * Extract format hint from @format tag
   * Supports nested syntax: @format list {@title name, @subtitle email}
   * Example: @format table
   * Example: @format json
   * Example: @format code:typescript
   * Example: @format list {@title name, @subtitle email, @style inset}
   */
  private extractFormat(jsdocContent: string): OutputFormat | undefined {
    // Match format with optional nested hints: @format list {...}
    // The nested hints are extracted separately by extractLayoutHints
    const formatMatch = jsdocContent.match(/@format\s+(\w+)(?::(\w+))?/i);
    if (!formatMatch) return undefined;

    const format = formatMatch[1].toLowerCase();
    const subtype = formatMatch[2];

    // Match structural formats
    if (['primitive', 'table', 'tree', 'list', 'none', 'card', 'grid', 'chips', 'kv'].includes(format)) {
      return format as OutputFormat;
    }

    // Match content formats
    if (['json', 'markdown', 'yaml', 'xml', 'html', 'mermaid'].includes(format)) {
      return format as OutputFormat;
    }

    // Match code format (with optional language)
    if (format === 'code') {
      return subtype ? `code:${subtype}` as OutputFormat : 'code';
    }

    return undefined;
  }

  /**
   * Extract layout hints from nested @format syntax
   * Example: @format list {@title name, @subtitle email, @icon avatar, @style inset}
   * Returns: { title: 'name', subtitle: 'email', icon: 'avatar', style: 'inset' }
   */
  private extractLayoutHints(jsdocContent: string): Record<string, string> | undefined {
    // Match @format TYPE {hints}
    const match = jsdocContent.match(/@format\s+\w+(?::\w+)?\s*\{([^}]+)\}/i);
    if (!match) return undefined;

    const hintsString = match[1];
    const hints: Record<string, string> = {};

    // Parse comma-separated hints: @title name, @subtitle email:link
    const parts = hintsString.split(',').map(s => s.trim());

    for (const part of parts) {
      // Match @key value or @key value:renderer
      const hintMatch = part.match(/@(\w+)\s+([^\s,]+(?:\s+[^\s@,][^\s,]*)*)/);
      if (hintMatch) {
        const [, key, value] = hintMatch;
        hints[key.toLowerCase()] = value.trim();
      }
    }

    return Object.keys(hints).length > 0 ? hints : undefined;
  }

  /**
   * Extract button label from @returns {@label} tag
   * Example: @returns {@label Calculate Sum} The result
   * Example: @returns {@label Run Query}
   */
  private extractButtonLabel(jsdocContent: string): string | undefined {
    // Look for {@label ...} in @returns tag
    const returnsMatch = jsdocContent.match(/@returns?\s+.*?\{@label\s+([^}]+)\}/i);
    if (returnsMatch) {
      return returnsMatch[1].trim();
    }
    return undefined;
  }

  /**
   * Extract icon from @icon tag (standalone, not inside layout hints)
   * Example: @icon calculator
   * Example: @icon 🧮
   * Example: @icon mdi:calculator
   * Note: Does NOT match @icon inside layout hints like {@icon fieldname}
   */
  private extractIcon(jsdocContent: string): string | undefined {
    // First, remove layout hints blocks to avoid matching @icon inside them
    const withoutLayoutHints = jsdocContent.replace(/\{[^}]+\}/g, '');
    const iconMatch = withoutLayoutHints.match(/@icon\s+([^\s@*,]+)/i);
    if (iconMatch) {
      return iconMatch[1].trim();
    }
    return undefined;
  }

  /**
   * Extract MIME type from @mimeType tag
   * Example: @mimeType text/markdown
   */
  private extractMimeType(jsdocContent: string): string | undefined {
    const match = jsdocContent.match(/@mimeType\s+([\w\/\-+.]+)/i);
    return match ? match[1].trim() : undefined;
  }

  /**
   * Extract yield information from JSDoc for generator methods
   * Supports @yields tags with id, type, and description
   * Example: @yields {pairing_code} text Enter the 6-digit code shown on TV
   */
  private extractYieldsFromJSDoc(jsdocContent: string): YieldInfo[] {
    const yields: YieldInfo[] = [];
    // Match @yields {id} type description
    const yieldRegex = /@yields?\s+\{(\w+)\}\s+(prompt|confirm|select)\s+(.+)/gi;

    let match;
    while ((match = yieldRegex.exec(jsdocContent)) !== null) {
      const [, id, type, description] = match;
      yields.push({
        id,
        type: type.toLowerCase() as 'prompt' | 'confirm' | 'select',
        prompt: description.trim(),
      });
    }

    return yields;
  }

  /**
   * Extract MCP dependencies from source code
   * Parses @mcp tags in file-level or class-level JSDoc comments
   *
   * Format: @mcp <name> <source>
   *
   * Source formats:
   * - GitHub shorthand: anthropics/mcp-server-github
   * - npm package: npm:@modelcontextprotocol/server-filesystem
   * - Local path: ./my-local-mcp or /absolute/path
   * - Full URL: https://github.com/user/repo
   *
   * Example:
   * ```
   * /**
   *  * @mcp github anthropics/mcp-server-github
   *  * @mcp fs npm:@modelcontextprotocol/server-filesystem
   *  *\/
   * ```
   */
  extractMCPDependencies(source: string): MCPDependency[] {
    const dependencies: MCPDependency[] = [];

    // Match @mcp <name> <source> pattern
    // Supports multiline JSDoc comments
    const mcpRegex = /@mcp\s+(\w+)\s+([^\s*]+(?:\s+[^\s*@][^\s*]*)*)/g;

    let match;
    while ((match = mcpRegex.exec(source)) !== null) {
      const [, name, rawSource] = match;
      const source = rawSource.trim();

      // Determine source type
      const sourceType = this.classifyMCPSource(source);

      dependencies.push({
        name,
        source,
        sourceType,
      });
    }

    return dependencies;
  }

  /**
   * Classify MCP source type based on format
   */
  private classifyMCPSource(source: string): 'github' | 'npm' | 'url' | 'local' {
    // npm package: npm:@scope/package or npm:package
    if (source.startsWith('npm:')) {
      return 'npm';
    }

    // Full URL
    if (source.startsWith('http://') || source.startsWith('https://')) {
      return 'url';
    }

    // Local path (relative or absolute)
    if (source.startsWith('./') || source.startsWith('../') ||
        source.startsWith('/') || source.startsWith('~') ||
        /^[A-Za-z]:[\\/]/.test(source)) {
      return 'local';
    }

    // Default: GitHub shorthand (owner/repo)
    return 'github';
  }

  /**
   * Extract Photon dependencies from source code
   * Parses @photon tags in file-level or class-level JSDoc comments
   *
   * Format: @photon <name> <source>
   *
   * Source formats:
   * - Marketplace: rss-feed (simple name from marketplace)
   * - GitHub: portel-dev/photons/rss-feed
   * - npm package: npm:@portel/rss-feed-photon
   * - Local path: ./my-photon.photon.ts
   *
   * Example:
   * ```
   * /**
   *  * @photon rssFeed rss-feed
   *  * @photon custom ./my-photon.photon.ts
   *  *\/
   * ```
   */
  extractPhotonDependencies(source: string): PhotonDependency[] {
    const dependencies: PhotonDependency[] = [];

    // Match @photon <name> <source> pattern
    // Source ends at: newline, end of comment (*), or @ (next tag)
    const photonRegex = /@photon\s+(\w+)\s+([^\s*@\n]+)/g;

    let match;
    while ((match = photonRegex.exec(source)) !== null) {
      const [, name, rawSource] = match;
      const photonSource = rawSource.trim();

      // Determine source type
      const sourceType = this.classifyPhotonSource(photonSource);

      dependencies.push({
        name,
        source: photonSource,
        sourceType,
      });
    }

    return dependencies;
  }

  /**
   * Classify Photon source type based on format
   */
  private classifyPhotonSource(source: string): 'marketplace' | 'github' | 'npm' | 'local' {
    // npm package: npm:@scope/package or npm:package
    if (source.startsWith('npm:')) {
      return 'npm';
    }

    // Local path (relative or absolute, or ends with .photon.ts)
    if (source.startsWith('./') || source.startsWith('../') ||
        source.startsWith('/') || source.startsWith('~') ||
        /^[A-Za-z]:[\\/]/.test(source) ||
        source.endsWith('.photon.ts')) {
      return 'local';
    }

    // GitHub: has at least 2 slashes (owner/repo/photon) or 1 slash (owner/repo)
    if ((source.match(/\//g) || []).length >= 1) {
      return 'github';
    }

    // Default: Marketplace (simple name like "rss-feed")
    return 'marketplace';
  }

  /**
   * Extract CLI dependencies from source code
   * Parses @cli tags in file-level or class-level JSDoc comments
   *
   * Format: @cli <name> - <install_url>
   *
   * Example:
   * ```
   * /**
   *  * @cli git - https://git-scm.com/downloads
   *  * @cli ffmpeg - https://ffmpeg.org/download.html
   *  *\/
   * ```
   */
  extractCLIDependencies(source: string): CLIDependency[] {
    const dependencies: CLIDependency[] = [];

    // Match @cli <name> or @cli <name> - <url> pattern
    // The URL is optional
    const cliRegex = /@cli\s+(\w[\w-]*)\s*(?:-\s*([^\s*@\n]+))?/g;

    let match;
    while ((match = cliRegex.exec(source)) !== null) {
      const [, name, installUrl] = match;

      dependencies.push({
        name: name.trim(),
        installUrl: installUrl?.trim(),
      });
    }

    return dependencies;
  }

  /**
   * Resolve all injections for a Photon class
   * Determines how each constructor parameter should be injected:
   * - Primitives (string, number, boolean) → env var
   * - Non-primitives matching @mcp → MCP client
   * - Non-primitives matching @photon → Photon instance
   *
   * @param source The Photon source code
   * @param mcpName The MCP name (for env var prefixing)
   */
  resolveInjections(source: string, mcpName: string): ResolvedInjection[] {
    const params = this.extractConstructorParams(source);
    const mcpDeps = this.extractMCPDependencies(source);
    const photonDeps = this.extractPhotonDependencies(source);

    // Build lookup maps
    const mcpMap = new Map(mcpDeps.map(d => [d.name, d]));
    const photonMap = new Map(photonDeps.map(d => [d.name, d]));

    return params.map(param => {
      // Primitives → env var
      if (param.isPrimitive) {
        const envVarName = this.toEnvVarName(mcpName, param.name);
        return {
          param,
          injectionType: 'env' as const,
          envVarName,
        };
      }

      // Check if matches an @mcp declaration
      if (mcpMap.has(param.name)) {
        return {
          param,
          injectionType: 'mcp' as const,
          mcpDependency: mcpMap.get(param.name),
        };
      }

      // Check if matches an @photon declaration
      if (photonMap.has(param.name)) {
        return {
          param,
          injectionType: 'photon' as const,
          photonDependency: photonMap.get(param.name),
        };
      }

      // Non-primitive without declaration - treat as env var (will likely fail at runtime)
      const envVarName = this.toEnvVarName(mcpName, param.name);
      return {
        param,
        injectionType: 'env' as const,
        envVarName,
      };
    });
  }

  /**
   * Convert MCP name and parameter name to environment variable name
   * Example: (filesystem, workdir) → FILESYSTEM_WORKDIR
   */
  private toEnvVarName(mcpName: string, paramName: string): string {
    const mcpPrefix = mcpName.toUpperCase().replace(/-/g, '_');
    const paramSuffix = paramName
      .replace(/([A-Z])/g, '_$1')
      .toUpperCase()
      .replace(/^_/, '');
    return `${mcpPrefix}_${paramSuffix}`;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ASSET EXTRACTION - @ui, @prompt, @resource annotations
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Extract all assets from Photon source code
   * Parses @ui, @prompt, @resource annotations from class-level JSDoc
   *
   * Format:
   * - @ui <id> <path> - UI templates for MCP Apps
   * - @prompt <id> <path> - Static MCP prompts
   * - @resource <id> <path> - Static MCP resources
   *
   * Example:
   * ```
   * /**
   *  * @ui preferences ./ui/preferences.html
   *  * @prompt system ./prompts/system.md
   *  * @resource config ./resources/config.json
   *  *\/
   * export default class MyPhoton extends PhotonMCP { ... }
   * ```
   */
  extractAssets(source: string, assetFolder?: string): PhotonAssets {
    const ui = this.extractUIAssets(source);
    const prompts = this.extractPromptAssets(source);
    const resources = this.extractResourceAssets(source);

    // Also extract method-level @ui annotations (links UI to specific tool)
    this.extractMethodUILinks(source, ui);

    return {
      ui,
      prompts,
      resources,
      assetFolder,
    };
  }

  /**
   * Extract UI assets from @ui annotations
   * Format: @ui <id> <path>
   * Path must start with ./ or / to distinguish from method-level @ui references
   */
  private extractUIAssets(source: string): UIAsset[] {
    const assets: UIAsset[] = [];
    // Path must start with ./ or / to be a declaration (not a reference)
    const uiRegex = /@ui\s+(\w[\w-]*)\s+(\.\/[^\s*]+|\/[^\s*]+)/g;

    let match;
    while ((match = uiRegex.exec(source)) !== null) {
      const [, id, path] = match;
      assets.push({
        id,
        path,
        mimeType: this.getMimeTypeFromPath(path),
      });
    }

    return assets;
  }

  /**
   * Extract prompt assets from @prompt annotations
   * Format: @prompt <id> <path>
   * Path must start with ./ or / to be a valid declaration
   */
  private extractPromptAssets(source: string): PromptAsset[] {
    const assets: PromptAsset[] = [];
    const promptRegex = /@prompt\s+(\w[\w-]*)\s+(\.\/[^\s*]+|\/[^\s*]+)/g;

    let match;
    while ((match = promptRegex.exec(source)) !== null) {
      const [, id, path] = match;
      assets.push({
        id,
        path,
      });
    }

    return assets;
  }

  /**
   * Extract resource assets from @resource annotations
   * Format: @resource <id> <path>
   * Path must start with ./ or / to be a valid declaration
   */
  private extractResourceAssets(source: string): ResourceAsset[] {
    const assets: ResourceAsset[] = [];
    const resourceRegex = /@resource\s+(\w[\w-]*)\s+(\.\/[^\s*]+|\/[^\s*]+)/g;

    let match;
    while ((match = resourceRegex.exec(source)) !== null) {
      const [, id, path] = match;
      assets.push({
        id,
        path,
        mimeType: this.getMimeTypeFromPath(path),
      });
    }

    return assets;
  }

  /**
   * Extract method-level @ui annotations that link UI to tools
   * Format: @ui <id> on a method's JSDoc
   */
  private extractMethodUILinks(source: string, uiAssets: UIAsset[]): void {
    try {
      const sourceFile = ts.createSourceFile(
        'temp.ts',
        source,
        ts.ScriptTarget.Latest,
        true
      );

      const visit = (node: ts.Node) => {
        if (ts.isClassDeclaration(node)) {
          node.members.forEach((member) => {
            if (ts.isMethodDeclaration(member) &&
                member.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)) {
              const jsdoc = this.getJSDocComment(member, sourceFile);
              const methodName = member.name.getText(sourceFile);

              // Check for @ui <id> in method JSDoc
              const uiMatch = jsdoc.match(/@ui\s+(\S+)/);
              if (uiMatch) {
                const uiId = uiMatch[1];
                // Link UI asset to this method
                const asset = uiAssets.find(a => a.id === uiId);
                if (asset) {
                  asset.linkedTool = methodName;
                }
              }
            }
          });
        }
        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    } catch (error: any) {
      // Silently fail - UI links are optional
    }
  }

  /**
   * Get MIME type from file extension
   */
  private getMimeTypeFromPath(path: string): string {
    const ext = path.toLowerCase().split('.').pop() || '';
    const mimeTypes: Record<string, string> = {
      // Web
      'html': 'text/html',
      'htm': 'text/html',
      'css': 'text/css',
      'js': 'application/javascript',
      'mjs': 'application/javascript',
      'jsx': 'text/jsx',
      'ts': 'text/typescript',
      'tsx': 'text/tsx',
      // Data
      'json': 'application/json',
      'yaml': 'application/yaml',
      'yml': 'application/yaml',
      'xml': 'application/xml',
      'csv': 'text/csv',
      // Documents
      'md': 'text/markdown',
      'txt': 'text/plain',
      'pdf': 'application/pdf',
      // Images
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'svg': 'image/svg+xml',
      'webp': 'image/webp',
      'ico': 'image/x-icon',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }
}
