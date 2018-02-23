"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var circularJSON = require("circular-json");
var ts = require("typescript");
var Logger = (function () {
    function Logger(fileName, writeToFile, storage) {
        this.storage = [];
        this.unflushed = 0;
        this.maxUnflushed = 25;
        this.fileName = fileName;
        this.writeToFile = writeToFile;
        this.storage = storage && storage.join ? storage : [];
        this.writeToStorage = this.writeToFile || !!(storage && storage.join);
    }
    Object.defineProperty(Logger.prototype, "noop", {
        get: function () {
            return !this.writeToFile && !this.writeToStorage;
        },
        enumerable: true,
        configurable: true
    });
    Logger.prototype.log = function () {
        var _this = this;
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        if (this.noop) {
            return;
        }
        var parts = args.map(function (p) {
            if (p) {
                if (p.toLowerCase) {
                    return p;
                }
                else if (Array.isArray(p)) {
                    return p.join(' ');
                }
                else if (p === Object(p)) {
                    return "\n  keys: [" + Object.keys(p) + "]\n  value:" + _this.pad(_this.json(p), 2);
                }
                return _this.json(p);
            }
            return '';
        });
        if (this.writeToStorage) {
            this.storage.push(new Date().toString() + ": " + parts.join(' '));
            this.unflushed++;
            if (this.unflushed >= this.maxUnflushed) {
                this.flush();
            }
        }
        else {
            this.writeFile([new Date().toString() + ": " + parts.join(' ')]);
        }
    };
    Logger.prototype.flush = function () {
        if (this.unflushed) {
            this.unflushed = 0;
            if (this.writeToFile) {
                this.writeFile(this.storage);
                this.storage = [this.storage.join('\n')];
            }
        }
    };
    Logger.prototype.writeFile = function (storage) {
        ts.sys.writeFile(this.fileName, storage.join('\n'));
    };
    Logger.prototype.pad = function (lines, ammount) {
        var padding = this.repeat(' ', ammount);
        return lines.split('\n').map(function (l) { return "" + padding + l; }).join('\n');
    };
    Logger.prototype.repeat = function (what, ammount) {
        var i = 0;
        var final = [];
        while (i <= ammount) {
            i++;
            final.push('');
        }
        return final.join(what);
    };
    Logger.prototype.json = function (what) {
        return circularJSON.stringify(what);
    };
    return Logger;
}());
exports.Logger = Logger;
//# sourceMappingURL=logger.js.map