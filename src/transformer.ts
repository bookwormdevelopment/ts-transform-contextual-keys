import { dirname, join, normalize } from 'path';
import * as ts from 'typescript';
import { Logger } from './logger';

interface ITransformerFactoryOptions {
  outputFile?: string; // Defaults to ts-transformer-contextual-keys.dbg
  log?: boolean; // Determines if logs will be created
  lines?: string[]; // Storage of log lines (usefull in case logging to file is disabled but validation is required)
}

interface IKeysMeta {
  name: string;
  optional: boolean;
}

interface IContext {
  compilerOptions: ts.CompilerOptions | null;
  context: ts.TransformationContext | null;
  currentDir: string;
  exploredSources: { [ p: string ]: boolean; };
  logger: Logger;
  tracked: { [typeName: string]: { [p: string]: IKeysMeta } };
}

const supportedFileExt = ['ts', 'tsx', 'js', 'jsx'];

type allSupportedTransformations = 'keys' | 'keysMap' | 'keysMeta';
type transformationFn = (keys: { [p: string]: IKeysMeta }) => any;
const supportedTransformations: { [t in allSupportedTransformations]: transformationFn } = {
  keys: (keys) => {
    // Returns an array of all property names
    return ts.createArrayLiteral(
      Object.keys(keys || {})
        .filter((k) => !keys[k].optional)
        .map((k) => ts.createLiteral(keys[k].name)));
  },
  keysMap: (keys) => {
    // Returns a map of property name to optional status
    return ts.createObjectLiteral(
      Object.keys(keys || {}).map((k) => {
        return ts.createPropertyAssignment(keys[k].name, ts.createLiteral(keys[k].optional));
      }));
  },
  keysMeta: (keys) => {
    // Returns an array of objects containing meta information for each key
    return ts.createArrayLiteral(Object.keys(keys || {}).map((k) => {
      return ts.createObjectLiteral([
        ts.createPropertyAssignment('name', ts.createLiteral(keys[k].name)),
        ts.createPropertyAssignment('optional', ts.createLiteral(keys[k].optional)),
      ]);
    }));
  },
};
const supportedTransformationNames = Object.keys(supportedTransformations);

export function factory(options: ITransformerFactoryOptions = {}): ts.TransformerFactory<ts.SourceFile> {
  const logger = new Logger(
    options.outputFile || 'ts-transformer-contextual-keys.dbg',
    options.log || false,
    options.lines || [],
  );

  logger.log('Transformer factory created using options', options);
  logger.flush();

  return createTransformerFactory({
    compilerOptions: null,
    context: null,
    currentDir: ts.sys.getCurrentDirectory(),
    exploredSources: {},
    logger,
    tracked: {},
  });
}

export default factory;

function createTransformerFactory(global: IContext) {
  return function transformerFactory(context: ts.TransformationContext): ts.Transformer<ts.SourceFile> {
    if (!global.compilerOptions) {
      global.logger.log('Extracting compiler options');
      global.logger.flush();

      global.compilerOptions = context.getCompilerOptions();
    }

    global.context = context;

    return createTransformer(global);
  };
}

function createTransformer(global: IContext) {
  return function transformer(sourceFile: ts.SourceFile): ts.SourceFile {
    global.logger.log('Checking out source file', sourceFile.fileName.slice(global.currentDir.length + 1));
    global.exploredSources[sourceFile.fileName] = true;

    const visitor = createVisitor(global);

    try {
      const ret = ts.visitNode(sourceFile, visitor);
      global.logger.flush();

      return ret;
    } catch (e) {
      // Make sure to write the logs before retrowing
      global.logger.flush();

      throw new Error(`An error took place: ${e.message}\n  ${e.stack}`);
    }
  };
}

