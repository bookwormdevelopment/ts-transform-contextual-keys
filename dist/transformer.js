"use strict";
var __assign = (this && this.__assign) || Object.assign || function(t) {
    for (var s, i = 1, n = arguments.length; i < n; i++) {
        s = arguments[i];
        for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
            t[p] = s[p];
    }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
var path_1 = require("path");
var ts = require("typescript");
var logger_1 = require("./logger");
var supportedFileExt = ['ts', 'tsx', 'js', 'jsx'];
var supportedTransformations = {
    keys: function (keys) {
        return ts.createArrayLiteral(Object.keys(keys || {})
            .filter(function (k) { return !keys[k].optional; })
            .map(function (k) { return ts.createLiteral(keys[k].name); }));
    },
    keysMap: function (keys) {
        return ts.createObjectLiteral(Object.keys(keys || {}).map(function (k) {
            return ts.createPropertyAssignment(keys[k].name, ts.createLiteral(keys[k].optional));
        }));
    },
    keysMeta: function (keys) {
        return ts.createArrayLiteral(Object.keys(keys || {}).map(function (k) {
            return ts.createObjectLiteral([
                ts.createPropertyAssignment('name', ts.createLiteral(keys[k].name)),
                ts.createPropertyAssignment('optional', ts.createLiteral(keys[k].optional)),
            ]);
        }));
    },
};
var supportedTransformationNames = Object.keys(supportedTransformations);
function factory(options) {
    if (options === void 0) { options = {}; }
    var logger = new logger_1.Logger(options.outputFile || 'ts-transformer-contextual-keys.dbg', options.log || false, options.lines || []);
    logger.log('Transformer factory created using options', options);
    logger.flush();
    return createTransformerFactory({
        compilerOptions: null,
        context: null,
        currentDir: ts.sys.getCurrentDirectory(),
        exploredSources: {},
        logger: logger,
        tracked: {},
    });
}
exports.factory = factory;
exports.default = factory;
function createTransformerFactory(global) {
    return function transformerFactory(context) {
        if (!global.compilerOptions) {
            global.logger.log('Extracting compiler options');
            global.logger.flush();
            global.compilerOptions = context.getCompilerOptions();
        }
        global.context = context;
        return createTransformer(global);
    };
}
function createTransformer(global) {
    return function transformer(sourceFile) {
        global.logger.log('Checking out source file', sourceFile.fileName.slice(global.currentDir.length + 1));
        global.exploredSources[sourceFile.fileName] = true;
        var visitor = createVisitor(global);
        try {
            var ret = ts.visitNode(sourceFile, visitor);
            global.logger.flush();
            return ret;
        }
        catch (e) {
            global.logger.flush();
            throw new Error("An error took place: " + e.message + "\n  " + e.stack);
        }
    };
}
function createVisitor(global) {
    var visitor = function (node) {
        if (node.kind === ts.SyntaxKind.ImportDeclaration ||
            node.kind === ts.SyntaxKind.ExportDeclaration) {
            var currentModule = void 0;
            var requestedModule = '';
            if (node.kind === ts.SyntaxKind.ImportDeclaration) {
                var imp = node;
                var currentSource = imp.getSourceFile() || { fileName: '' };
                currentModule = path_1.dirname(currentSource.fileName);
                requestedModule = getText(imp.moduleSpecifier).trim();
            }
            else {
                var exp = node;
                var currentSource = exp.getSourceFile() || { fileName: '' };
                currentModule = path_1.dirname(currentSource.fileName);
                if (exp.moduleSpecifier) {
                    requestedModule = getText(exp.moduleSpecifier).trim();
                }
            }
            if (currentModule && requestedModule) {
                var located = locate(global.currentDir, currentModule, requestedModule);
                if (!located.located) {
                    if (located.nodeModule) {
                        global.logger.log("Unable to determine module " + requestedModule + " entry point file.");
                    }
                    else {
                        global.logger.log("Unable to determine file name of module " + requestedModule + ".");
                    }
                }
                else {
                    global.logger.log("Found imported file, " + located.location);
                }
                if (!global.exploredSources[located.location]) {
                    global.exploredSources[located.location] = true;
                    ts.visitEachChild(ts.createSourceFile(located.location, ts.sys.readFile(located.location) || '', global.compilerOptions.target || ts.ScriptTarget.ES2015, true), visitor, global.context);
                }
            }
        }
        if (node.kind === ts.SyntaxKind.InterfaceDeclaration) {
            var i = node;
            var name_1 = getText(i.name);
            if (!global.tracked[name_1]) {
                var heritage = i.heritageClauses ? i.heritageClauses.filter(function (h) {
                    if (h.token === ts.SyntaxKind.ExtendsKeyword) {
                        return true;
                    }
                    return false;
                }).map(function (h) { return getText(h); }) : [];
                var inheritedProps_1 = {};
                heritage.forEach(function (iName) {
                    var trackedProps = global.tracked[iName];
                    if (trackedProps) {
                        inheritedProps_1 = __assign({}, trackedProps);
                    }
                });
                global.logger.log('Found new interface', name_1);
                global.tracked[name_1] = __assign({}, inheritedProps_1, (global.tracked[name_1] || {}));
                i.members.forEach(function (m) {
                    if (m.kind === ts.SyntaxKind.PropertySignature) {
                        var p = m;
                        var pName = getText(p.name).trim();
                        var pOptional = !!p.questionToken;
                        global.tracked[name_1][pName] = {
                            name: pName,
                            optional: pOptional,
                        };
                        global.logger.log(name_1 + ": Tracked member " + pName + " as " + (pOptional ? 'optional' : 'required') + " key");
                    }
                    else if (m.kind === ts.SyntaxKind.MethodSignature ||
                        m.kind === ts.SyntaxKind.CallSignature ||
                        m.kind === ts.SyntaxKind.IndexSignature) {
                    }
                    else {
                        global.logger.log(name_1 + ": Unknown/unhandled interface property type: " + ts.SyntaxKind[m.kind]);
                    }
                });
            }
        }
        var transformatioResult = transform(getTransformation(node), global);
        if (transformatioResult) {
            return transformatioResult;
        }
        return ts.visitEachChild(node, visitor, global.context);
    };
    return visitor;
}
function locate(baseDir, currentModule, module) {
    var ret = {
        located: false,
        location: '',
        nodeModule: module[0] !== '.',
    };
    ret.location = !ret.nodeModule ? path_1.normalize(path_1.join(currentModule, module)) : path_1.join(baseDir, 'node_modules', module);
    if (ret.nodeModule) {
        if (ts.sys.fileExists(path_1.join(ret.location, 'index.js'))) {
            ret.location = path_1.join(ret.location, 'index.js');
            ret.located = true;
        }
        else if (ts.sys.fileExists(path_1.join(ret.location, 'package.json'))) {
            var config = JSON.parse(ts.sys.readFile(path_1.join(ret.location, 'package.json')) || '');
            if (config && config.main) {
                if (ts.sys.fileExists(path_1.join(ret.location, config.main))) {
                    ret.location = path_1.join(ret.location, config.main);
                    ret.located = true;
                }
            }
        }
    }
    else {
        if (ts.sys.fileExists(ret.location)) {
            ret.located = true;
        }
        else {
            var isDir = ts.sys.directoryExists(ret.location);
            var file = isDir ? path_1.join(ret.location, 'index') : ret.location;
            for (var _i = 0, supportedFileExt_1 = supportedFileExt; _i < supportedFileExt_1.length; _i++) {
                var s = supportedFileExt_1[_i];
                var f = file + "." + s;
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
function transform(transformation, global) {
    var transFn = supportedTransformationNames.indexOf(transformation.name) > -1 ?
        supportedTransformations[transformation.name] : null;
    if (transFn) {
        var data = global.tracked[transformation.type];
        if (data) {
            global.logger.log("Executing transformation " + transformation.name + " against data set:", data);
            var res = transFn(data);
            global.logger.log("Result of " + transformation.name + ":", res);
            return res;
        }
        else {
            global.logger.log("No tracked type data for type " + transformation.type + " " +
                ("to be used in " + transformation.name + " transformation"));
        }
    }
    return null;
}
function getText(node) {
    if (node && ts.SyntaxKind[node.kind]) {
        switch (node.kind) {
            case ts.SyntaxKind.StringLiteral:
                return node.text;
            case ts.SyntaxKind.Identifier:
                return node.text;
            case ts.SyntaxKind.HeritageClause:
                var types = node.types;
                return types.map(function (t) {
                    return getText(t);
                })[0];
            case ts.SyntaxKind.ExpressionWithTypeArguments:
                return getText(node.expression);
            default:
                console.info('Unhandled text getter for: ', ts.SyntaxKind[node.kind]);
        }
    }
    return '';
}
function getTransformation(node) {
    var name = '';
    var type = '';
    if (node.kind === ts.SyntaxKind.CallExpression) {
        try {
            var callExp = node;
            name = callExp.expression ? callExp.expression.getText() : '';
            type = callExp.typeArguments ?
                callExp.typeArguments[0].getText() : '';
        }
        catch (_a) {
        }
    }
    return {
        name: name,
        type: type,
    };
}
//# sourceMappingURL=transformer.js.map