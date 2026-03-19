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
import { ExtractedSchema, ConstructorParam, TemplateInfo, StaticInfo, OutputFormat, YieldInfo, MCPDependency, PhotonDependency, CLIDependency, ResolvedInjection, PhotonAssets, UIAsset, PromptAsset, ResourceAsset, ConfigSchema, ConfigParam, SettingsSchema, SettingsProperty, NotificationSubscription } from './types.js';
import { parseDuration, parseRate } from './utils/duration.js';
import { builtinRegistry, type MiddlewareDeclaration } from './middleware.js';

export interface ExtractedMetadata {
  tools: ExtractedSchema[];
  templates: TemplateInfo[];
  statics: StaticInfo[];
  /** Settings schema from `protected settings = { ... }` property */
  settingsSchema?: SettingsSchema;
  /** @deprecated Configuration schema from configure() method */
  configSchema?: ConfigSchema;
  /** Notification subscription from @notify-on tag */
  notificationSubscriptions?: NotificationSubscription;
  /**
   * MCP OAuth auth requirement (from @auth tag)
   * - 'required': all methods require authenticated caller
   * - 'optional': caller populated if token present, anonymous allowed
   * - string URL: OIDC provider URL (implies required)
   */
  auth?: 'required' | 'optional' | string;
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

    // Settings schema tracking (new property-based approach)
    let settingsSchema: SettingsSchema | undefined;

    // Configuration schema tracking (deprecated method-based approach)
    let configSchema: ConfigSchema = {
      hasConfigureMethod: false,
      hasGetConfigMethod: false,
      params: [],
    };

    // Notification subscriptions tracking (from @notify-on tag)
    let notificationSubscriptions: NotificationSubscription | undefined;

    // MCP OAuth auth requirement (from @auth tag)
    let auth: 'required' | 'optional' | string | undefined;

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
      const processMethod = (member: ts.MethodDeclaration, isStatefulClass: boolean = false) => {
        const methodName = member.name.getText(sourceFile);

        // Skip private methods (prefixed with _)
        if (methodName.startsWith('_')) {
          return;
        }

        // Track configure/getConfig for backward compat metadata (deprecated)
        // These are no longer hidden — they become normal visible tools
        if (methodName === 'configure') {
          configSchema.hasConfigureMethod = true;
          const jsdocConfig = this.getJSDocComment(member, sourceFile);
          configSchema.description = this.extractDescription(jsdocConfig);

          const paramsType = this.getFirstParameterType(member, sourceFile);
          if (paramsType) {
            const { properties: configProps, required: configRequired } = this.buildSchemaFromType(paramsType, sourceFile);
            const paramDocs = this.extractParamDocs(jsdocConfig);

            configSchema.params = Object.keys(configProps).map(name => ({
              name,
              type: configProps[name].type || 'string',
              description: paramDocs.get(name) || configProps[name].description,
              required: configRequired.includes(name),
              defaultValue: configProps[name].default,
            }));
          }
          // Fall through — configure() is now a normal tool (not hidden)
        }

        if (methodName === 'getConfig') {
          configSchema.hasGetConfigMethod = true;
          // Fall through — getConfig() is now a normal tool (not hidden)
        }

        const jsdoc = this.getJSDocComment(member, sourceFile);

        // Skip @internal methods — hidden from LLM and sidebar
        // Exception: daemon-feature methods (@scheduled, @webhook) must still
        // be registered in tools so the runtime can wire up cron jobs/webhooks.
        const isInternal = /@internal\b/.test(jsdoc);
        const hasDaemonFeature = /@scheduled\b/.test(jsdoc) || /@webhook\b/.test(jsdoc) || /@cron\b/.test(jsdoc) || /^scheduled/.test(methodName);
        if (isInternal && !hasDaemonFeature) {
          return;
        }

        // Check if this is an async generator method (has asterisk token)
        const isGenerator = member.asteriskToken !== undefined;

        // Extract parameter schema from method signature
        // Supports both patterns:
        //   add(item: string)              → { item: { type: "string" } }
        //   add(params: { item: string })  → { item: { type: "string" } }
        const { properties, required, simpleParams } = this.extractMethodParams(member, sourceFile);

        // Extract descriptions from JSDoc
        const paramDocs = this.extractParamDocs(jsdoc);
        const paramConstraints = this.extractParamConstraints(jsdoc);

        // Track which paramDocs/constraints were matched for fail-safe handling
        const matchedDocs = new Set<string>();
        const matchedConstraints = new Set<string>();

        // Merge descriptions and constraints into properties
        Object.keys(properties).forEach(key => {
          if (paramDocs.has(key)) {
            properties[key].description = paramDocs.get(key);
            matchedDocs.add(key);
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
            matchedConstraints.add(key);
          }
        });

        // Fail-safe: Handle mismatched parameter names from JSDoc
        // If a @param name doesn't match any actual parameter, try fuzzy matching
        const unmatchedDocs = Array.from(paramDocs.entries()).filter(([name]) => !matchedDocs.has(name));
        if (unmatchedDocs.length > 0) {
          const propKeys = Object.keys(properties);

          // If there's only one parameter and one unmatched doc, assume it belongs to that parameter
          if (propKeys.length === 1 && unmatchedDocs.length === 1) {
            const paramKey = propKeys[0];
            const [docName, docValue] = unmatchedDocs[0];
            if (!properties[paramKey].description) {
              properties[paramKey].description = `${docName}: ${docValue}`;
              console.warn(
                `Parameter name mismatch in JSDoc: @param ${docName} doesn't match ` +
                `function parameter "${paramKey}". Using description from @param ${docName}.`
              );
            }
          } else if (unmatchedDocs.length > 0) {
            // Log warning for other mismatches (multiple parameters or multiple unmatched docs)
            unmatchedDocs.forEach(([docName]) => {
              console.warn(
                `Parameter name mismatch in JSDoc: @param ${docName} doesn't match any function parameter. ` +
                `Available parameters: ${propKeys.join(', ')}. Consider updating @param tag.`
              );
            });
          }
        }

        // Similar fail-safe for constraints
        const unmatchedConstraints = Array.from(paramConstraints.entries()).filter(([name]) => !matchedConstraints.has(name));
        if (unmatchedConstraints.length > 0) {
          const propKeys = Object.keys(properties);

          if (propKeys.length === 1 && unmatchedConstraints.length === 1) {
            const paramKey = propKeys[0];
            const [constraintName, constraintValue] = unmatchedConstraints[0];
            this.applyConstraints(properties[paramKey], constraintValue);
            console.warn(
              `Parameter name mismatch in JSDoc: constraint tag for ${constraintName} doesn't match ` +
              `function parameter "${paramKey}". Applying constraint to "${paramKey}".`
            );
          }
        }

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
          const iconImages = this.extractIconImages(jsdoc);
          const yields = isGenerator ? this.extractYieldsFromJSDoc(jsdoc) : undefined;
          const isStateful = this.hasStatefulTag(jsdoc);
          const autorun = this.hasAutorunTag(jsdoc);
          const isAsync = this.hasAsyncTag(jsdoc);

          // MCP standard annotations
          const title = this.extractTitle(jsdoc);
          const readOnlyHint = this.hasReadOnlyHint(jsdoc);
          const destructiveHint = this.hasDestructiveHint(jsdoc);
          const idempotentHint = this.hasIdempotentHint(jsdoc);
          const openWorldHint = this.extractOpenWorldHint(jsdoc);
          const audience = this.extractAudience(jsdoc);
          const contentPriority = this.extractContentPriority(jsdoc);
          const outputSchema = this.inferOutputSchemaFromReturnType(member, sourceFile);

          // Daemon features
          const webhook = this.extractWebhook(jsdoc, methodName);
          const scheduled = this.extractScheduled(jsdoc, methodName);
          const locked = this.extractLocked(jsdoc, methodName);

          // Functional tags — individual fields kept for backward compat
          const fallback = this.extractFallback(jsdoc);
          const logged = this.extractLogged(jsdoc);
          const circuitBreaker = this.extractCircuitBreaker(jsdoc);
          const cached = this.extractCached(jsdoc);
          const timeout = this.extractTimeout(jsdoc);
          const retryable = this.extractRetryable(jsdoc);
          const throttled = this.extractThrottled(jsdoc);
          const debounced = this.extractDebounced(jsdoc);
          const queued = this.extractQueued(jsdoc);
          const validations = this.extractValidations(jsdoc, Object.keys(properties));
          const deprecated = this.extractDeprecated(jsdoc);

          // Build unified middleware declarations (single source of truth for runtime)
          const middleware = this.buildMiddlewareDeclarations(jsdoc);

          // Check for static keyword on the method
          const isStaticMethod = member.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword) || false;