function createVisitor(global: IContext): ts.Visitor {
  const visitor = (node: ts.Node): ts.VisitResult<ts.Node> =>  {
    // Track imports/exports and extract data from them
    if (node.kind === ts.SyntaxKind.ImportDeclaration ||
        node.kind === ts.SyntaxKind.ExportDeclaration) {
      let currentModule: string;
      let requestedModule: string = '';

      // Imports first
      if (node.kind === ts.SyntaxKind.ImportDeclaration) {
        const imp = node as ts.ImportDeclaration;
        const currentSource = imp.getSourceFile() || { fileName: '' };
        currentModule = dirname(currentSource.fileName);
        requestedModule = getText(imp.moduleSpecifier).trim();
      } else {
        // Export
        const exp = node as ts.ExportDeclaration;
        const currentSource = exp.getSourceFile() || { fileName: '' };
        currentModule = dirname(currentSource.fileName);

        if (exp.moduleSpecifier) {
          requestedModule = getText(exp.moduleSpecifier).trim();
        }
      }

      // Only for imports and exports based on a module specifier
      if (currentModule && requestedModule) {
        const located = locate(global.currentDir, currentModule, requestedModule);

        if (!located.located) {
          if (located.nodeModule) {
            global.logger.log(`Unable to determine module ${requestedModule} entry point file.`);
          } else {
            global.logger.log(`Unable to determine file name of module ${requestedModule}.`);
          }
        } else {
          global.logger.log(`Found imported file, ${located.location}`);
        }

        if (!global.exploredSources[located.location]) {
          global.exploredSources[located.location] = true;

          // Visit the source file of the current import
          ts.visitEachChild(
            ts.createSourceFile(
              located.location,
              ts.sys.readFile(located.location) || '',
              (global.compilerOptions as ts.CompilerOptions).target || ts.ScriptTarget.ES2015, true),
            visitor,
            global.context as ts.TransformationContext,
          );
        }
      }
    }

    // Track interfaces
    if (node.kind === ts.SyntaxKind.InterfaceDeclaration) {
      // For each interface track it's name and member names
      const i = node as ts.InterfaceDeclaration;
      const name = getText(i.name);

      if (!global.tracked[name]) {
        // Only track new interfaces (they tend to be unique)
        // TODO: Modify this check to take file names into account rather then interface names (for bad code styles)

        const heritage = i.heritageClauses ? i.heritageClauses.filter((h) => {
          // Only interested in extend cases (implementations don't add new props)
          if (h.token === ts.SyntaxKind.ExtendsKeyword) {
            return true;
          }

          return false;
        }).map((h) => getText(h)) : [];

        let inheritedProps = {};
        heritage.forEach((iName) => {
          const trackedProps = global.tracked[iName];

          if (trackedProps) {
            inheritedProps = {
              ...trackedProps,
            };
          }
        });

        global.logger.log('Found new interface', name);
        global.tracked[name] = {
          ...inheritedProps,
          ...(global.tracked[name] || {}),
        };

        i.members.forEach((m) => {
          if (m.kind === ts.SyntaxKind.PropertySignature) {
            const p = m as ts.PropertySignature;
            const pName = getText(p.name).trim();
            const pOptional = !!p.questionToken;

            global.tracked[name][pName] = {
              name: pName,
              optional: pOptional,
            };
            global.logger.log(`${name}: Tracked member ${pName} as ${pOptional ? 'optional' : 'required'} key`);
          } else if (
            m.kind === ts.SyntaxKind.MethodSignature ||
            m.kind === ts.SyntaxKind.CallSignature ||
            m.kind === ts.SyntaxKind.IndexSignature
          ) {
            // Do nothing case, we are not interested in remembering above type, as they don't represent keys
          } else {
            global.logger.log(`${name}: Unknown/unhandled interface property type: ${ts.SyntaxKind[m.kind]}`);
          }
        });
      }
    }

    // Check for transformations required
    const transformatioResult = transform(getTransformation(node), global);
    if (transformatioResult) {
      return transformatioResult;
    }

    return ts.visitEachChild(node, visitor, global.context as ts.TransformationContext);
  };

  return visitor;
}

// Locates a module of file in contexts where the extension is missing
// Resolution mechanism:
// a) Node module:
//    1) resolve directly the index.js in the module's directory
//    2) read package.json and try to resolve the main property's targeted file as module entry point
// b) Local module:
//    1) resolve the file directly
//    2) resolve the module or file by one of the two cases:
//      - File case: locate the file by sufixing multiple extensions to it
//      - Directory case: locate the index file of the module by sufixing multiple extensions to it
function locate(baseDir: string, currentModule: string, module: string):
  { nodeModule: boolean; located: boolean; location: string; } {
  const ret: { nodeModule: boolean; located: boolean; location: string; } = {
    located: false,
    location: '',
    nodeModule: module[0] !== '.',
  };

  // Generate a base location for node modules or local modules
  ret.location = !ret.nodeModule ? normalize(join(currentModule, module)) : join(baseDir, 'node_modules', module);

  if (ret.nodeModule) {
    // Check for index.js first
    if (ts.sys.fileExists(join(ret.location, 'index.js'))) {
      ret.location = join(ret.location, 'index.js');
      ret.located = true;
    } else if (ts.sys.fileExists(join(ret.location, 'package.json'))) {
      // Check package.json for main field
      const config = JSON.parse(ts.sys.readFile(join(ret.location, 'package.json')) || '');

      if (config && config.main) {
        // Check if main file exists
        if (ts.sys.fileExists(join(ret.location, config.main))) {
          ret.location = join(ret.location, config.main);
          ret.located = true;
        }
      }
    }
  } else {
    // File contains an extension or is extensionless (direct match first)
    if (ts.sys.fileExists(ret.location)) {
      ret.located = true;
    } else {
      // File and directory resolve
      // If the location is a directory look for an index file as module entry point
      // If the location is a file, look for the first matching extension
      const isDir = ts.sys.directoryExists(ret.location);
      const file = isDir ? join(ret.location, 'index') : ret.location;

      // File case, test in order for each possible file extension
      for (const s of supportedFileExt) {
        const f = `${file}.${s}`;

        if (ts.sys.fileExists(f)) {
          ret.location = f;
          ret.located = true;
          break;
        }
      }
    }
  }

  return ret;
}

function transform(transformation: ITransformationDesc, global: IContext): any {
  const transFn = supportedTransformationNames.indexOf(transformation.name) > -1 ?
    supportedTransformations[transformation.name] : null;

  // There is a matching transformation?
  if (transFn) {
    const data = global.tracked[transformation.type];

    // There is tracked data for the type to be transformed?
    if (data) {
      global.logger.log(`Executing transformation ${transformation.name} against data set:`, data);
      const res = transFn(data);

      global.logger.log(`Result of ${transformation.name}:`, res);
      return res;
    } else {
      global.logger.log(`No tracked type data for type ${transformation.type} ` +
        `to be used in ${transformation.name} transformation`);
    }
  }

  return null;
}

function getText(node: ts.Node): string {
  if (node && ts.SyntaxKind[node.kind]) {
    switch (node.kind) {
      case ts.SyntaxKind.StringLiteral:
        return (node as ts.StringLiteral).text;
      case ts.SyntaxKind.Identifier:
        return (node as ts.Identifier).text;
      case ts.SyntaxKind.HeritageClause:
        const types = (node as ts.HeritageClause).types;

        return types.map((t) => {
          return getText(t);
        })[0];
      case ts.SyntaxKind.ExpressionWithTypeArguments:
        return getText((node as ts.ExpressionWithTypeArguments).expression);
      default:
        console.info('Unhandled text getter for: ', ts.SyntaxKind[node.kind]);
    }
  }

  return '';
}

function getTransformation(node: ts.Node): ITransformationDesc  {
  let name = '';
  let type = '';

  if (node.kind === ts.SyntaxKind.CallExpression) {
    try {
      const callExp = node as ts.CallExpression;
      name = callExp.expression ? callExp.expression.getText() : '';
      type = callExp.typeArguments ?
        (callExp.typeArguments as ts.NodeArray<ts.TypeNode>)[0].getText() : '';
    } catch {
      // Do nothing
    }
  }

  return {
    name,
    type,
  };
}

interface ITransformationDesc {
  name: string;
  type: string;
}