          // Event emission for @stateful classes: all public methods emit events automatically
          const emitsEventData = isStatefulClass ? {
            emitsEvent: true,
            eventName: methodName,
            eventPayload: {
              method: 'string',
              params: 'object',
              result: 'any',
              timestamp: 'string',
              instance: 'string',
            },
          } : {};

          tools.push({
            name: methodName,
            description,
            inputSchema,
            ...(isInternal ? { internal: true } : {}),
            ...(outputFormat ? { outputFormat } : {}),
            ...(layoutHints ? { layoutHints } : {}),
            ...(buttonLabel ? { buttonLabel } : {}),
            ...(icon ? { icon } : {}),
            ...(iconImages ? { iconImages } : {}),
            ...(isGenerator ? { isGenerator: true } : {}),
            ...(yields && yields.length > 0 ? { yields } : {}),
            ...(isStateful ? { isStateful: true } : {}),
            ...(autorun ? { autorun: true } : {}),
            ...(isAsync ? { isAsync: true } : {}),
            ...(isStaticMethod ? { isStatic: true } : {}),
            ...(simpleParams ? { simpleParams: true } : {}),
            // Daemon features
            ...(webhook !== undefined ? { webhook } : {}),
            ...(scheduled ? { scheduled } : {}),
            ...(locked !== undefined ? { locked } : {}),
            // Functional tags (individual fields for backward compat)
            ...(fallback ? { fallback } : {}),
            ...(logged ? { logged } : {}),
            ...(circuitBreaker ? { circuitBreaker } : {}),
            ...(cached ? { cached } : {}),
            ...(timeout ? { timeout } : {}),
            ...(retryable ? { retryable } : {}),
            ...(throttled ? { throttled } : {}),
            ...(debounced ? { debounced } : {}),
            ...(queued ? { queued } : {}),
            ...(validations && validations.length > 0 ? { validations } : {}),
            ...(deprecated !== undefined ? { deprecated } : {}),
            // Unified middleware declarations (new — runtime uses this)
            ...(middleware.length > 0 ? { middleware } : {}),
            // MCP standard annotations
            ...(title ? { title } : {}),
            ...(readOnlyHint ? { readOnlyHint: true } : {}),
            ...(destructiveHint ? { destructiveHint: true } : {}),
            ...(idempotentHint ? { idempotentHint: true } : {}),
            ...(openWorldHint !== undefined ? { openWorldHint } : {}),
            ...(audience ? { audience } : {}),
            ...(contentPriority !== undefined ? { contentPriority } : {}),
            ...(outputSchema ? { outputSchema } : {}),
            // Event emission (for @stateful classes)
            ...emitsEventData,
          });
        }
      };

      // Helper to extract settings from a `protected settings = { ... }` property
      const processSettingsProperty = (member: ts.PropertyDeclaration, classNode: ts.ClassDeclaration) => {
        const name = member.name.getText(sourceFile);
        if (name !== 'settings') return;

        // Must be protected
        const isProtected = member.modifiers?.some(
          m => m.kind === ts.SyntaxKind.ProtectedKeyword
        );
        if (!isProtected) return;

        // Must have an object literal initializer
        if (!member.initializer || !ts.isObjectLiteralExpression(member.initializer)) return;

        // Get class-level JSDoc for @property descriptions
        const classJsdoc = this.getJSDocComment(classNode as any, sourceFile);
        const propertyDocs = new Map<string, string>();
        const propertyRegex = /@property\s+(\w+)\s+(.*?)(?=\n\s*\*\s*@|\n\s*\*\/|\n\s*\*\s*$)/gs;
        let propMatch: RegExpExecArray | null;
        while ((propMatch = propertyRegex.exec(classJsdoc)) !== null) {
          propertyDocs.set(propMatch[1], propMatch[2].trim());
        }

        const properties: SettingsProperty[] = [];

        for (const prop of member.initializer.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const propName = prop.name.getText(sourceFile);

          // Determine type and default from the initializer
          let type = 'string';
          let defaultValue: any = undefined;
          let required = false;

          const init = prop.initializer;

          if (ts.isNumericLiteral(init)) {
            type = 'number';
            defaultValue = Number(init.text);
          } else if (ts.isStringLiteral(init)) {
            type = 'string';
            defaultValue = init.text;
          } else if (init.kind === ts.SyntaxKind.TrueKeyword) {
            type = 'boolean';
            defaultValue = true;
          } else if (init.kind === ts.SyntaxKind.FalseKeyword) {
            type = 'boolean';
            defaultValue = false;
          } else if (init.kind === ts.SyntaxKind.UndefinedKeyword) {
            // `key: undefined` — required, type inferred from as-expression or defaults to string
            required = true;
          } else if (ts.isAsExpression(init)) {
            // `key: undefined as string | undefined` or `key: 5 as number`
            const innerInit = init.expression;
            const isUndefined = innerInit.kind === ts.SyntaxKind.UndefinedKeyword ||
              (ts.isIdentifier(innerInit) && innerInit.text === 'undefined');
            if (isUndefined) {
              required = true;
            } else if (ts.isNumericLiteral(innerInit)) {
              type = 'number';
              defaultValue = Number(innerInit.text);
            } else if (ts.isStringLiteral(innerInit)) {
              type = 'string';
              defaultValue = innerInit.text;
            } else if (innerInit.kind === ts.SyntaxKind.TrueKeyword || innerInit.kind === ts.SyntaxKind.FalseKeyword) {
              type = 'boolean';
              defaultValue = innerInit.kind === ts.SyntaxKind.TrueKeyword;
            }
            // Try to get type from the as-expression type annotation
            const typeText = init.type.getText(sourceFile).replace(/\s*\|\s*undefined/g, '').trim();
            if (typeText === 'number') type = 'number';
            else if (typeText === 'boolean') type = 'boolean';
            else if (typeText === 'string') type = 'string';
          } else if (ts.isArrayLiteralExpression(init)) {
            type = 'array';
            defaultValue = [];
          }

          properties.push({
            name: propName,
            type,
            description: propertyDocs.get(propName),
            default: defaultValue,
            required,
          });
        }

        settingsSchema = {
          hasSettings: true,
          properties,
          description: propertyDocs.size > 0 ? 'Photon settings' : undefined,
        };
      };

      // Visit all nodes in the AST
      const visit = (node: ts.Node) => {
        // Look for class declarations
        if (ts.isClassDeclaration(node)) {
          // Check if this class has @stateful decorator
          const classJsdoc = this.getJSDocComment(node as any, sourceFile);
          const isStatefulClass = /@stateful\b/i.test(classJsdoc);

          // Extract @auth tag for MCP OAuth requirement
          const authMatch = classJsdoc.match(/@auth(?:\s+(\S+))?/i);
          if (authMatch) {
            auth = authMatch[1]?.trim() || 'required';
          }

          // Extract notification subscriptions from @notify-on tag
          notificationSubscriptions = this.extractNotifyOn(classJsdoc);

          node.members.forEach((member) => {
            // Detect `protected settings = { ... }` property
            if (ts.isPropertyDeclaration(member)) {
              processSettingsProperty(member, node);
            }

            // Process all public methods (sync or async)
            // Skip private/protected — only public methods become tools
            if (ts.isMethodDeclaration(member)) {
              const isPrivate = member.modifiers?.some(
                m => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword
              );
              if (!isPrivate) {
                processMethod(member, isStatefulClass);
              }
            }
          });
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    } catch (error: any) {
      console.error('Failed to parse TypeScript source:', error.message);
    }

    const result: ExtractedMetadata = { tools, templates, statics };

    // Include settingsSchema if detected
    if (settingsSchema) {
      result.settingsSchema = settingsSchema;
    }

    // Include configSchema if there's a configure() method (deprecated)
    if (configSchema.hasConfigureMethod) {
      result.configSchema = configSchema;
    }

    // Include notification subscriptions if detected
    if (notificationSubscriptions) {
      result.notificationSubscriptions = notificationSubscriptions;
    }

    // Include auth requirement if detected
    if (auth) {
      result.auth = auth;
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
   * Extract method parameters into JSON schema properties.
   *
   * Handles two patterns:
   *   1. Object param: add(params: { item: string }) → extracts inner properties
   *   2. Simple params: add(item: string) or add(a: number, b: number) → each param becomes a property
   */
  private extractMethodParams(method: ts.MethodDeclaration, sourceFile: ts.SourceFile): { properties: Record<string, any>, required: string[], simpleParams?: boolean } {
    if (method.parameters.length === 0) {
      return { properties: {}, required: [] };
    }

    const firstParam = method.parameters[0];
    const firstType = firstParam.type;

    // Pattern 1: Single object param — add(params: { item: string })
    // Unwrap the object type's properties directly
    if (firstType && method.parameters.length === 1) {
      // Direct type literal: { item: string }
      if (ts.isTypeLiteralNode(firstType)) {
        return this.buildSchemaFromType(firstType, sourceFile);
      }
      // Union containing object literal: { item: string } | string
      if (ts.isUnionTypeNode(firstType)) {
        for (const memberType of firstType.types) {
          if (ts.isTypeLiteralNode(memberType)) {
            return this.buildSchemaFromType(memberType, sourceFile);
          }
        }
      }
    }

    // Pattern 2: Simple typed params — add(item: string) or add(a: number, b: number)
    // Flag as simpleParams so the runtime destructures the params object into individual args
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const param of method.parameters) {
      const paramName = param.name.getText(sourceFile);
      const isOptional = param.questionToken !== undefined || param.initializer !== undefined;

      if (!isOptional) {
        required.push(paramName);
      }

      if (param.type) {
        properties[paramName] = this.typeNodeToSchema(param.type, sourceFile);
      } else {
        properties[paramName] = { type: 'string' };
      }

      // Extract default value if initializer exists
      if (param.initializer) {
        const defaultValue = this.extractDefaultValue(param.initializer, sourceFile);
        if (defaultValue !== undefined) {
          // Validate default value type matches parameter type
          const paramType = properties[paramName].type;
          if (!this.isDefaultValueTypeCompatible(defaultValue, paramType)) {
            const defaultType = typeof defaultValue;
            console.warn(
              `Default value type mismatch: parameter "${paramName}" is type "${paramType}" ` +
              `but default value is type "${defaultType}" (${JSON.stringify(defaultValue)}). ` +
              `This may cause runtime errors.`
            );
          }
          properties[paramName].default = defaultValue;
        }
      }
    }

    return { properties, required, simpleParams: true };
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

          // Extract JSDoc description from property (e.g., /** Task ID */ id: string)
          const jsDocComment = this.getPropertyJsDoc(member, sourceFile);
          if (jsDocComment) {
            properties[propName].description = jsDocComment;
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
   * Extract JSDoc description from a property signature.
   * Handles both /** comment * / style and // comment style.
   */
  private getPropertyJsDoc(member: ts.PropertySignature, sourceFile: ts.SourceFile): string | undefined {
    // Check for JSDoc comments attached to the node
    const jsDocNodes = (member as any).jsDoc;
    if (jsDocNodes && jsDocNodes.length > 0) {
      const comment = jsDocNodes[0].comment;
      if (typeof comment === 'string') return comment.trim();
    }

    // Fallback: look for leading comment in source text
    const fullText = sourceFile.getFullText();
    const start = member.getFullStart();
    const leading = fullText.substring(start, member.getStart(sourceFile)).trim();

    // Match /** ... */ or /* ... */
    const blockMatch = leading.match(/\/\*\*?\s*([\s\S]*?)\s*\*\//);
    if (blockMatch) {
      return blockMatch[1].replace(/\s*\*\s*/g, ' ').trim();
    }

    return undefined;
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

      // Also resolve interface declarations → synthesize a TypeLiteral
      if (ts.isInterfaceDeclaration(node) && node.name.text === typeName) {
        // Create a synthetic TypeLiteralNode from interface members
        resolved = ts.factory.createTypeLiteralNode(
          node.members.filter(ts.isPropertySignature) as ts.PropertySignature[]
        );
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
  /**
   * Check if a default value's type is compatible with the parameter type
   */
  private isDefaultValueTypeCompatible(defaultValue: any, paramType: string): boolean {
    const valueType = typeof defaultValue;

    // Type must match (number → number, boolean → boolean, etc.)
    switch (paramType) {
      case 'string':
        return valueType === 'string';
      case 'number':
        // Number params need number defaults, not strings
        return valueType === 'number';
      case 'boolean':
        return valueType === 'boolean';
      case 'array':
        return Array.isArray(defaultValue);
      case 'object':
        return valueType === 'object';
      default:
        return true;  // Unknown types are assumed compatible
    }
  }

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

    // Detect complex expressions
    const expressionText = initializer.getText(sourceFile);
    const isComplexExpression =
      ts.isCallExpression(initializer) ||  // Function calls: Math.max(10, 100)
      ts.isObjectLiteralExpression(initializer) ||  // Objects: { key: 'value' }
      ts.isArrayLiteralExpression(initializer) ||  // Arrays: [1, 2, 3]
      ts.isBinaryExpression(initializer) ||  // Binary ops: 10 + 20
      ts.isConditionalExpression(initializer);  // Ternary: x ? a : b

    if (isComplexExpression) {
      console.warn(
        `complex default value cannot be reliably serialized: "${expressionText}". ` +
        `Default will not be applied to schema. Consider using a simple literal value instead.`
      );
      return undefined;
    }

    // For other expressions, return as string
    return expressionText;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // INLINE CONFIG + @use PARSING
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Parse inline {@prop value} config from a string
   * @example parseInlineConfig('{@ttl 5m} {@key params.userId}')
   *   → { ttl: '5m', key: 'params.userId' }
   */
  parseInlineConfig(text: string): Record<string, string> {
    const config: Record<string, string> = {};
    const regex = /\{@(\w+)\s+([^}]+)\}/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      config[match[1]] = match[2].trim();
    }
    return config;
  }

  /**
   * Extract @use declarations from JSDoc
   * @example extractUseDeclarations('* @use audit {@level info} {@tags api}')
   *   → [{ name: 'audit', rawConfig: { level: 'info', tags: 'api' } }]
   */
  extractUseDeclarations(jsdocContent: string): Array<{ name: string; rawConfig: Record<string, string> }> {
    const declarations: Array<{ name: string; rawConfig: Record<string, string> }> = [];
    const regex = /@use\s+([\w][\w-]*)((?:\s+\{@\w+\s+[^}]+\})*)/g;
    let match;
    while ((match = regex.exec(jsdocContent)) !== null) {
      const name = match[1];
      const configStr = match[2] || '';
      const rawConfig = this.parseInlineConfig(configStr);
      declarations.push({ name, rawConfig });
    }
    return declarations;
  }

  /**
   * Build middleware declarations from all tags on a method's JSDoc.
   * Converts both sugar tags (@cached 5m) and @use tags into a unified
   * MiddlewareDeclaration[] array.
   */
  buildMiddlewareDeclarations(jsdocContent: string): MiddlewareDeclaration[] {
    const declarations: MiddlewareDeclaration[] = [];

    // 1. Extract sugar tags → convert to declarations

    // @fallback
    const fallback = this.extractFallback(jsdocContent);
    if (fallback) {
      const def = builtinRegistry.get('fallback');
      declarations.push({ name: 'fallback', config: fallback, phase: def?.phase ?? 3 });
    }

    // @logged
    const logged = this.extractLogged(jsdocContent);
    if (logged) {
      const def = builtinRegistry.get('logged');
      declarations.push({ name: 'logged', config: logged, phase: def?.phase ?? 5 });
    }

    // @circuitBreaker
    const circuitBreaker = this.extractCircuitBreaker(jsdocContent);
    if (circuitBreaker) {
      const def = builtinRegistry.get('circuitBreaker');
      declarations.push({ name: 'circuitBreaker', config: circuitBreaker, phase: def?.phase ?? 8 });
    }

    // @cached
    const cached = this.extractCached(jsdocContent);
    if (cached) {
      const def = builtinRegistry.get('cached');
      declarations.push({ name: 'cached', config: cached, phase: def?.phase ?? 30 });
    }

    // @timeout
    const timeout = this.extractTimeout(jsdocContent);
    if (timeout) {
      const def = builtinRegistry.get('timeout');
      declarations.push({ name: 'timeout', config: timeout, phase: def?.phase ?? 70 });
    }

    // @retryable
    const retryable = this.extractRetryable(jsdocContent);
    if (retryable) {
      const def = builtinRegistry.get('retryable');
      declarations.push({ name: 'retryable', config: retryable, phase: def?.phase ?? 80 });
    }

    // @throttled
    const throttled = this.extractThrottled(jsdocContent);
    if (throttled) {
      const def = builtinRegistry.get('throttled');
      declarations.push({ name: 'throttled', config: throttled, phase: def?.phase ?? 10 });
    }

    // @debounced
    const debounced = this.extractDebounced(jsdocContent);
    if (debounced) {
      const def = builtinRegistry.get('debounced');
      declarations.push({ name: 'debounced', config: debounced, phase: def?.phase ?? 20 });
    }

    // @queued
    const queued = this.extractQueued(jsdocContent);
    if (queued) {
      const def = builtinRegistry.get('queued');
      declarations.push({ name: 'queued', config: queued, phase: def?.phase ?? 50 });
    }

    // @validate
    const validations = this.extractValidations(jsdocContent);
    if (validations && validations.length > 0) {
      const def = builtinRegistry.get('validate');
      declarations.push({ name: 'validate', config: { validations }, phase: def?.phase ?? 40 });
    }

    // @locked (handled as middleware when it appears as a functional tag)
    const lockedMatch = jsdocContent.match(/@locked(?:\s+(\w[\w\-:]*))?/i);
    if (lockedMatch) {
      const lockName = lockedMatch[1]?.trim() || '';
      const def = builtinRegistry.get('locked');
      declarations.push({ name: 'locked', config: { name: lockName }, phase: def?.phase ?? 60 });
    }

    // 2. Extract @use declarations
    const useDecls = this.extractUseDeclarations(jsdocContent);
    for (const { name, rawConfig } of useDecls) {
      // Check if this is a built-in (allow @use cached {@ttl 5m} syntax)
      const def = builtinRegistry.get(name);
      if (def) {
        // Use parseConfig if available, otherwise pass raw
        const config = def.parseConfig ? def.parseConfig(rawConfig) : rawConfig;
        // Don't duplicate if sugar tag already added this middleware
        if (!declarations.some(d => d.name === name)) {
          declarations.push({ name, config, phase: def.phase ?? 45 });
        }
      } else {
        // Custom middleware — phase defaults to 45
        declarations.push({ name, config: rawConfig, phase: 45 });
      }
    }

    return declarations;
  }

  /**
   * Extract main description from JSDoc comment
   */
  private extractDescription(jsdocContent: string): string {
    // Split by @tags that appear at start of a JSDoc line (after optional * prefix)
    // This avoids matching @tag references inline in description text
    const beforeTags = jsdocContent.split(/(?:^|\n)\s*\*?\s*@(?:param|example|returns?|throws?|see|since|deprecated|version|author|license|ui|icon|format|stateful|autorun|async|webhook|cron|scheduled|locked|fallback|logged|circuitBreaker|cached|timeout|retryable|throttled|debounced|queued|validate|use|Template|Static|mcp|photon|cli|tags|dependencies|csp|visibility|auth)\b/)[0];

    // Remove leading * from each line and trim
    const lines = beforeTags
      .split('\n')
      .map((line) => line.trim().replace(/^\*\s?/, ''));

    // Build description with paragraph-aware joining:
    // - Blank lines = paragraph boundaries (insert period separator)
    // - Non-blank consecutive lines = continuation (join with space)
    let prevWasBlank = false;
    const parts: string[] = [];
    for (const line of lines) {
      if (line.length === 0) {
        prevWasBlank = true;
        continue;
      }
      // Stop at markdown headings (## sections are extended docs)
      if (line.startsWith('#')) break;

      if (parts.length === 0) {
        parts.push(line);
      } else if (prevWasBlank) {
        // Paragraph break — add period if previous part doesn't end with punctuation
        const prev = parts[parts.length - 1];
        const needsPeriod = !/[.!?:,;]$/.test(prev);
        parts[parts.length - 1] = prev + (needsPeriod ? '. ' : ' ');
        parts.push(line);
      } else {
        // Continuation line — join with space
        parts[parts.length - 1] += ' ' + line;
      }
      prevWasBlank = false;
    }

    const description = parts.join('');

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
        .replace(/\{@choice-from\s+[^}]+\}/g, '')
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
        const format = formatMatch[1].trim();
        // Validate format is in whitelist (JSON Schema + custom formats)
        const validFormats = ['email', 'date', 'date-time', 'time', 'duration', 'uri', 'uri-reference', 'uuid', 'ipv4', 'ipv6', 'hostname', 'json', 'table'];
        if (!validFormats.includes(format)) {
          console.warn(
            `Invalid @format value: "${format}". ` +
            `Valid formats: ${validFormats.join(', ')}. Format not applied.`
          );
        } else {
          paramConstraints.format = format;
        }
      }

      // Extract {@choice value1,value2,...} - converts to enum in schema
      const choiceMatch = description.match(/\{@choice\s+([^}]+)\}/);
      if (choiceMatch) {
        const choices = choiceMatch[1].split(',').map((c: string) => c.trim());
        paramConstraints.enum = choices;
      }

      // Extract {@choice-from toolName} or {@choice-from toolName.field}
      const choiceFromMatch = description.match(/\{@choice-from\s+([^}]+)\}/);
      if (choiceFromMatch) {
        paramConstraints.choiceFrom = choiceFromMatch[1].trim();
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

      // Extract {@minItems value} - for arrays
      const minItemsMatch = description.match(/\{@minItems\s+(-?\d+(?:\.\d+)?)\}/);
      if (minItemsMatch) {
        paramConstraints.minItems = parseInt(minItemsMatch[1], 10);
      }

      // Extract {@maxItems value} - for arrays
      const maxItemsMatch = description.match(/\{@maxItems\s+(-?\d+(?:\.\d+)?)\}/);
      if (maxItemsMatch) {
        paramConstraints.maxItems = parseInt(maxItemsMatch[1], 10);
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

      // Extract {@readOnly} and {@writeOnly} - detect conflicts
      // They are mutually exclusive, so warn if both present
      const readOnlyMatch = description.match(/\{@readOnly\s*\}/);
      const writeOnlyMatch = description.match(/\{@writeOnly\s*\}/);

      if (readOnlyMatch && writeOnlyMatch) {
        // Warn about conflict
        console.warn(
          `Conflicting constraints: @readOnly and @writeOnly cannot both be applied. ` +
          `Keeping @${readOnlyMatch && writeOnlyMatch ? (description.lastIndexOf('@readOnly') > description.lastIndexOf('@writeOnly') ? 'readOnly' : 'writeOnly') : 'readOnly'}.`
        );
      }

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

      // Validate no unknown {@...} tags (typos in constraint names)
      const allKnownTags = ['min', 'max', 'pattern', 'format', 'choice', 'choice-from', 'field', 'default', 'unique', 'uniqueItems',
                             'example', 'multipleOf', 'deprecated', 'readOnly', 'writeOnly', 'label', 'placeholder',
                             'hint', 'hidden', 'accept', 'minItems', 'maxItems'];
      const unknownTagRegex = /\{@([\w-]+)\s*(?:\s+[^}]*)?\}/g;
      let unknownMatch;
      while ((unknownMatch = unknownTagRegex.exec(description)) !== null) {
        const tagName = unknownMatch[1];
        if (!allKnownTags.includes(tagName)) {
          console.warn(
            `unknown constraint/hint: @${tagName}. ` +
            `Valid hints: ${allKnownTags.slice(0, 8).join(', ')}, etc. This tag will be ignored.`
          );
        }
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
    // Validate constraint values before applying (fail-safe)
    if (constraints.min !== undefined && constraints.max !== undefined) {
      if (constraints.min > constraints.max) {
        console.warn(
          `Invalid constraint: @min (${constraints.min}) > @max (${constraints.max}). ` +
          `Using only @min. Remove @max or use a larger value.`
        );
        delete constraints.max;
      }
    }

    // Helper to apply constraints to a single schema based on type
    const applyToSchema = (s: any) => {
      // Validate constraint-type compatibility
      if (!s.enum) {
        // Warn for incompatible constraints
        if ((constraints.min !== undefined || constraints.max !== undefined) &&
            s.type !== 'number' && s.type !== 'string' && s.type !== 'array') {
          const constraintType = constraints.min !== undefined ? '@min' : '@max';
          console.warn(
            `Constraint ${constraintType} not applicable to type "${s.type || 'unknown'}". ` +
            `This constraint applies to number, string, or array types only.`
          );
        }

        if (constraints.pattern !== undefined && s.type !== 'string') {
          console.warn(
            `Constraint @pattern not applicable to type "${s.type || 'unknown'}". ` +
            `Pattern only applies to string types.`
          );
        }

        if ((constraints.minItems !== undefined || constraints.maxItems !== undefined) && s.type !== 'array') {
          const constraintType = constraints.minItems !== undefined ? '@minItems' : '@maxItems';
          console.warn(
            `Constraint ${constraintType} not applicable to type "${s.type || 'unknown'}". ` +
            `This constraint applies to array types only.`
          );
        }

        if (constraints.multipleOf !== undefined && s.type !== 'number') {
          console.warn(
            `Constraint @multipleOf not applicable to type "${s.type || 'unknown'}". ` +
            `This constraint applies to number types only.`
          );
        }
      }

      if (s.enum) {
        // Check for pattern+enum conflict before returning
        if (constraints.pattern !== undefined) {
          console.warn(
            `Conflicting constraints: @pattern cannot be used with enum/choices. ` +
            `Pattern is ignored when specific values are defined via enum or @choice.`
          );
        }
        // Skip enum types for most constraints (but still apply deprecated, examples, etc.)
        if (constraints.examples !== undefined) {
          s.examples = constraints.examples;
        }
        if (constraints.deprecated !== undefined) {
          s.deprecated = constraints.deprecated === true ? true : constraints.deprecated;
        }
        return;
      }

      // Apply min/max based on type (skip if type is incompatible)
      if (s.type === 'number') {
        if (constraints.min !== undefined) {
          s.minimum = constraints.min;
        }
        if (constraints.max !== undefined) {
          s.maximum = constraints.max;
        }
        if (constraints.multipleOf !== undefined) {
          // Validate multipleOf is positive (JSON schema requires > 0)
          if (constraints.multipleOf <= 0) {
            console.warn(
              `Invalid @multipleOf value: ${constraints.multipleOf}. ` +
              `Must be positive and non-zero. Constraint not applied.`
            );
          } else {
            s.multipleOf = constraints.multipleOf;
          }
        }
      } else if (s.type === 'string') {
        if (constraints.min !== undefined) {
          s.minLength = constraints.min;
        }
        if (constraints.max !== undefined) {
          s.maxLength = constraints.max;
        }
        if (constraints.pattern !== undefined) {
          // Validate pattern is valid regex before applying (fail-safe)
          try {
            new RegExp(constraints.pattern);
            s.pattern = constraints.pattern;
          } catch (e) {
            console.warn(
              `Invalid regex in @pattern constraint: "${constraints.pattern}". ` +
              `${e instanceof Error ? e.message : String(e)}. Pattern not applied.`
            );
          }
        }
      } else if (s.type === 'array') {
        if (constraints.min !== undefined) {
          s.minItems = constraints.min;
        }
        if (constraints.max !== undefined) {
          s.maxItems = constraints.max;
        }
        if (constraints.minItems !== undefined) {
          s.minItems = constraints.minItems;
        }
        if (constraints.maxItems !== undefined) {
          s.maxItems = constraints.maxItems;
        }
        if (constraints.unique === true) {
          s.uniqueItems = true;
        }
      } else if (s.type && s.type !== 'boolean' && s.type !== 'object') {
        // For other compatible types, apply min/max as needed
        if (['integer', 'number'].includes(s.type)) {
          if (constraints.min !== undefined) {
            s.minimum = constraints.min;
          }
          if (constraints.max !== undefined) {
            s.maximum = constraints.max;
          }
        }
      }
      // Note: For boolean and object types, we skip min/max constraints (already warned above)

      // Apply type-agnostic constraints
      if (constraints.format !== undefined) {
        s.format = constraints.format;
      }
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
      if (constraints.enum !== undefined) {
        // Check for pattern+enum conflict when @choice is being applied
        if (constraints.pattern !== undefined && s.type === 'string') {
          console.warn(
            `Conflicting constraints: @pattern cannot be used with enum/choices. ` +
            `Pattern is ignored when specific values are defined via enum or @choice.`
          );
        }
        if (!s.enum) {
          s.enum = constraints.enum;
        }
      }
      // Apply dynamic choice provider (x-choiceFrom extension)
      if (constraints.choiceFrom !== undefined) {
        s['x-choiceFrom'] = constraints.choiceFrom;
      }
      // Apply field hint for UI rendering
      if (constraints.field !== undefined) {
        s.field = constraints.field;
        // Validate @field integer constraint with default values
        if (constraints.field === 'integer' && s.default !== undefined && typeof s.default === 'number') {
          if (!Number.isInteger(s.default)) {
            console.warn(
              `Default value violates @field integer constraint: ` +
              `expected integer but got ${s.default}. ` +
              `Consider using an integer default value.`
            );
          }
        }
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

  /**
   * Extract @title tag value (human-readable display name)
   * Example: @title Create New Task
   */
  private extractTitle(jsdocContent: string): string | undefined {
    const match = jsdocContent.match(/@title\s+(.+?)(?:\n|\s*\*\/|\s*\*\s*@)/s);
    if (match) {
      return match[1].replace(/\s*\*\s*/g, ' ').trim();
    }
    return undefined;
  }

  /**
   * Check if JSDoc contains method-level @readOnly tag (NOT param-level {@readOnly})
   * Method-level: indicates tool has no side effects (MCP readOnlyHint)
   * Param-level: {@readOnly} inside @param — different regex, no conflict
   */
  private hasReadOnlyHint(jsdocContent: string): boolean {
    // Match @readOnly that is NOT inside curly braces (param-level uses {@readOnly})
    // Look for @readOnly at start of line (after * ) or start of JSDoc
    return /(?:^|\n)\s*\*?\s*@readOnly\b/m.test(jsdocContent);
  }

  /**
   * Check if JSDoc contains @destructive tag
   * Indicates tool performs destructive operations requiring confirmation
   */
  private hasDestructiveHint(jsdocContent: string): boolean {
    return /@destructive\b/i.test(jsdocContent);
  }

  /**
   * Check if JSDoc contains @idempotent tag
   * Indicates tool is safe to retry — multiple calls produce same effect
   */
  private hasIdempotentHint(jsdocContent: string): boolean {
    return /@idempotent\b/i.test(jsdocContent);
  }

  /**
   * Extract open/closed world hint from @openWorld or @closedWorld tags
   * @openWorld → true (tool interacts with external systems)
   * @closedWorld → false (tool operates only on local data)
   * Returns undefined if neither tag present
   */
  private extractOpenWorldHint(jsdocContent: string): boolean | undefined {
    if (/@openWorld\b/i.test(jsdocContent)) return true;
    if (/@closedWorld\b/i.test(jsdocContent)) return false;
    return undefined;
  }

  /**
   * Extract @audience tag value
   * @audience user → ['user']
   * @audience assistant → ['assistant']
   * @audience user assistant → ['user', 'assistant']
   */
  private extractAudience(jsdocContent: string): ('user' | 'assistant')[] | undefined {
    const match = jsdocContent.match(/@audience\s+([\w\s]+?)(?:\n|\s*\*\/|\s*\*\s*@)/);
    if (match) {
      const values = match[1].trim().split(/\s+/) as ('user' | 'assistant')[];
      const valid = values.filter(v => v === 'user' || v === 'assistant');
      return valid.length > 0 ? valid : undefined;
    }
    return undefined;
  }

  /**
   * Extract @priority tag value (content importance 0.0-1.0)
   */
  private extractContentPriority(jsdocContent: string): number | undefined {
    const match = jsdocContent.match(/@priority\s+([\d.]+)/);
    if (match) {
      const value = parseFloat(match[1]);
      if (!isNaN(value) && value >= 0 && value <= 1) {
        return value;
      }
    }
    return undefined;
  }

  /**
   * Infer output schema from TypeScript return type annotation.
   * Unwraps Promise<T> and converts T to JSON Schema.
   * Property descriptions come from JSDoc on the type/interface properties.
   * Only produces a schema for object return types (not primitives/arrays).
   */
  private inferOutputSchemaFromReturnType(method: ts.MethodDeclaration, sourceFile: ts.SourceFile): { type: 'object'; properties: Record<string, any>; required?: string[] } | undefined {
    const returnType = method.type;
    if (!returnType) return undefined;

    // Unwrap Promise<T> → T
    let innerType: ts.TypeNode = returnType;
    if (ts.isTypeReferenceNode(returnType)) {
      const typeName = returnType.typeName.getText(sourceFile);
      if (typeName === 'Promise' && returnType.typeArguments?.length) {
        innerType = returnType.typeArguments[0];
      }
    }

    // Convert to JSON Schema
    const schema = this.typeNodeToSchema(innerType, sourceFile);

    // Only produce outputSchema for object types with properties
    if (schema.type === 'object' && schema.properties && Object.keys(schema.properties).length > 0) {
      const result: { type: 'object'; properties: Record<string, any>; required?: string[] } = {
        type: 'object',
        properties: schema.properties,
      };
      if (schema.required?.length) result.required = schema.required;
      return result;
    }

    return undefined;
  }

  /**
   * Extract notification subscriptions from @notify-on tag
   * Specifies which event types this photon is interested in
   * Format: @notify-on mentions, deadlines, errors
   */
  private extractNotifyOn(jsdocContent: string): NotificationSubscription | undefined {
    const notifyMatch = jsdocContent.match(/@notify-on\s+([^\n]+)/i);
    if (!notifyMatch) {
      return undefined;
    }

    // Parse comma-separated event types
    const watchFor = notifyMatch[1]
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (watchFor.length === 0) {
      return undefined;
    }

    return { watchFor };
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

  // ═══════════════════════════════════════════════════════════════════════════════
  // FUNCTIONAL TAG EXTRACTION
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Extract logging config from @logged tag
   * - @logged → info level
   * - @logged debug → debug level
   */
  private extractLogged(jsdocContent: string): { level: string } | undefined {
    const match = jsdocContent.match(/@logged(?:\s+(\w+))?/i);
    if (!match) return undefined;
    return { level: match[1]?.trim() || 'info' };
  }

  /**
   * Extract fallback value from @fallback tag
   * - @fallback [] → empty array on error
   * - @fallback {} → empty object on error
   * - @fallback null → null on error
   * - @fallback 0 → zero on error
   */
  private extractFallback(jsdocContent: string): { value: string } | undefined {
    const match = jsdocContent.match(/@fallback\s+(.+?)(?:\s*$|\s*\n|\s*\*)/m);
    if (!match) return undefined;
    return { value: match[1].trim() };
  }

  /**
   * Extract circuit breaker configuration from @circuitBreaker tag
   * - @circuitBreaker 5 30s → 5 failures, 30s reset
   * - @circuitBreaker 3 1m → 3 failures, 1 minute reset
   */
  private extractCircuitBreaker(jsdocContent: string): { threshold: number; resetAfter: string } | undefined {
    const match = jsdocContent.match(/@circuitBreaker\s+(\d+)\s+(\d+(?:ms|s|sec|m|min|h|hr|d|day))/i);
    if (!match) return undefined;
    return { threshold: parseInt(match[1], 10), resetAfter: match[2] };
  }

  /**
   * Extract cache configuration from @cached tag
   * - @cached → default 5m TTL
   * - @cached 30s → 30 second TTL
   * - @cached 1h → 1 hour TTL
   */
  private extractCached(jsdocContent: string): { ttl: number } | undefined {
    const match = jsdocContent.match(/@cached(?:\s+(\d+(?:ms|s|sec|m|min|h|hr|d|day)))?/i);
    if (!match) return undefined;
    const ttl = match[1] ? parseDuration(match[1]) : 300_000; // default 5m
    return { ttl };
  }

  /**
   * Extract timeout configuration from @timeout tag
   * - @timeout 30s → 30 second timeout
   * - @timeout 5m → 5 minute timeout
   */
  private extractTimeout(jsdocContent: string): { ms: number } | undefined {
    const match = jsdocContent.match(/@timeout\s+(\d+(?:ms|s|sec|m|min|h|hr|d|day))/i);
    if (!match) return undefined;
    return { ms: parseDuration(match[1]) };
  }

  /**
   * Extract retry configuration from @retryable tag
   * - @retryable → default 3 retries, 1s delay
   * - @retryable 5 → 5 retries, 1s delay
   * - @retryable 3 2s → 3 retries, 2s delay
   */
  private extractRetryable(jsdocContent: string): { count: number; delay: number } | undefined {
    const match = jsdocContent.match(/@retryable(?:\s+([-\d]+))?(?:\s+([-\d]+(?:ms|s|sec|m|min|h|hr|d|day)))?/i);
    if (!match) return undefined;
    let count = match[1] ? parseInt(match[1], 10) : 3;
    let delay = match[2] ? parseDuration(match[2]) : 1_000;

    // Validate retryable configuration
    if (count <= 0) {
      console.warn(
        `Invalid @retryable count: ${count}. ` +
        `Count must be positive (> 0). Using default count 3.`
      );
      count = 3;
    }
    if (delay <= 0) {
      console.warn(
        `Invalid @retryable delay: ${delay}ms. ` +
        `Delay must be positive (> 0). Using default delay 1000ms.`
      );
      delay = 1_000;
    }

    return { count, delay };
  }

  /**
   * Extract throttle configuration from @throttled tag
   * - @throttled 10/min → 10 calls per minute
   * - @throttled 100/h → 100 calls per hour
   */
  private extractThrottled(jsdocContent: string): { count: number; windowMs: number } | undefined {
    // First check if @throttled is present at all
    const hasThrottled = /@throttled\b/i.test(jsdocContent);
    const match = jsdocContent.match(/@throttled\s+(\d+\/(?:s|sec|m|min|h|hr|d|day))/i);

    if (!match) {
      if (hasThrottled) {
        // @throttled is present but format is invalid
        const invalidMatch = jsdocContent.match(/@throttled\s+([^\s]+)/i);
        if (invalidMatch) {
          console.warn(
            `Invalid @throttled rate format: "${invalidMatch[1]}". ` +
            `Expected format: count/unit (e.g., 10/min, 100/h). Rate not applied.`
          );
        }
      }
      return undefined;
    }

    const rateStr = match[1];
    const rate = parseRate(rateStr);

    // Validate throttled configuration
    if (!rate) {
      console.warn(
        `Invalid @throttled rate format: "${rateStr}". ` +
        `Expected format: count/unit (e.g., 10/min, 100/h). Rate not applied.`
      );
      return undefined;
    }

    if (rate.count <= 0) {
      console.warn(
        `Invalid @throttled count: ${rate.count}. ` +
        `Count must be positive (> 0). Rate not applied.`
      );
      return undefined;
    }

    return rate;
  }

  /**
   * Extract debounce configuration from @debounced tag
   * - @debounced → default 500ms
   * - @debounced 200ms → 200ms delay
   * - @debounced 1s → 1 second delay
   */
  private extractDebounced(jsdocContent: string): { delay: number } | undefined {
    const match = jsdocContent.match(/@debounced(?:\s+(\d+(?:ms|s|sec|m|min|h|hr|d|day)))?/i);
    if (!match) return undefined;
    const delay = match[1] ? parseDuration(match[1]) : 500;
    return { delay };
  }

  /**
   * Extract queue configuration from @queued tag
   * - @queued → default concurrency 1
   * - @queued 3 → concurrency 3
   */
  private extractQueued(jsdocContent: string): { concurrency: number } | undefined {
    const match = jsdocContent.match(/@queued(?:\s+(\d+))?/i);
    if (!match) return undefined;
    const concurrency = match[1] ? parseInt(match[1], 10) : 1;
    return { concurrency };
  }

  /**
   * Extract validation rules from @validate tags
   * - @validate params.email must be a valid email
   * - @validate params.amount must be positive
   */
  private extractValidations(jsdocContent: string, validParamNames?: string[]): Array<{ field: string; rule: string }> | undefined {
    const validations: Array<{ field: string; rule: string }> = [];
    const regex = /@validate\s+([\w.]+)\s+(.+)/g;
    let match;
    while ((match = regex.exec(jsdocContent)) !== null) {
      const fieldName = match[1].replace(/^params\./, ''); // strip params. prefix

      // Fail-safe: Validate that referenced field exists (if validParamNames provided)
      if (validParamNames && !validParamNames.includes(fieldName)) {
        console.warn(
          `@validate references non-existent parameter "${fieldName}". ` +
          `Available parameters: ${validParamNames.join(', ')}. Validation rule ignored.`
        );
        continue;
      }

      validations.push({
        field: fieldName,
        rule: match[2].trim().replace(/\*\/$/, '').trim(), // strip JSDoc closing
      });
    }
    return validations.length > 0 ? validations : undefined;
  }

  /**
   * Extract deprecation notice from @deprecated tag (class-level, not param-level)
   * - @deprecated → true
   * - @deprecated Use addV2 instead → "Use addV2 instead"
   *
   * Note: Only matches @deprecated at the start of a JSDoc line (after * prefix),
   * NOT inside {@deprecated} inline tags (those are param-level).
   */
  private extractDeprecated(jsdocContent: string): string | true | undefined {
    // Match @deprecated at start of line (with optional * prefix), not inside {}
    const match = jsdocContent.match(/(?:^|\n)\s*\*?\s*@deprecated(?:\s+([^\n*]+))?/i);
    if (!match) return undefined;
    const message = match[1]?.trim();
    return message || true;
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

    // Match chart format (with optional chart type: bar, pie, line, donut, area)
    if (format === 'chart') {
      return subtype ? `chart:${subtype}` as OutputFormat : 'chart';
    }

    // Match visualization formats
    if (['metric', 'gauge', 'timeline', 'dashboard', 'cart', 'qr'].includes(format)) {
      return format as OutputFormat;
    }

    // Match container formats
    if (['panels', 'tabs', 'accordion', 'stack', 'columns'].includes(format)) {
      return format as OutputFormat;
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
      const value = iconMatch[1].trim();
      // If it looks like a file path, don't return as emoji icon
      if (value.startsWith('./') || value.startsWith('../') || /\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(value)) {
        return undefined;
      }
      return value;
    }
    return undefined;
  }

  /**
   * Extract icon image entries from @icon (file path) and @icons tags
   * @icon ./icons/calc.png          → [{ path: './icons/calc.png' }]
   * @icon ./icons/calc.svg          → [{ path: './icons/calc.svg' }]
   * @icons ./icons/calc-48.png 48x48       → [{ path: '...', sizes: '48x48' }]
   * @icons ./icons/calc-dark.svg dark      → [{ path: '...', theme: 'dark' }]
   * @icons ./icons/calc-96.png 96x96 dark  → [{ path: '...', sizes: '96x96', theme: 'dark' }]
   */
  private extractIconImages(jsdocContent: string): Array<{ path: string; sizes?: string; theme?: string }> | undefined {
    const images: Array<{ path: string; sizes?: string; theme?: string }> = [];

    // Check if @icon value is a file path
    const withoutLayoutHints = jsdocContent.replace(/\{[^}]+\}/g, '');
    const iconMatch = withoutLayoutHints.match(/@icon\s+([^\s@*,]+)/i);
    if (iconMatch) {
      const value = iconMatch[1].trim();
      if (value.startsWith('./') || value.startsWith('../') || /\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(value)) {
        images.push({ path: value });
      }
    }

    // Extract @icons entries (can have multiple)
    const iconsRegex = /@icons\s+([^\s@*,]+)(?:\s+(\d+x\d+))?(?:\s+(light|dark))?/gi;
    let match: RegExpExecArray | null;
    while ((match = iconsRegex.exec(jsdocContent)) !== null) {
      const entry: { path: string; sizes?: string; theme?: string } = { path: match[1].trim() };
      if (match[2]) entry.sizes = match[2];
      if (match[3]) entry.theme = match[3] as 'light' | 'dark';
      images.push(entry);
    }

    return images.length > 0 ? images : undefined;
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

    // Match @photon <name> <source> pattern, where source may include :instanceName suffix
    // e.g., @photon homeTodos todo:home → source='todo', instanceName='home'
    // Source ends at: newline, end of comment (*), or @ (next tag)
    const photonRegex = /@photon\s+(\w+)\s+([^\s*@\n:]+)(?::(\w[\w-]*))?/g;

    let match;
    while ((match = photonRegex.exec(source)) !== null) {
      const [, name, rawSource, instanceName] = match;
      const photonSource = rawSource.trim();

      // Determine source type
      const sourceType = this.classifyPhotonSource(photonSource);

      const dep: PhotonDependency = {
        name,
        source: photonSource,
        sourceType,
      };
      if (instanceName) {
        dep.instanceName = instanceName;
      }

      dependencies.push(dep);
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
    const isStateful = /@stateful\b/.test(source);

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

      // Check if matches an @photon declaration (exact match)
      if (photonMap.has(param.name)) {
        return {
          param,
          injectionType: 'photon' as const,
          photonDependency: photonMap.get(param.name),
        };
      }

      // Instance-aware DI: if paramName ends with a photon dep name (case-insensitive),
      // the prefix becomes the instance name.
      // e.g., personalWhatsapp + @photon whatsapp → instance "personal" of whatsapp
      //       workWhatsapp + @photon whatsapp → instance "work" of whatsapp
      for (const [depName, dep] of photonMap) {
        const lowerParam = param.name.toLowerCase();
        const lowerDep = depName.toLowerCase();
        if (lowerParam.endsWith(lowerDep) && lowerParam.length > lowerDep.length) {
          const prefix = param.name.slice(0, param.name.length - depName.length);
          // Ensure the prefix is a valid instance name (lowercase the first char)
          const instanceName = prefix.charAt(0).toLowerCase() + prefix.slice(1);
          return {
            param,
            injectionType: 'photon' as const,
            photonDependency: { ...dep, instanceName: instanceName || undefined },
          };
        }
      }

      // Non-primitive with default on @stateful class → persisted state
      if (isStateful && param.hasDefault) {
        return {
          param,
          injectionType: 'state' as const,
          stateKey: param.name,
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
   * export default class MyPhoton extends Photon { ... }
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
                  // First method wins as primary (used for app detection)
                  if (!asset.linkedTool) {
                    asset.linkedTool = methodName;
                  }
                  // Track all methods that reference this UI
                  if (!asset.linkedTools) asset.linkedTools = [];
                  if (!asset.linkedTools.includes(methodName)) {
                    asset.linkedTools.push(methodName);
                  }
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

/**
 * Capability types that can be auto-detected from source code
 */
export type PhotonCapability = 'emit' | 'memory' | 'call' | 'mcp' | 'lock' | 'instanceMeta' | 'allInstances' | 'caller';

/**
 * Detect capabilities used by a Photon from its source code.
 *
 * Scans for `this.emit(`, `this.memory`, `this.call(`, etc. patterns
 * and returns the set of capabilities that the runtime should inject.
 *
 * This enables plain classes (no extends Photon) to use all framework
 * features — the loader detects usage and injects automatically.
 */
export function detectCapabilities(source: string): Set<PhotonCapability> {
  const caps = new Set<PhotonCapability>();
  if (/this\.emit\s*\(/.test(source)) caps.add('emit');
  if (/this\.render\s*\(/.test(source)) caps.add('emit'); // render() needs emit injection
  if (/this\.memory\b/.test(source)) caps.add('memory');
  if (/this\.call\s*\(/.test(source)) caps.add('call');
  if (/this\.mcp\s*\(/.test(source)) caps.add('mcp');
  if (/this\.withLock\s*\(/.test(source)) caps.add('lock');
  if (/this\.instanceMeta\b/.test(source)) caps.add('instanceMeta');
  if (/this\.allInstances\s*\(/.test(source)) caps.add('allInstances');
  if (/this\.caller\b/.test(source)) caps.add('caller');
  return caps;
}
